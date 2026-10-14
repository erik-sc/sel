import { describe, expect, it } from 'vitest'
import { UPDATES_CHECK_KEY, UPDATES_KEYS, UPDATES_LAST_CHECK_KEY, type UpdateStatus } from '../../shared/updates'
import * as arg from '../validate'
import { UPDATE_TIMING } from './schedule'
import { UpdatesService, type UpdaterDriver } from './service'

const START = 1_800_000_000_000

/** A service with a hand-driven clock and timers, and a driver that records what it was asked. */
function setup(options: { enabled?: unknown; lastCheck?: unknown; supported?: boolean; found?: string | null; failCheck?: boolean; failDownload?: boolean } = {}) {
  const settings: Record<string, unknown> = { [UPDATES_CHECK_KEY]: options.enabled, [UPDATES_LAST_CHECK_KEY]: options.lastCheck }
  const calls: string[] = []
  const published: UpdateStatus[] = []
  let now = START
  let recording = false
  let timers: { run: () => void; at: number; id: number }[] = []
  let nextId = 0
  let finishDownload: (() => void) | null = null
  let loads = 0

  const driver: UpdaterDriver = {
    async check() {
      calls.push('check')
      if (options.failCheck) throw new Error('net::ERR_INTERNET_DISCONNECTED')
      const found = options.found === undefined ? '0.3.0' : options.found
      return found ? { version: found } : null
    },
    download(onProgress) {
      calls.push('download')
      onProgress(12.6)
      onProgress(12.9)
      onProgress(55)
      if (options.failDownload) return Promise.reject(new Error('sha512 checksum mismatch'))
      return new Promise<void>((resolve) => (finishDownload = resolve))
    },
    install(relaunch) {
      calls.push(`install ${relaunch ? 'and relaunch' : 'quietly'}`)
      return true
    }
  }

  const service = new UpdatesService({
    current: '0.2.0',
    supported: options.supported ?? true,
    getSetting: (key) => settings[key] ?? null,
    setSetting: (key, value) => (settings[key] = value),
    recording: () => recording,
    now: () => now,
    loadDriver: async () => {
      loads += 1
      return driver
    },
    publish: (status) => published.push(status),
    quit: () => calls.push('quit'),
    timers: {
      set: (run, ms) => {
        const id = ++nextId
        timers.push({ run, at: now + ms, id })
        return id
      },
      clear: (id) => (timers = timers.filter((timer) => timer.id !== id))
    },
    log: () => undefined
  })

  /** Moves the clock and runs the timers that came due, then lets promises settle. */
  const advance = async (ms: number): Promise<void> => {
    now += ms
    for (;;) {
      const due = timers.filter((timer) => timer.at <= now)
      if (!due.length) break
      timers = timers.filter((timer) => timer.at > now)
      for (const timer of due) timer.run()
      await flush()
    }
    await flush()
  }
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  return {
    service,
    settings,
    calls,
    published,
    advance,
    flush,
    loads: () => loads,
    timers: () => timers.length,
    setRecording: (value: boolean) => (recording = value),
    finishDownload: () => finishDownload?.()
  }
}

describe('with the check off (the default)', () => {
  it('never loads the updater, so nothing goes on the network, however long the app is open', async () => {
    const t = setup()
    t.service.plan()
    expect(t.timers()).toBe(0)
    await t.advance(30 * UPDATE_TIMING.intervalMs)
    expect(t.loads()).toBe(0)
    expect(t.calls).toEqual([])
    expect(t.settings[UPDATES_LAST_CHECK_KEY]).toBeUndefined()
  })

  it('still asks when the user presses Check now', async () => {
    const t = setup()
    const status = await t.service.check()
    expect(t.calls).toEqual(['check'])
    expect(status).toMatchObject({ phase: 'available', version: '0.3.0', notesUrl: 'https://github.com/erik-sc/sel/releases/tag/v0.3.0' })
    expect(t.settings[UPDATES_LAST_CHECK_KEY]).toBe(START)
  })

  it('turning it off stops a check that was waiting', async () => {
    const t = setup({ enabled: true })
    t.service.plan()
    expect(t.timers()).toBe(1)
    t.settings[UPDATES_CHECK_KEY] = false
    t.service.plan()
    expect(t.timers()).toBe(0)
    await t.advance(UPDATE_TIMING.intervalMs)
    expect(t.loads()).toBe(0)
  })
})

describe('with the check on', () => {
  it('asks a few minutes after start, then once a day', async () => {
    const t = setup({ enabled: true, found: null })
    t.service.plan()
    await t.advance(UPDATE_TIMING.startDelayMs - 1)
    expect(t.calls).toEqual([])
    await t.advance(1)
    expect(t.calls).toEqual(['check'])
    expect(t.service.status().phase).toBe('current')
    await t.advance(UPDATE_TIMING.intervalMs - 1)
    expect(t.calls).toEqual(['check'])
    await t.advance(1)
    expect(t.calls).toEqual(['check', 'check'])
  })

  it('counts a check from an earlier session', async () => {
    const t = setup({ enabled: true, lastCheck: START - UPDATE_TIMING.intervalMs + 60 * 60_000 })
    t.service.plan()
    await t.advance(UPDATE_TIMING.startDelayMs)
    expect(t.calls).toEqual([])
    await t.advance(60 * 60_000)
    expect(t.calls).toEqual(['check'])
  })

  it('waits for a recording to end', async () => {
    const t = setup({ enabled: true })
    t.setRecording(true)
    t.service.plan()
    await t.advance(UPDATE_TIMING.startDelayMs + 2 * UPDATE_TIMING.recordingRetryMs)
    expect(t.calls).toEqual([])
    t.setRecording(false)
    await t.advance(UPDATE_TIMING.recordingRetryMs)
    expect(t.calls).toEqual(['check'])
  })

  it('is quiet about a failed check and does not retry before the next day', async () => {
    const t = setup({ enabled: true, failCheck: true })
    t.service.plan()
    await t.advance(UPDATE_TIMING.startDelayMs)
    expect(t.service.status()).toMatchObject({ phase: 'error', version: null, error: 'sel could not reach GitHub to look for a new version.' })
    await t.advance(UPDATE_TIMING.intervalMs - 1)
    expect(t.calls).toEqual(['check'])
  })

  it('never downloads by itself', async () => {
    const t = setup({ enabled: true })
    t.service.plan()
    await t.advance(3 * UPDATE_TIMING.intervalMs)
    expect(t.calls.filter((call) => call !== 'check')).toEqual([])
    expect(t.service.status().phase).toBe('available')
  })
})

