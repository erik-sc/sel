import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cleanMeetingsSetting, clockTime, MEETING_LIMITS, MEETINGS_KEYS, parseClockTime, PCM, type MeetingsProgress, type MeetingsStatus } from '../../shared/meetings'
import { plainText } from '../../shared/richtext'
import { openTestRepository } from '../db/testing'
import type { Repository } from '../db/repository'
import { device, pair, remoteFiles, suite, sync } from '../sync/harness'
import * as arg from '../validate'
import { GrantStore } from './grant'
import { meetingInput, MeetingsService } from './service'
import { cleanSegments, cleanSpeaker, mergeTranscript, paragraphSpans, renameSpeakerSpans, transcriptFromTitles, transcriptText, type Segment } from './transcript'
import { WhisperEngine } from './whisper/engine'
import { WhisperError, type WhisperRun } from './whisper/run'

// These tests write real files and run a stand-in program as a child process. Alone each takes
// well under a second; under the load of the whole suite (and on CI's Windows runner) spawning
// and file access can stall for many seconds. So nothing here waits a fixed time or a fixed
// number of turns: it waits for what it expects (`until`), and only the timeout bounds that.
vi.setConfig({ testTimeout: 120_000 })
const PATIENCE_MS = 90_000

const ROOT = mkdtempSync(join(tmpdir(), 'sel-meetings-service-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
let serial = 0
const FAKE = fileURLToPath(new URL('./whisper/fixtures/fake-whisper.mjs', import.meta.url))
const OWNER = 5

function tone(seconds: number, amplitude = 0.3): ArrayBuffer {
  const samples = new Int16Array(Math.round(seconds * PCM.sampleRate))
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin((i / PCM.sampleRate) * 2 * Math.PI * 300) * amplitude * 32767)
  return samples.buffer
}
const silence = (seconds: number): ArrayBuffer => new ArrayBuffer(Math.round(seconds * PCM.sampleRate) * 2)

interface World {
  repo: Repository
  service: MeetingsService
  grants: GrantStore
  dir: string
  statuses: MeetingsStatus[]
  progress: MeetingsProgress[]
  stops: string[]
  free: { bytes: number }
  clock: { t: number }
}

/** Waits until `check` holds; fails with `what` once even a loaded machine would have got there. */
async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + PATIENCE_MS
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function world(options: { systemAudio?: boolean; engine?: boolean; chunkSeconds?: number; runWhisper?: (run: WhisperRun) => ReturnType<NonNullable<ConstructorParameters<typeof MeetingsService>[0]['runWhisper']>> } = {}): World {
  const base = join(ROOT, String(++serial))
  const dir = join(base, 'recordings')
  mkdirSync(base, { recursive: true })
  const repo = openTestRepository()
  const grants = new GrantStore()
  const statuses: MeetingsStatus[] = []
  const progress: MeetingsProgress[] = []
  const stops: string[] = []
  const free = { bytes: 50 * 1024 * 1024 * 1024 }
  const clock = { t: Date.UTC(2026, 9, 13, 12) }
  const model = join(base, 'model.bin')
  writeFileSync(model, Buffer.alloc(2 * 1024 * 1024))
  const engine = new WhisperEngine({
    dir: join(base, 'whisper'),
    getSetting: (key) => (key === 'meetings.modelPath' && options.engine !== false ? model : repo.getSetting(key)),
    setSetting: (key, value) => repo.setSetting(key, value),
    devProgram: options.engine === false ? null : FAKE,
    platformKey: 'test-none'
  })
  const service = new MeetingsService({
    repo,
    dir,
    engine,
    grants,
    systemAudio: options.systemAudio ?? true,
    emitStatus: (status) => statuses.push(status),
    emitProgress: (event) => progress.push(event),
    sendStop: (_owner, pageId) => stops.push(pageId),
    flushChanges: () => void repo.drainChanges(),
    freeBytes: async () => free.bytes,
    now: () => clock.t,
    chunkSeconds: options.chunkSeconds ?? 600,
    diskCheckMs: 30,
    ...(options.runWhisper ? { runWhisper: options.runWhisper } : {})
  })
  return { repo, service, grants, dir, statuses, progress, stops, free, clock }
}

async function record(w: World, pageId: string, parts: { mic: ArrayBuffer; system?: ArrayBuffer }[], system = true): Promise<string> {
  const { token } = await w.service.begin(OWNER, pageId, { sources: { micId: null, system } })
  // Sent the way the recorder sends: in batches well under the cap of one message.
  const step = PCM.sampleRate * 2
  let seq = 0
  for (const part of parts) {
    const other = part.system ?? silence(part.mic.byteLength / 2 / PCM.sampleRate)
    for (let from = 0; from < part.mic.byteLength; from += step) w.service.frames(OWNER, token, seq++, part.mic.slice(from, from + step), system ? other.slice(from, from + step) : null)
  }
  return token
}

async function transcribed(w: World, pageId: string): Promise<void> {
  await w.service.transcribe(pageId)
  await until(async () => !(await w.service.status()).transcribing, 'the transcription to finish')
}

describe('the Meetings database', () => {
  it('is created with the first meeting, once', () => {
    const w = world()
    const first = w.service.create(undefined)
    const second = w.service.create({ title: '  Weekly sync  ' })
    const databases = w.repo.listDatabases()
    expect(databases).toHaveLength(1)
    const database = databases[0]
    expect(plainText(database.props.title)).toBe('Meetings')
    expect(Object.values(database.props.schema ?? {}).map((property) => [property.name, property.type])).toEqual([
      ['Title', 'title'],
      ['Date', 'date'],
      ['Duration', 'number'],
      ['Status', 'select'],
      ['Attendees', 'text']
    ])
    expect(database.props.schema?.['status'].options?.map((option) => option.name)).toEqual(['Recording', 'Transcribing', 'Ready'])
    expect(database.content).toEqual([first.pageId, second.pageId])
    const page = w.repo.get(second.pageId)
    expect(plainText(page?.props.title)).toBe('Weekly sync')
    expect(page?.props.values?.['date']).toEqual({ start: '2026-10-13' })
    expect(plainText(w.repo.get(first.pageId)?.props.title)).toMatch(/^Meeting, /)
    // An ordinary page: it has a line to type notes on.
    expect(w.repo.children(second.pageId).map((block) => block.type)).toEqual(['text'])
  })

  it('adopts a database named Meetings and survives the user changing it', async () => {
    const w = world()
    const own = w.repo.create({ type: 'database', parentId: null, props: { title: [['meetings']] } })
    const { pageId } = w.service.create({ title: 'Call' })
    expect(w.repo.get(pageId)?.parentId).toBe(own.id)
    // No Status or Duration there: recording still works, the row is simply not written to.
    const token = await record(w, pageId, [{ mic: tone(1) }], false)
    await w.service.stop(OWNER, token)
    expect(w.repo.get(pageId)?.props.values ?? {}).toEqual({})
  })

  it('prefills a meeting from a calendar event', () => {
    const w = world()
    const start = new Date(2026, 9, 14, 9, 30).getTime()
    const { pageId } = w.service.create({ event: { title: 'Roadmap review', start, end: start + 45 * 60_000, location: 'Room 4', description: 'Bring\nthe numbers' } })
    const page = w.repo.get(pageId)
    expect(plainText(page?.props.title)).toBe('Roadmap review')
    expect(page?.props.values?.['date']).toEqual({ start: '2026-10-14' })
    expect(w.repo.children(pageId).map((block) => [block.type, plainText(block.props.title)])).toEqual([
      ['quote', '09:30–10:15 · Room 4'],
      ['quote', 'Bring the numbers'],
      ['text', '']
    ])
  })

  it('makes one page per occurrence of an event, and finds it again by its uid', () => {
    const w = world()
    const start = new Date(2026, 9, 14, 9, 30).getTime()
    const event = { title: 'Standup', start, end: start + 15 * 60_000, uid: 'abc@google.com' }
    const first = w.service.create({ event })
    expect(first.existing).toBeUndefined()
    expect(w.repo.get(first.pageId)?.props.meetingEvent).toEqual({ uid: 'abc@google.com', start })
    // The alarm's "Record" after "Just notes", or Today's button after the alarm: the same page.
    expect(w.service.create({ event: { ...event, title: 'Standup (renamed)' } })).toEqual({ pageId: first.pageId, existing: true })
    // The next day's occurrence of the series is a meeting of its own.
    const tomorrow = w.service.create({ event: { ...event, start: start + 86_400_000, end: start + 86_400_000 + 15 * 60_000 } })
    expect(tomorrow.pageId).not.toBe(first.pageId)
    // A page in the trash is not reused; an event without a uid always makes a new page.
    w.repo.delete(first.pageId)
    expect(w.service.create({ event }).pageId).not.toBe(first.pageId)
    const { uid: _uid, ...plain } = event
    expect(w.service.create({ event: plain }).pageId).not.toBe(w.service.create({ event: plain }).pageId)
    expect(meetingInput({ event: { ...event, uid: 'x'.repeat(401) } }).event?.uid).toBeUndefined()
  })

  it.each([
    ['a string', 'meeting'],
    ['an array', []],
    ['an event without times', { event: { title: 'x' } }],
    ['an event that ends before it starts', { event: { title: 'x', start: 10, end: 5 } }],
    ['an event with a string time', { event: { title: 'x', start: '1', end: 2 } }],
    ['a class instance', new Date()]
  ])('refuses %s as input', (_name, input) => {
    expect(() => meetingInput(input)).toThrow()
  })

  it('trims what it accepts', () => {
    expect(meetingInput({ title: 'a'.repeat(999), extra: 1 }).title).toHaveLength(MEETING_LIMITS.title)
    expect(meetingInput({ title: 'line\none\u0000' })).toEqual({ title: 'line one' })
    expect(meetingInput({ title: 5 })).toEqual({})
  })
})

describe('recording', () => {
  it('writes each stream to its own WAV, flushes as it goes, and finishes the files on stop', async () => {
    const w = world()
    const { pageId } = w.service.create({ title: 'Call' })
    const token = await record(w, pageId, [
      { mic: tone(1), system: silence(1) },
      { mic: silence(1), system: tone(1, 0.5) }
    ])
    const folder = join(w.dir, pageId)
    // Mid-recording: the samples are already on disk, under a header that still says "empty".
    expect(statSync(join(folder, 'mic.wav')).size).toBe(44 + 64_000)
    expect(statSync(join(folder, 'system.wav')).size).toBe(44 + 64_000)
    expect(w.repo.get(pageId)?.props.values?.['status']).toBe('recording')
    expect((await w.service.status()).recording).toMatchObject({ pageId, state: 'recording', elapsedMs: 2000, mic: true, system: true })
    expect((await w.service.info(pageId)).state).toBe('recording')

    w.service.encoded(OWNER, token, 'mic', 0, new Uint8Array([1, 2, 3]).buffer)
    const info = await w.service.stop(OWNER, token)
    expect(info).toMatchObject({ state: 'recorded', seconds: 2, transcriptPageId: null })
    expect(info.tracks).toEqual([
      { stream: 'mic', url: `sel-file://recordings/${pageId}/mic.webm`, format: 'webm' },
      { stream: 'system', url: `sel-file://recordings/${pageId}/system.wav`, format: 'wav' }
    ])
    const mic = readFileSync(join(folder, 'mic.wav'))
    const system = readFileSync(join(folder, 'system.wav'))
    expect(mic.readUInt32LE(40)).toBe(64_000)
    // The streams were not mixed: the first second is on the microphone only, the second on the computer only.
    expect(mic.readInt16LE(44 + 2 * 4001)).not.toBe(0)
    expect(system.readInt16LE(44 + 2 * 4001)).toBe(0)
    expect(mic.readInt16LE(44 + 2 * 20_001)).toBe(0)
    expect(system.readInt16LE(44 + 2 * 20_001)).not.toBe(0)
    // The empty compressed file of the stream that got no chunk is not kept.
    expect(readdirSync(folder).sort()).toEqual(['meeting.json', 'mic.wav', 'mic.webm', 'system.wav'])
    expect(w.repo.get(pageId)?.props.values).toMatchObject({ duration: 1 })
    expect(w.repo.get(pageId)?.props.values?.['status']).toBeUndefined()
    expect((await w.service.status()).recording).toBeNull()
    // The grant went with the recording.
    expect(w.grants.get(OWNER)).toBeNull()
  })

  it('records one meeting at a time, and each meeting once', async () => {
    const w = world()
    const a = w.service.create({ title: 'A' }).pageId
    const b = w.service.create({ title: 'B' }).pageId
    const token = await record(w, a, [{ mic: tone(1) }], false)
    await expect(w.service.begin(OWNER, b, { sources: { micId: null, system: false } })).rejects.toThrow(/Another meeting is being recorded/)
    await expect(w.service.begin(9, a, { sources: { micId: null, system: false } })).rejects.toThrow(/already being recorded/)
    await w.service.stop(OWNER, token)
    await expect(w.service.begin(OWNER, a, { sources: { micId: null, system: false } })).rejects.toThrow(/already has a recording/)
    expect((await w.service.begin(OWNER, b, { sources: { micId: null, system: false } })).token).not.toBe(token)
  })

  it.each([
    ['a page id that is not one', ['../../x', { sources: { micId: null, system: true } }]],
    ['no options', ['PAGE', undefined]],
    ['sources that are not an object', ['PAGE', { sources: 'mic' }]],
    ['a microphone id with a path in it', ['PAGE', { sources: { micId: '..\\..\\x', system: true } }]],
    ['a missing system flag', ['PAGE', { sources: { micId: null } }]],
    ['a file path smuggled in', ['PAGE', { sources: { micId: null, system: true }, path: 'C:\\x.wav', __proto__: null }]]
  ])('refuses to begin with %s', async (name, [id, options]) => {
    const w = world()
    const pageId = id === 'PAGE' ? w.service.create({}).pageId : id
    if (name === 'a file path smuggled in') {
      // Accepted, and the path is simply not something the service ever reads: files go where it decides.
      await w.service.begin(OWNER, pageId, options)
      expect(readdirSync(w.dir)).toEqual([pageId])
      return
    }
    await expect(w.service.begin(OWNER, pageId, options)).rejects.toThrow()
    expect(existsSync(w.dir) ? readdirSync(w.dir) : []).toEqual([])
    expect(w.grants.get(OWNER)).toBeNull()
  })

  it('refuses pages that do not exist or are in the Trash, and a disk that is nearly full', async () => {
    const w = world()
    await expect(w.service.begin(OWNER, '11111111-2222-4333-8444-555555555555', { sources: { micId: null, system: false } })).rejects.toThrow(/no longer exists/)
    const { pageId } = w.service.create({})
    w.free.bytes = MEETING_LIMITS.minFreeBytes - 1
    await expect(w.service.begin(OWNER, pageId, { sources: { micId: null, system: false } })).rejects.toThrow(/disk space/)
    w.free.bytes = 10 ** 10
    w.repo.delete(pageId)
    await expect(w.service.begin(OWNER, pageId, { sources: { micId: null, system: false } })).rejects.toThrow(/no longer exists/)
  })

  it('records the microphone only where the computer audio cannot be captured', async () => {
    const w = world({ systemAudio: false })
    const { pageId } = w.service.create({})
    const begun = await w.service.begin(OWNER, pageId, { sources: { micId: null, system: true } })
    expect(begun.system).toBe(false)
    expect((await w.service.status()).systemAudio).toBe(false)
    w.service.frames(OWNER, begun.token, 0, tone(1), null)
    expect(readdirSync(join(w.dir, pageId)).sort()).toEqual(['meeting.json', 'mic.wav', 'mic.webm'])
  })

  it('ignores frames from another window, with another token, and after the stop', async () => {
    const w = world()
    const { pageId } = w.service.create({})
    const token = await record(w, pageId, [{ mic: tone(1) }], false)
    const size = (): number => statSync(join(w.dir, pageId, 'mic.wav')).size
    const before = size()
    w.service.frames(6, token, 9, tone(1), null)
    w.service.frames(OWNER, 'nope', 9, tone(1), null)
    w.service.frames(OWNER, token, 0, tone(1), null)
    expect(size()).toBe(before)
    expect(() => w.service.pause(6, token)).toThrow(/No recording/)
    await expect(w.service.stop(OWNER, 'nope')).rejects.toThrow(/No recording/)
    await w.service.stop(OWNER, token)
    w.service.frames(OWNER, token, 9, tone(1), null)
    expect(size()).toBe(before)
  })

  it('ends the recording when the stream cannot be trusted, keeping what there is', async () => {
    const w = world()
    const { pageId } = w.service.create({})
    const token = await record(w, pageId, [{ mic: tone(1) }], false)
    w.service.frames(OWNER, token, 5, 'not bytes', null)
    await until(() => w.statuses.some((status) => status.notice?.reason === 'failed'), 'the recording to end')
    expect((await w.service.status()).recording).toBeNull()
    expect(w.stops).toEqual([pageId])
    expect(w.statuses.some((status) => status.notice?.reason === 'failed')).toBe(true)
    expect(await w.service.info(pageId)).toMatchObject({ state: 'recorded', seconds: 1 })
  })

  it('stops at the maximum duration and when the disk runs low', async () => {
    const w = world()
    w.repo.setSetting('meetings.maxHours', MEETING_LIMITS.maxHours.min)
    const { pageId } = w.service.create({})
    const { token } = await w.service.begin(OWNER, pageId, { sources: { micId: null, system: false } })
    const big = new ArrayBuffer(MEETING_LIMITS.frameSamples * 2)
    const batches = (MEETING_LIMITS.maxHours.min * 3600 * PCM.sampleRate) / MEETING_LIMITS.frameSamples
    for (let seq = 0; seq < batches; seq++) w.service.frames(OWNER, token, seq, big, null)
    expect((await w.service.status()).recording).not.toBeNull()
    w.service.frames(OWNER, token, batches, big, null)
    await until(() => w.statuses.some((status) => status.notice), 'the recording to stop at its maximum length')
    expect((await w.service.status()).recording).toBeNull()
    expect(w.statuses.find((status) => status.notice)?.notice).toEqual({ pageId, reason: 'max-duration' })
    expect((await w.service.info(pageId)).seconds).toBe(MEETING_LIMITS.maxHours.min * 3600)

    const other = w.service.create({}).pageId
    await record(w, other, [{ mic: tone(1) }], false)
    w.free.bytes = MEETING_LIMITS.stopFreeBytes - 1
    await until(() => w.statuses.some((status) => status.notice?.reason === 'disk-low'), 'the recording to stop on a full disk')
    expect((await w.service.status()).recording).toBeNull()
    expect(w.statuses.some((status) => status.notice?.reason === 'disk-low' && status.notice.pageId === other)).toBe(true)
    expect((await w.service.info(other)).state).toBe('recorded')
  })

  it('notices ten minutes of silence on both inputs, and sound coming back', async () => {
    const w = world()
    const { pageId } = w.service.create({})
    const { token } = await w.service.begin(OWNER, pageId, { sources: { micId: null, system: true } })
    let seq = 0
    w.service.frames(OWNER, token, seq++, tone(4), silence(4))
    const quiet = silence(4)
    for (let elapsed = 0; elapsed < MEETING_LIMITS.silenceMs - 4000; elapsed += 4000) w.service.frames(OWNER, token, seq++, quiet, quiet)
    expect((await w.service.status()).recording?.silent).toBe(false)
    w.service.frames(OWNER, token, seq++, quiet, quiet)
    expect((await w.service.status()).recording?.silent).toBe(true)
    // Only the computer plays something: that is not silence.
    w.service.frames(OWNER, token, seq++, quiet, tone(4))
    expect((await w.service.status()).recording?.silent).toBe(false)
    await w.service.stop(OWNER, token)
  })

  it('pauses and resumes', async () => {
    const w = world()
    const { pageId } = w.service.create({})
    const token = await record(w, pageId, [{ mic: tone(1) }], false)
    w.service.pause(OWNER, token)
    expect((await w.service.status()).recording?.state).toBe('paused')
    w.service.resume(OWNER, token)
    expect((await w.service.status()).recording?.state).toBe('recording')
  })

  it('leaves no trace of a recording that never got a sample', async () => {
    const w = world()
    const { pageId } = w.service.create({})
    const { token } = await w.service.begin(OWNER, pageId, { sources: { micId: null, system: true } })
    expect((await w.service.stop(OWNER, token)).state).toBe('none')
    expect(existsSync(join(w.dir, pageId))).toBe(false)
    expect(w.repo.get(pageId)?.props.values?.['status']).toBeUndefined()
    // And the meeting can be recorded after all.
    await w.service.begin(OWNER, pageId, { sources: { micId: null, system: false } })
  })

  it('keeps what was recorded when the window goes away', async () => {
    const w = world()
    const { pageId } = w.service.create({})
    await record(w, pageId, [{ mic: tone(2) }], false)
    await w.service.ownerGone(OWNER)
    expect(await w.service.info(pageId)).toMatchObject({ state: 'recorded', seconds: 2 })
    await until(() => w.statuses.some((status) => status.notice), 'the notice')
    expect(w.statuses[w.statuses.length - 1]?.notice).toEqual({ pageId, reason: 'interrupted' })
    expect(w.grants.get(OWNER)).toBeNull()
  })

  it('finds a recording an earlier run never stopped, and recovers or discards it', async () => {
    const w = world()
    const kept = w.service.create({ title: 'Crashed call' }).pageId
    const dropped = w.service.create({ title: 'Other' }).pageId
    for (const pageId of [kept, dropped]) {
      const token = await record(w, pageId, [{ mic: tone(3) }, { mic: tone(2) }], false)
      w.service.encoded(OWNER, token, 'mic', 0, new Uint8Array(64).buffer)
      // The app dies here. A new service over the same folder is the next launch.
      await w.service.ownerGone(999)
      ;(w.service as unknown as { live: unknown }).live = null
    }
    const next = new MeetingsService({
      repo: w.repo,
      dir: w.dir,
      engine: new WhisperEngine({ dir: join(w.dir, '..', 'whisper'), getSetting: () => null, setSetting: () => undefined }),
      grants: new GrantStore(),
      systemAudio: true,
      emitStatus: () => undefined,
      emitProgress: () => undefined,
      sendStop: () => undefined,
      flushChanges: () => undefined
    })
    const status = await next.status()
    expect(status.interrupted.map((entry) => [entry.pageId, entry.title, entry.seconds]).sort()).toEqual(
      [
        [kept, 'Crashed call', 5],
        [dropped, 'Other', 5]
      ].sort()
    )
    expect((await next.info(kept)).state).toBe('none')
    await expect(next.begin(OWNER, kept, { sources: { micId: null, system: false } })).rejects.toThrow(/unfinished recording/)

    const info = await next.recover(kept)
    expect(info).toMatchObject({ state: 'recorded', seconds: 5 })
    expect(readFileSync(join(w.dir, kept, 'mic.wav')).readUInt32LE(40)).toBe(5 * 32_000)
    expect(w.repo.get(kept)?.props.values).toMatchObject({ duration: 1 })
    await next.discard(dropped)
    expect(existsSync(join(w.dir, dropped))).toBe(false)
    expect((await next.status()).interrupted).toEqual([])
    await expect(next.recover(kept)).rejects.toThrow(/nothing to recover/)
    await expect(next.discard('../x')).rejects.toThrow()
  })
})

describe('transcription', () => {
  it('turns a recording into a Transcript page with Me and Others, then drops the large files', async () => {
    const w = world()
    const { pageId } = w.service.create({ title: 'Call' })
    const token = await record(w, pageId, [
      { mic: tone(5), system: silence(5) },
      { mic: silence(5), system: tone(5) },
      { mic: tone(5), system: silence(5) }
    ])
    w.service.encoded(OWNER, token, 'mic', 0, new Uint8Array(64).buffer)
    w.service.encoded(OWNER, token, 'system', 0, new Uint8Array(64).buffer)
    await w.service.stop(OWNER, token)
    await transcribed(w, pageId)

    const info = await w.service.info(pageId)
    expect(info.state).toBe('ready')
    expect(info.transcriptPageId).not.toBeNull()
    const transcript = w.repo.get(info.transcriptPageId ?? '')
    expect(transcript?.parentId).toBe(pageId)
    expect(plainText(transcript?.props.title)).toBe('Transcript')
    const lines = w.repo.children(transcript?.id ?? '').map((block) => plainText(block.props.title))
    expect(lines).toEqual(['00:00 Me: At 00:00 I said something.', '00:05 Others: At 00:05 the others said something.', '00:10 Me: At 00:10 I said something.'])
    const first = w.repo.children(transcript?.id ?? '')[0].props.title
    expect(first?.[0]).toEqual(['00:00', [['c']]])
    expect(first?.[2]).toEqual(['Me', [['b']]])
    expect(w.repo.get(pageId)?.props.values).toMatchObject({ status: 'ready', duration: 1 })
    // The originals are gone, the compact copies and the transcript stay.
    expect(readdirSync(join(w.dir, pageId)).sort()).toEqual(['meeting.json', 'mic.webm', 'system.webm', 'transcript.json'])
    expect(w.progress.filter((event) => event.kind === 'transcribe').map((event) => (event.kind === 'transcribe' ? event.percent : 0)).pop()).toBe(100)
    expect(info.tracks.map((track) => track.format)).toEqual(['webm', 'webm'])
    // Without the originals it cannot be transcribed again, and says so.
    await expect(w.service.transcribe(pageId)).rejects.toThrow(/no longer here/)
  })

  it('keeps the originals when asked to, and transcribes again over the same page', async () => {
    const w = world()
    w.repo.setSetting('meetings.keepOriginal', true)
    w.repo.setSetting('meetings.language', 'pt')
    const { pageId } = w.service.create({})
    const token = await record(w, pageId, [{ mic: tone(5) }], false)
    w.service.encoded(OWNER, token, 'mic', 0, new Uint8Array(64).buffer)
    await w.service.stop(OWNER, token)
    await transcribed(w, pageId)
    const first = (await w.service.info(pageId)).transcriptPageId
    expect(readdirSync(join(w.dir, pageId)).sort()).toEqual(['meeting.json', 'mic.wav', 'mic.webm', 'transcript.json'])
    await transcribed(w, pageId)
    expect((await w.service.info(pageId)).transcriptPageId).toBe(first)
    expect(w.repo.children(pageId).filter((block) => block.type === 'page')).toHaveLength(1)
    expect(w.repo.children(first ?? '').map((block) => plainText(block.props.title))).toEqual(['00:00 Me: At 00:00 I said something em português.'])
  })

  it('works through a long recording in pieces, and a failed piece is the only one done again', async () => {
    const calls: string[] = []
    let fail = true
    const w = world({
      chunkSeconds: 10,
      runWhisper: async (run) => {
        const name = run.args.input.split(/[\\/]/).pop() ?? ''
        calls.push(name)
        run.onProgress?.(50)
        if (name === 'mic.0001.wav' && fail) throw new WhisperError('failed', 'boom')
        // The second piece is told the language the first one was heard in.
        return { language: 'pt', segments: [{ start: 1, end: 3, text: ` said in ${name} as ${run.args.language}` }] }
      }
    })
    const { pageId } = w.service.create({})
    const token = await record(w, pageId, [{ mic: tone(4) }, { mic: tone(4) }, { mic: tone(4) }, { mic: tone(4) }, { mic: tone(4) }, { mic: tone(4) }, { mic: tone(1) }], false)
    await w.service.stop(OWNER, token)
    await transcribed(w, pageId)
    expect(calls).toEqual(['mic.0000.wav', 'mic.0001.wav'])
    const failed = await w.service.info(pageId)
    expect(failed).toMatchObject({ state: 'failed', error: 'The transcription program failed. (boom)' })
    expect(w.repo.get(pageId)?.props.values?.['status']).toBeUndefined()
    // The piece that worked is kept, its audio is not.
    expect(readdirSync(join(w.dir, pageId, 'chunks'))).toEqual(['mic.0000.done.json'])

    fail = false
    await transcribed(w, pageId)
    expect(calls).toEqual(['mic.0000.wav', 'mic.0001.wav', 'mic.0001.wav', 'mic.0002.wav'])
    const info = await w.service.info(pageId)
    expect(info.state).toBe('ready')
    expect(w.repo.children(info.transcriptPageId ?? '').map((block) => plainText(block.props.title))).toEqual([
      // Times are those of the whole recording, not of the piece. Three pieces of one speaker, close together: one paragraph.
      '00:01 Me: said in mic.0000.wav as auto said in mic.0001.wav as pt said in mic.0002.wav as pt'
    ])
    expect(existsSync(join(w.dir, pageId, 'chunks'))).toBe(false)
    const percents = w.progress.flatMap((event) => (event.kind === 'transcribe' ? [event.percent] : []))
    expect(percents).toContain(16)
    expect(percents[percents.length - 1]).toBe(100)
  })

  it('does not send silence to the program, and says when nothing was said', async () => {
    const calls: string[] = []
    const w = world({ runWhisper: async (run) => (calls.push(run.args.input), { language: 'en', segments: [] }) })
    const { pageId } = w.service.create({})
    const token = await record(w, pageId, [{ mic: silence(4), system: silence(4) }])
    await w.service.stop(OWNER, token)
    await transcribed(w, pageId)
    expect(calls).toEqual([])
    const info = await w.service.info(pageId)
    expect(w.repo.children(info.transcriptPageId ?? '').map((block) => plainText(block.props.title))).toEqual(['No speech was found in this recording.'])
  })

  it('can be cancelled, which kills the program and leaves the meeting as it was', async () => {
    const w = world()
    const { pageId } = w.service.create({})
    const token = await record(w, pageId, [{ mic: tone(5) }], false)
    await w.service.stop(OWNER, token)
    writeFileSync(join(w.dir, pageId, 'fake-whisper'), 'hang')
    await w.service.transcribe(pageId)
    await expect(w.service.transcribe(pageId)).rejects.toThrow(/already being transcribed/)
    const pids = join(w.dir, pageId, 'fake-whisper-pids')
    await until(() => existsSync(pids) && readFileSync(pids, 'utf8').trim() !== '', 'the program to start')
    const pid = Number(readFileSync(pids, 'utf8'))
    await w.service.cancelTranscribe(pageId)
    await until(async () => (await w.service.status()).transcribing === null, 'the transcription to stop')
    expect((await w.service.info(pageId)).state).toBe('recorded')
    const alive = (): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    await until(() => !alive(), 'the program to be killed')
  })

  it('explains what is missing', async () => {
    const w = world({ engine: false })
    const { pageId } = w.service.create({})
    await expect(w.service.transcribe(pageId)).rejects.toThrow(/no recording/)
    const token = await record(w, pageId, [{ mic: tone(1) }], false)
    await expect(w.service.transcribe(pageId)).rejects.toThrow(/still being recorded/)
    await w.service.stop(OWNER, token)
    await expect(w.service.transcribe(pageId)).rejects.toThrow(/not set up yet/)
  })

  it('renames the speakers in the transcript, swapping included', async () => {
    const w = world({ runWhisper: async (run) => ({ language: 'en', segments: [{ start: 0, end: 1, text: /system/.test(run.args.input) ? ' Others said this.' : ' Me said that.' }] }) })
    const { pageId } = w.service.create({})
    const token = await record(w, pageId, [{ mic: tone(2), system: tone(2) }])
    await w.service.stop(OWNER, token)
    await transcribed(w, pageId)
    const transcriptId = (await w.service.info(pageId)).transcriptPageId ?? ''
    const lines = (): string[] => w.repo.children(transcriptId).map((block) => plainText(block.props.title))
    expect(lines()).toEqual(['00:00 Me: Me said that.', '00:00 Others: Others said this.'])
    expect((await w.service.setSpeakers(pageId, { mic: 'Érik', system: 'Ana & Rui' })).speakers).toEqual({ mic: 'Érik', system: 'Ana & Rui' })
    expect(lines()).toEqual(['00:00 Érik: Me said that.', '00:00 Ana & Rui: Others said this.'])
    await w.service.setSpeakers(pageId, { mic: 'Ana & Rui', system: 'Érik' })
    expect(lines()).toEqual(['00:00 Ana & Rui: Me said that.', '00:00 Érik: Others said this.'])
    await expect(w.service.setSpeakers(pageId, { mic: 'Same', system: 'Same' })).rejects.toThrow(/different names/)
    await expect(w.service.setSpeakers(pageId, 'Me')).rejects.toThrow()
  })
})

describe('audio on disk', () => {
  it('deletes the audio and keeps the transcript; prunes by age; measures storage', async () => {
    const w = world({ runWhisper: async () => ({ language: 'en', segments: [{ start: 0, end: 1, text: ' Hello.' }] }) })
    w.repo.setSetting('meetings.keepOriginal', true)
    const ids: string[] = []
    for (const title of ['Old', 'New']) {
      const { pageId } = w.service.create({ title })
      const token = await record(w, pageId, [{ mic: tone(2) }], false)
      w.service.encoded(OWNER, token, 'mic', 0, new Uint8Array(64).buffer)
      await w.service.stop(OWNER, token)
      await transcribed(w, pageId)
      ids.push(pageId)
      w.clock.t += 10 * 24 * 3600 * 1000
    }
    const before = await w.service.storage()
    expect(before.meetings).toBe(2)
    expect(before.bytes).toBeGreaterThan(2 * 64_000)

    // Nothing is pruned unless asked for; seven days takes the first meeting (20 days old) and the second (10 days).
    expect(await w.service.prune()).toBe(0)
    w.repo.setSetting('meetings.deleteAfterDays', 30)
    expect(await w.service.prune()).toBe(0)
    w.repo.setSetting('meetings.deleteAfterDays', 7)
    w.clock.t -= 5 * 24 * 3600 * 1000
    expect(await w.service.prune()).toBe(1)
    const old = await w.service.info(ids[0])
    expect(old).toMatchObject({ state: 'ready', tracks: [] })
    expect(old.transcriptPageId).not.toBeNull()
    expect(readdirSync(join(w.dir, ids[0])).sort()).toEqual(['meeting.json', 'transcript.json'])
    expect((await w.service.info(ids[1])).tracks).toHaveLength(1)

    const info = await w.service.deleteAudio(ids[1])
    expect(info.tracks).toEqual([])
    expect(w.repo.get(info.transcriptPageId ?? '')).not.toBeNull()
    expect((await w.service.storage()).bytes).toBeLessThan(5000)
    await expect(w.service.deleteAudio('..')).rejects.toThrow()
  })

  it('does not delete what is being recorded', async () => {
    const w = world()
    const { pageId } = w.service.create({})
    await record(w, pageId, [{ mic: tone(1) }], false)
    await expect(w.service.deleteAudio(pageId)).rejects.toThrow(/being recorded/)
  })
})

describe('transcripts', () => {
  const seg = (start: number, end: number, text: string): Segment => ({ start, end, text })

  it('drops what is not speech', () => {
    expect(
      cleanSegments([
        seg(0, 2, ' [BLANK_AUDIO]'),
        seg(2, 4, '  '),
        seg(4, 6, ' (music)'),
        seg(6, 8, ' ♪♪'),
        seg(8, 10, ' *sighs*'),
        seg(10, 12, ' [MUSIC] (applause)'),
        seg(12, 14, ' ...'),
        seg(14, 16, ' Real   words here. '),
        seg(Number.NaN, 3, ' Odd times.'),
        seg(20, 18, ' Ends before it starts.')
      ])
    ).toEqual([seg(0, 3, 'Odd times.'), seg(14, 16, 'Real words here.'), seg(20, 20, 'Ends before it starts.')])
  })

  it('cuts a sentence the model repeats over and over', () => {
    const loop = Array.from({ length: 12 }, (_, i) => seg(10 + i * 2, 12 + i * 2, ' So, yeah.'))
    const cleaned = cleanSegments([seg(0, 5, ' We start.'), ...loop, seg(40, 45, ' And we end.')])
    expect(cleaned.map((segment) => segment.text)).toEqual(['We start.', 'So, yeah.', 'So, yeah.', 'And we end.'])
  })

  it('drops the stock phrases of silence only when they stand alone', () => {
    expect(cleanSegments([seg(0, 5, ' Let us begin.'), seg(60, 62, ' Thank you.'), seg(120, 125, ' Next point.')]).map((segment) => segment.text)).toEqual(['Let us begin.', 'Next point.'])
    expect(cleanSegments([seg(0, 5, ' That is all from me.'), seg(5, 6, ' Thank you.'), seg(7, 9, ' Great.')]).map((segment) => segment.text)).toEqual(['That is all from me.', 'Thank you.', 'Great.'])
    expect(cleanSegments([seg(30, 32, ' Legendas pela comunidade Amara.org')])).toEqual([])
  })

  it('merges the two streams by time into paragraphs per speaker', () => {
    const paragraphs = mergeTranscript(
      [seg(0, 4, ' Hi, can you hear me?'), seg(4, 6, ' I will share my screen.'), seg(30, 33, ' Right.'), seg(120, 124, ' Back to the agenda.')],
      [seg(7, 12, ' Yes, loud and clear.'), seg(12, 20, ' Go ahead.'), seg(20, 22, ' [BLANK_AUDIO]'), seg(40, 44, ' So the launch moves to May.')]
    )
    expect(paragraphs.map((paragraph) => [paragraph.stream, paragraph.start, paragraph.text])).toEqual([
      ['mic', 0, 'Hi, can you hear me? I will share my screen.'],
      ['system', 7, 'Yes, loud and clear. Go ahead.'],
      ['mic', 30, 'Right.'],
      ['system', 40, 'So the launch moves to May.'],
      ['mic', 120, 'Back to the agenda.']
    ])
    expect(transcriptText(paragraphs.slice(0, 2), { mic: 'Me', system: 'Others' })).toBe('[00:00] Me: Hi, can you hear me? I will share my screen.\n[00:07] Others: Yes, loud and clear. Go ahead.')
  })

  it('starts a new paragraph after a long pause or a long stretch, and orders ties', () => {
    expect(mergeTranscript([seg(0, 2, ' One.'), seg(30, 32, ' Two.')], [])).toHaveLength(2)
    const long = Array.from({ length: 30 }, (_, i) => seg(i * 3, i * 3 + 3, ` Sentence number ${i} ${'word '.repeat(10)}`))
    expect(mergeTranscript(long, []).length).toBeGreaterThan(1)
    expect(mergeTranscript([seg(5, 6, ' Mine.')], [seg(5, 6, ' Theirs.')]).map((paragraph) => paragraph.stream)).toEqual(['mic', 'system'])
    expect(mergeTranscript([], [])).toEqual([])
  })

  it('writes and reads back the blocks of a transcript page', () => {
    const spans = paragraphSpans({ stream: 'system', start: 3725, end: 3730, text: 'Hello there.' }, { mic: 'Me', system: 'Others' })
    expect(spans).toEqual([['1:02:05', [['c']]], [' '], ['Others', [['b']]], [': Hello there.']])
    expect(transcriptFromTitles([spans, undefined, [], [['A line the user added.']]])).toBe('[1:02:05] Others: Hello there.\nA line the user added.')
    expect(renameSpeakerSpans(spans, 'Others', 'Ana')).toEqual([['1:02:05', [['c']]], [' '], ['Ana', [['b']]], [': Hello there.']])
    // Only the label is renamed: the same word in the text, or in a line the user wrote, stays.
    expect(renameSpeakerSpans([['Others', [['b']]], [' said Others']], 'Others', 'Ana')).toBeNull()
    expect(renameSpeakerSpans([['Others think so.']], 'Others', 'Ana')).toBeNull()
    expect(cleanSpeaker('  Ana:\n*Rui*  ', 'Me')).toBe('Ana Rui')
    expect(cleanSpeaker('', 'Me')).toBe('Me')
    expect(cleanSpeaker(5, 'Me')).toBe('Me')
  })

  it('formats and parses times', () => {
    expect(clockTime(0)).toBe('00:00')
    expect(clockTime(754.9)).toBe('12:34')
    expect(clockTime(3725)).toBe('1:02:05')
    expect(parseClockTime('12:34')).toBe(754)
    expect(parseClockTime('1:02:05')).toBe(3725)
    expect(parseClockTime('12.34')).toBeNull()
  })
})

describe('meetings settings', () => {
  it('lets a renderer write the listed keys, typed, and never a path', () => {
    for (const key of MEETINGS_KEYS) expect(arg.isWritableSetting(key)).toBe(true)
    for (const key of ['meetings.databaseId', 'meetings.whisperVersion', 'meetings.anything']) expect(arg.isWritableSetting(key)).toBe(false)
    expect(arg.settingValueFor('meetings.model', 'medium')).toBe('medium')
    expect(arg.settingValueFor('meetings.language', 'pt')).toBe('pt')
    expect(arg.settingValueFor('meetings.keepOriginal', true)).toBe(true)
    expect(arg.settingValueFor('meetings.deleteAfterDays', 30)).toBe(30)
    expect(arg.settingValueFor('meetings.maxHours', 99)).toBe(MEETING_LIMITS.maxHours.max)
    expect(arg.settingValueFor('meetings.defaultMic', { id: 'abc123', label: 'USB  mic\n', extra: 1 })).toEqual({ id: 'abc123', label: 'USB mic' })
    // Clearing a path is allowed; naming one is not.
    expect(arg.settingValueFor('meetings.whisperPath', null)).toBeNull()
    expect(arg.settingValueFor('meetings.modelPath', undefined)).toBeNull()
    for (const [key, value] of [
      ['meetings.whisperPath', 'C:\\Windows\\System32\\cmd.exe'],
      ['meetings.modelPath', '\\\\server\\share\\model.bin'],
      ['meetings.model', 'tiny.en'],
      ['meetings.model', '../../x'],
      ['meetings.language', 'klingon'],
      ['meetings.keepOriginal', 'yes'],
      ['meetings.deleteAfterDays', 1],
      ['meetings.maxHours', '4'],
      ['meetings.defaultMic', { id: '../x', label: 'm' }],
      ['meetings.defaultMic', 'default'],
      ['meetings.consentReminder', 0]
    ] as const) {
      expect(() => arg.settingValueFor(key, value), `${key}=${String(value)}`).toThrow()
    }
    expect(cleanMeetingsSetting('meetings.databaseId', 'x')).toBeUndefined()
  })
})

suite('recordings and sync', () => {
  it('never puts anything of a recording into the repository', async () => {
    const { remote, a, b, pageId } = await pair()
    // A meeting on device A: a real recording next to the files sync does carry, a transcript page,
    // and even a block that points at the audio.
    const recordings = join(a.dir, 'recordings')
    const grants = new GrantStore()
    const service = new MeetingsService({
      repo: a.repo,
      dir: recordings,
      engine: new WhisperEngine({ dir: join(a.dir, 'whisper'), getSetting: (key) => (key === 'meetings.modelPath' ? join(a.dir, 'model.bin') : null), setSetting: () => undefined, devProgram: FAKE, platformKey: 'none' }),
      grants,
      systemAudio: true,
      emitStatus: () => undefined,
      emitProgress: () => undefined,
      sendStop: () => undefined,
      flushChanges: () => void a.repo.drainChanges(),
      // The test must not depend on how full the disk of the machine running it is.
      freeBytes: async () => 10 ** 10,
      runWhisper: async () => ({ language: 'en', segments: [{ start: 0, end: 1, text: ' The secret plan.' }] })
    })
    writeFileSync(join(a.dir, 'model.bin'), Buffer.alloc(2 * 1024 * 1024))
    const meeting = service.create({ title: 'Board call' }).pageId
    const { token } = await service.begin(1, meeting, { sources: { micId: null, system: true } })
    service.frames(1, token, 0, tone(2), tone(2))
    service.encoded(1, token, 'mic', 0, new Uint8Array(64).buffer)
    await service.stop(1, token)
    await service.transcribe(meeting)
    await until(async () => !(await service.status()).transcribing, 'the transcription to finish')
    a.repo.setSetting('meetings.keepOriginal', true)
    a.repo.create({ type: 'image', parentId: pageId, props: { url: `sel-file://recordings/${meeting}/mic.webm` } })
    a.repo.create({ type: 'image', parentId: pageId, props: { url: `sel-file://files/../recordings/${meeting}/mic.webm` } })
    // A recording dropped into the images folder by hand is not an image either.
    writeFileSync(join(a.filesDir, 'mic.webm'), 'audio')
    writeFileSync(join(a.filesDir, 'mic.wav'), 'audio')
    expect(readdirSync(join(recordings, meeting)).length).toBeGreaterThan(1)

    await sync(a, b)
    const files = remoteFiles(remote)
    const names = [...files.keys()]
    expect(names.some((name) => name.startsWith('pages/'))).toBe(true)
    for (const name of names) {
      expect(name).not.toMatch(/recordings/i)
      expect(name).not.toMatch(/\.(wav|webm|opus|ogg|mp3|m4a)$/i)
      expect(name).not.toMatch(/whisper|ggml|meeting\.json|transcript\.json/i)
    }
    // Nothing that is in the recordings folder is in the repository under any name.
    const audio = readdirSync(join(recordings, meeting)).map((name) => readFileSync(join(recordings, meeting, name)))
    for (const [name, bytes] of files) for (const recorded of audio) expect(bytes.equals(recorded), name).toBe(false)
    // The meeting itself, its transcript text and its notes are ordinary pages and do travel.
    expect(b.titles()).toContain('Meetings')
    const there = b.repo.get(meeting)
    expect(plainText(there?.props.title)).toBe('Board call')
    const transcript = b.repo.children(meeting).find((block) => block.type === 'page')
    expect(b.repo.children(transcript?.id ?? '').map((block) => plainText(block.props.title))).toEqual(['00:00 Me: The secret plan.', '00:00 Others: The secret plan.'])
    // And device B has no recordings folder at all.
    expect(existsSync(join(b.dir, 'recordings'))).toBe(false)
  })

  it('has a device helper that matches the layout the test relies on', () => {
    const d = device('layout', 1)
    expect(d.filesDir).toBe(join(d.dir, 'files'))
  })
})
