import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanFeedbackInput, FEEDBACK_LIMITS, newFeedbackId, parseFeedbackItem } from '../../shared/feedback'
import { FeedbackStore } from './store'

let dir: string
let store: FeedbackStore
let clock = Date.UTC(2026, 9, 14, 7, 30, 12)

beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'sel-feedback-')), 'feedback')
  store = new FeedbackStore(dir, { appVersion: '0.2.0', platform: 'win32' }, () => new Date((clock += 1000)))
})

afterEach(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true })
})

describe('cleanFeedbackInput', () => {
  it('keeps a valid input and collapses the title to one line', () => {
    expect(
      cleanFeedbackInput({ kind: 'bug', title: '  Table\n  breaks ', description: ' a\nb ', screen: 'page', attachLog: false })
    ).toEqual({
      kind: 'bug',
      title: 'Table breaks',
      description: 'a\nb',
      screen: 'page',
      attachLog: false
    })
  })

  it('rejects a missing title, an unknown kind and other shapes', () => {
    expect(() => cleanFeedbackInput({ kind: 'bug', title: '   ', description: '', screen: 'page', attachLog: false })).toThrow()
    expect(() => cleanFeedbackInput({ kind: 'idea', title: 'x', description: '', screen: 'page', attachLog: false })).toThrow()
    expect(() => cleanFeedbackInput(['bug'])).toThrow()
    expect(() => cleanFeedbackInput(null)).toThrow()
  })

  it('replaces a screen it does not recognise', () => {
    expect(cleanFeedbackInput({ kind: 'suggestion', title: 'x', description: '', screen: '../etc' }).screen).toBe('none')
  })
})

describe('parseFeedbackItem', () => {
  const base = {
    id: newFeedbackId(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), 'abcd'),
    kind: 'suggestion',
    title: 'Dark mode for charts',
    description: '',
    status: 'in-review',
    createdAt: '2026-01-02T03:04:05.000Z'
  }

  it('fills what an agent may have left out', () => {
    const item = parseFeedbackItem(base)
    expect(item?.id).toBe('fb-20260102-030405-abcd')
    expect(item?.resolution).toBeNull()
    expect(item?.updatedAt).toBe(base.createdAt)
  })

  it('keeps only github pull request links', () => {
    const ok = parseFeedbackItem({ ...base, resolution: { pr: 'https://github.com/erik-sc/sel/pull/7', note: 'Done' } })
    expect(ok?.resolution).toEqual({ pr: 'https://github.com/erik-sc/sel/pull/7', branch: null, note: 'Done' })
    const bad = parseFeedbackItem({ ...base, resolution: { pr: 'javascript:alert(1)' } })
    expect(bad?.resolution?.pr).toBeNull()
  })

  it('refuses an unknown status or a bad id', () => {
    expect(parseFeedbackItem({ ...base, status: 'maybe' })).toBeNull()
    expect(parseFeedbackItem({ ...base, id: '../x' })).toBeNull()
  })
})

describe('FeedbackStore', () => {
  it('lists nothing before anything was written', async () => {
    expect(await store.list()).toEqual([])
  })

  it('writes one file per item with a README beside them, newest first', async () => {
    const first = await store.create({ kind: 'bug', title: 'First', description: 'steps', screen: 'today', attachLog: false })
    const second = await store.create({ kind: 'suggestion', title: 'Second', description: '', screen: 'page', attachLog: false })
    expect((await readdir(dir)).sort()).toEqual(['README.md', `${first.id}.json`, `${second.id}.json`].sort())
    expect((await store.list()).map((item) => item.title)).toEqual(['Second', 'First'])
    const onDisk = JSON.parse(await readFile(join(dir, `${first.id}.json`), 'utf8'))
    expect(onDisk).toMatchObject({ status: 'open', context: { appVersion: '0.2.0', platform: 'win32', screen: 'today' }, log: null })
  })

  it('reads what the agent changed and skips files it cannot read', async () => {
    const item = await store.create({ kind: 'bug', title: 'Crash', description: '', screen: 'page', attachLog: false })
    const file = join(dir, `${item.id}.json`)
    const edited = {
      ...item,
      status: 'in-review',
      resolution: { pr: 'https://github.com/erik-sc/sel/pull/9', branch: 'nightly/x', note: null }
    }
    await writeFile(file, JSON.stringify(edited))
    await writeFile(join(dir, 'fb-20260101-000000-zzzz.json'), '{ not json')
    const [read] = await store.list()
    expect(read.status).toBe('in-review')
    expect(read.resolution?.pr).toBe('https://github.com/erik-sc/sel/pull/9')
    expect(await store.list()).toHaveLength(1)
  })

  it('attaches the last lines of the log only when asked, within the limits', async () => {
    const lines = Array.from({ length: 150 }, (_, index) => `2026-01-01T00:00:00.000Z error line ${index}`)
    const withLog = new FeedbackStore(dir, { appVersion: '0.2.0', platform: 'win32', logTail: () => lines })
    const without = await withLog.create({ kind: 'bug', title: 'No log', description: '', screen: 'page', attachLog: false })
    expect(without.log).toBeNull()
    const attached = await withLog.create({ kind: 'bug', title: 'With log', description: '', screen: 'page', attachLog: true })
    expect(attached.log).toHaveLength(FEEDBACK_LIMITS.logLines)
    expect(attached.log?.at(-1)).toBe('2026-01-01T00:00:00.000Z error line 149')
    // What the dialog shows before saving is what is attached.
    expect(withLog.logTail()).toEqual(attached.log)
    const read = (await withLog.list()).find((item) => item.id === attached.id)
    expect(read?.log).toEqual(attached.log)
    expect(cleanFeedbackInput({ kind: 'bug', title: 'x', description: '', screen: 'page', attachLog: 'yes' }).attachLog).toBe(false)
  })

  it('withdraws only open items', async () => {
    const open = await store.create({ kind: 'bug', title: 'Open', description: '', screen: 'none', attachLog: false })
    await store.withdraw(open.id)
    expect(await store.list()).toEqual([])

    const taken = await store.create({ kind: 'bug', title: 'Taken', description: '', screen: 'none', attachLog: false })
    const file = join(dir, `${taken.id}.json`)
    await writeFile(file, JSON.stringify({ ...taken, status: 'in-progress' }))
    await expect(store.withdraw(taken.id)).rejects.toThrow()
    await expect(store.withdraw('../../etc/passwd')).rejects.toThrow()
  })
})