describe('what the user decides', () => {
  it('downloads only when asked, with progress, and installs only on the way out', async () => {
    const t = setup()
    await t.service.check()
    t.service.download()
    await t.flush()
    expect(t.service.status()).toMatchObject({ phase: 'downloading', percent: 55 })
    // One status per whole percent, not one per progress event.
    expect(t.published.filter((status) => status.phase === 'downloading').map((status) => status.percent)).toEqual([0, 12, 55])
    t.finishDownload()
    await t.flush()
    expect(t.service.status()).toMatchObject({ phase: 'ready', percent: 100 })
    expect(t.calls).toEqual(['check', 'download'])
    t.service.quitting(0)
    expect(t.calls).toEqual(['check', 'download', 'install quietly'])
  })

  it('Restart now quits the ordinary way, and the install starts sel again', async () => {
    const t = setup()
    await t.service.check()
    t.service.download()
    await t.flush()
    t.finishDownload()
    await t.flush()
    t.service.restart()
    expect(t.calls.at(-1)).toBe('quit')
    t.service.quitting(0)
    expect(t.calls.at(-1)).toBe('install and relaunch')
  })

  it('does not restart during a recording', async () => {
    const t = setup()
    await t.service.check()
    t.service.download()
    await t.flush()
    t.finishDownload()
    await t.flush()
    t.setRecording(true)
    expect(() => t.service.restart()).toThrow('Stop the recording first')
    expect(t.calls).not.toContain('quit')
  })

  it('installs nothing on quit without a finished download', async () => {
    const t = setup()
    await t.service.check()
    t.service.quitting(0)
    t.service.download()
    await t.flush()
    t.service.quitting(0)
    expect(t.calls).toEqual(['check', 'download'])
  })

  it('installs nothing when the app exits with an error', async () => {
    const t = setup()
    await t.service.check()
    t.service.download()
    await t.flush()
    t.finishDownload()
    await t.flush()
    t.service.quitting(1)
    expect(t.calls).toEqual(['check', 'download'])
  })

  it('refuses to download or restart when there is nothing to', async () => {
    const t = setup({ found: null })
    expect(() => t.service.download()).toThrow('There is no new version to download.')
    expect(() => t.service.restart()).toThrow('No new version is ready to install.')
    await t.service.check()
    expect(t.service.status().phase).toBe('current')
    expect(() => t.service.download()).toThrow('There is no new version to download.')
  })

  it('offers the download again when it failed', async () => {
    const t = setup({ failDownload: true })
    await t.service.check()
    t.service.download()
    await t.flush()
    expect(t.service.status()).toMatchObject({ phase: 'error', version: '0.3.0', error: 'The download did not finish. Try again later.' })
    t.service.download()
    await t.flush()
    expect(t.calls).toEqual(['check', 'download', 'download'])
  })

  it('Later hides the notice until a different version turns up', async () => {
    const t = setup()
    await t.service.check()
    t.service.dismiss()
    expect(t.service.status().dismissed).toBe(true)
    await t.service.check()
    expect(t.service.status().dismissed).toBe(true)
  })

  it('brings the notice back once when a download put away with Later is ready', async () => {
    const t = setup()
    await t.service.check()
    t.service.download()
    await t.flush()
    t.service.dismiss()
    expect(t.service.status().dismissed).toBe(true)
    t.finishDownload()
    await t.flush()
    expect(t.service.status()).toMatchObject({ phase: 'ready', dismissed: false })
  })

  it('takes no version that is not a plain version number', async () => {
    const t = setup({ found: '<img src=x>' })
    await t.service.check()
    expect(t.service.status()).toMatchObject({ phase: 'current', version: null, notesUrl: null })
  })

  it('says why it cannot check in a build that cannot be updated', async () => {
    const t = setup({ supported: false })
    await expect(t.service.check()).rejects.toThrow('Updates work only in the installed app.')
    expect(t.loads()).toBe(0)
  })

  it('asks GitHub once for two checks at the same time', async () => {
    const t = setup()
    await Promise.all([t.service.check(), t.service.check()])
    expect(t.calls).toEqual(['check'])
  })
})

describe('the update setting', () => {
  it('can be written by a window, as a boolean only; the time of the last check cannot', () => {
    expect([...UPDATES_KEYS]).toEqual(['updates.check'])
    expect(arg.isWritableSetting('updates.check')).toBe(true)
    expect(arg.isWritableSetting('updates.lastCheck')).toBe(false)
    expect(arg.isWritableSetting('updates.anything')).toBe(false)
    expect(arg.settingValueFor('updates.check', true)).toBe(true)
    expect(arg.settingValueFor('updates.check', false)).toBe(false)
    expect(arg.settingValueFor('updates.check', null)).toBeNull()
    for (const value of ['true', 1, {}, []]) expect(() => arg.settingValueFor('updates.check', value)).toThrow('Invalid setting value')
  })
})
