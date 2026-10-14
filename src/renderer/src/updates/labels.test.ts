import { describe, expect, it } from 'vitest'
import { emptyUpdateStatus, type UpdateStatus } from '../../../shared/updates'
import { nextAction, noticeFor, statusLine } from './labels'

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({ ...emptyUpdateStatus('0.2.0', true), ...patch })
const offer = { version: '0.3.0', notesUrl: 'https://github.com/erik-sc/sel/releases/tag/v0.3.0' }

describe('the update notice', () => {
  it('appears only when there is a new version', () => {
    expect(noticeFor(null)).toBeNull()
    for (const phase of ['idle', 'checking', 'current'] as const) expect(noticeFor(status({ phase })), phase).toBeNull()
    // A check that failed is not worth interrupting anyone for.
    expect(noticeFor(status({ phase: 'error', error: 'sel could not reach GitHub to look for a new version.' }))).toBeNull()
  })

  it('offers the download or Later, with the release notes', () => {
    const notice = noticeFor(status({ phase: 'available', ...offer }))
    expect(notice).toMatchObject({ message: 'sel 0.3.0 is available.', notesUrl: offer.notesUrl, percent: null })
    expect(notice?.actions.map((action) => action.id)).toEqual(['download', 'later'])
  })

  it('shows the progress of the download', () => {
    expect(noticeFor(status({ phase: 'downloading', percent: 42, ...offer }))).toMatchObject({ message: 'Downloading sel 0.3.0…', percent: 42 })
  })

  it('offers Restart now once downloaded, and says Later installs it on quit', () => {
    const notice = noticeFor(status({ phase: 'ready', ...offer }))
    expect(notice?.message).toBe('sel 0.3.0 is ready. Restart to use it, or it is installed when you quit.')
    expect(notice?.actions.map((action) => action.id)).toEqual(['restart', 'later'])
  })

  it('offers to try a failed download again', () => {
    const notice = noticeFor(status({ phase: 'error', error: 'The download did not finish. Try again later.', ...offer }))
    expect(notice?.actions.map((action) => [action.id, action.label])).toEqual([['download', 'Try again'], ['later', 'Later']])
  })

  it('goes away after Later', () => {
    expect(noticeFor(status({ phase: 'available', dismissed: true, ...offer }))).toBeNull()
  })
})

describe('Settings → Updates', () => {
  it('says when updates do not apply to this build, and offers nothing', () => {
    const dev = status({ supported: false })
    expect(statusLine(dev)).toBe('Updates work only in the installed app.')
    expect(nextAction(dev)).toMatchObject({ id: 'check', busy: true })
  })

  it('offers what can be done next', () => {
    expect(nextAction(status())).toEqual({ id: 'check', label: 'Check now', busy: false })
    expect(nextAction(status({ phase: 'checking' }))).toMatchObject({ busy: true })
    expect(nextAction(status({ phase: 'current' }))).toMatchObject({ id: 'check' })
    expect(nextAction(status({ phase: 'available', ...offer }))).toMatchObject({ id: 'download', busy: false })
    expect(nextAction(status({ phase: 'downloading', ...offer }))).toMatchObject({ busy: true })
    expect(nextAction(status({ phase: 'ready', ...offer }))).toMatchObject({ id: 'restart', label: 'Restart now' })
    expect(nextAction(status({ phase: 'error', error: 'x' }))).toMatchObject({ id: 'check' })
    expect(nextAction(status({ phase: 'error', error: 'x', ...offer }))).toMatchObject({ id: 'download', label: 'Try again' })
  })

  it('describes the state in a line', () => {
    expect(statusLine(status())).toBe('Not checked yet.')
    expect(statusLine(status({ phase: 'current' }))).toBe('This is the newest version.')
    expect(statusLine(status({ phase: 'downloading', percent: 7, ...offer }))).toBe('Downloading sel 0.3.0… 7%')
    expect(statusLine(status({ phase: 'ready', ...offer }))).toBe('sel 0.3.0 is ready. It is installed when you quit sel.')
  })
})
