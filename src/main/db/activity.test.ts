import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACTIVITY_ENABLED_KEY } from '../../shared/activity'
import { syncedAtOf } from '../../shared/settings'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import type { BlockProps } from '../../shared/types'
import { ACTIVITY_BUFFER_MAX, retentionCutoff, taskEvents } from './activity'
import type { SqlDriver } from './driver'
import type { Repository } from './repository'
import { Repository as Repo } from './repository'
import { SCHEMA_VERSION } from './schema'
import { ensureTasksDatabase } from './tasks'
import { openTestDatabase } from './testing'

const MINUTE = 60_000
const T0 = new Date(2026, 9, 22, 9, 0, 0).getTime()

let t = T0
let repo: Repository
let db: SqlDriver

beforeEach(() => {
  t = T0
  ;({ repo, db } = openTestDatabase(':memory:', { clock: () => t }))
})

afterEach(() => {
  try {
    repo.close()
  } catch {
    /* closed by the test */
  }
})

const stored = (): { kind: string; area: string | null; page_id: string | null; project: string | null; count: number; at: number }[] =>
  db.prepare('SELECT kind, area, page_id, project, count, at FROM activity ORDER BY id').all() as never

const page = (title = 'Page'): string => repo.create({ type: 'page', parentId: null, props: { title: [[title]] } }).id
const line = (parentId: string, text = 'x'): string => repo.create({ type: 'text', parentId, props: { title: [[text]] } }).id

describe('the activity table', () => {
  it('is created by migration 7, and an older database gets it on open', () => {
    expect(SCHEMA_VERSION).toBe(7)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(7)
    db.exec('DROP TABLE activity; PRAGMA user_version = 6;')
    const reopened = new Repo(db)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE tbl_name = 'activity'").all() as { name: string }[]).map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['activity', 'activity_at_idx', 'activity_edit_idx']))
    reopened.activity.record({ kind: 'open', area: 'today' })
    expect(reopened.activity.flush()).toBe(1)
  })
})

describe('recording', () => {
  it('keeps events in memory until a flush writes them in one go', () => {
    repo.activity.record({ kind: 'open', area: 'today' })
    t += 1000
    repo.activity.record({ kind: 'ai', area: 'ask' })
    repo.activity.record({ kind: 'focus.finish', minutes: 25 })
    expect(stored()).toEqual([])
    expect(repo.activity.pending()).toBe(3)
    expect(repo.activity.flush()).toBe(3)
    expect(stored().map((r) => [r.kind, r.area, r.at])).toEqual([
      ['open', 'today', T0],
      ['ai', 'ask', T0 + 1000],
      ['focus.finish', null, T0 + 1000]
    ])
    expect((db.prepare("SELECT minutes FROM activity WHERE kind = 'focus.finish'").get() as { minutes: number }).minutes).toBe(25)
    expect(repo.activity.flush()).toBe(0)
  })

  it('writes on its own once the buffer is full', () => {
    for (let i = 0; i < ACTIVITY_BUFFER_MAX - 1; i++) repo.activity.record({ kind: 'open', area: 'today' })
    expect(stored()).toHaveLength(0)
    repo.activity.record({ kind: 'open', area: 'tasks' })
    expect(stored()).toHaveLength(ACTIVITY_BUFFER_MAX)
    expect(repo.activity.pending()).toBe(0)
  })

  it('writes what waits when the database closes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sel-activity-'))
    try {
      const file = join(dir, 'sel.db')
      const first = openTestDatabase(file).repo
      first.activity.record({ kind: 'open', area: 'sky' })
      first.close()
      const second = openTestDatabase(file).repo
      expect(second.activity.count()).toBe(1)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('never keeps an edit as an event of its own, nor a kind it does not know', () => {
    repo.activity.record({ kind: 'edit', pageId: 'x' })
    repo.activity.record({ kind: 'nope' as never })
    expect(repo.activity.pending()).toBe(0)
  })
})

describe('edits', () => {
  it('count once per page per minute, however many writes, across flushes', () => {
    const a = page('A')
    const b = page('B')
    repo.activity.flush()
    db.exec('DELETE FROM activity')
    const x = line(a)
    repo.update(x, { props: { title: [['xy']] } })
    repo.update(x, { props: { title: [['xyz']] } })
    line(b)
    repo.activity.flush()
    t += 20_000
    repo.update(x, { props: { title: [['xyzw']] } })
    repo.activity.flush()
    t += MINUTE
    repo.update(x, { props: { title: [['xyzwv']] } })
    repo.activity.flush()
    const minute = Math.floor(T0 / MINUTE) * MINUTE
    expect(stored().map((r) => [r.kind, r.page_id, r.count, r.at])).toEqual([
      ['edit', a, 4, minute],
      ['edit', b, 1, minute],
      ['edit', a, 1, minute + MINUTE]
    ])
  })

  it('in a transaction that is rolled back are not counted', () => {
    const a = page('A')
    repo.activity.flush()
    db.exec('DELETE FROM activity')
    expect(() =>
      repo.apply([
        { op: 'create', input: { type: 'text', parentId: a, props: {} } },
        { op: 'update', id: 'missing', patch: {} }
      ])
    ).toThrow()
    repo.activity.flush()
    expect(stored()).toEqual([])
  })

  it('come from sync never', () => {
    const a = page('A')
    repo.activity.flush()
    db.exec('DELETE FROM activity')
    const block = {
      id: 'from-elsewhere',
      type: 'text' as const,
      parentId: a,
      content: [],
      props: {},
      createdAt: 1,
      updatedAt: 2,
      trashedAt: null
    }
    repo.applySync({ put: [block], remove: [], snapshots: [], foreign: [], resetPages: [], settings: {} })
    repo.activity.flush()
    expect(stored()).toEqual([])
  })
})

describe('tasks', () => {
  const values = (v: Record<string, unknown>): BlockProps => ({ values: v }) as BlockProps

  it('created, completed and postponed, each with its project, whatever path wrote them', () => {
    ensureTasksDatabase(repo)
    repo.activity.flush()
    db.exec('DELETE FROM activity')
    const task = repo.create({
      type: 'page',
      parentId: TASKS_DATABASE_ID,
      props: { title: [['Call']], ...values({ [TASK_PROPS.project]: 'p1', [TASK_PROPS.due]: { start: '2026-10-22' } }) }
    }).id
    repo.update(task, { props: values({ [TASK_PROPS.project]: 'p1', [TASK_PROPS.due]: { start: '2026-10-25' } }) })
    repo.update(task, { props: values({ [TASK_PROPS.project]: 'p1', [TASK_PROPS.due]: { start: '2026-10-24' } }) })
    repo.apply([
      {
        op: 'update',
        id: task,
        patch: { props: values({ [TASK_PROPS.project]: 'p1', [TASK_PROPS.completedAt]: { start: '2026-10-22T10:00' } }) }
      }
    ])
    repo.activity.flush()
    // The Tasks database itself is not "edited" by a row being added.
    expect(stored().map((r) => [r.kind, r.project])).toEqual([
      ['task.created', 'p1'],
      ['task.postponed', 'p1'],
      ['task.completed', 'p1']
    ])
    // A postponement keeps which task it was: a task put off again and again can be found (C3).
    expect(stored().map((r) => r.page_id)).toEqual([null, task, null])
  })

  it('are read from before and after alone', () => {
    const p = (v: Record<string, unknown>): BlockProps => ({ values: v }) as BlockProps
    expect(taskEvents({ before: null, after: p({}) })).toEqual([{ kind: 'task.created', project: null }])
    // A repeating task completed moves its due day too: completed, not postponed.
    expect(
      taskEvents({
        before: p({ [TASK_PROPS.due]: '2026-10-22', [TASK_PROPS.completedAt]: '2026-10-15T09:00' }),
        after: p({ [TASK_PROPS.due]: '2026-10-29', [TASK_PROPS.completedAt]: '2026-10-22T09:00' })
      })
    ).toEqual([{ kind: 'task.completed', project: null }])
    // Taking a completion back, or moving a time within the day, is neither.
    expect(taskEvents({ before: p({ [TASK_PROPS.completedAt]: '2026-10-22T09:00' }), after: p({}) })).toEqual([])
    expect(taskEvents({ before: p({ [TASK_PROPS.due]: '2026-10-22T09:00' }), after: p({ [TASK_PROPS.due]: '2026-10-22T15:00' }) })).toEqual(
      []
    )
    // A due day given for the first time is not a postponement.
    expect(taskEvents({ before: p({}), after: p({ [TASK_PROPS.due]: '2026-10-30' }) })).toEqual([])
  })
})

describe('the off switch', () => {
  it('stops at once: what waits is dropped, nothing new is kept, until it is on again', () => {
    const a = page('A')
    repo.activity.record({ kind: 'open', area: 'today' })
    repo.setSetting(ACTIVITY_ENABLED_KEY, false)
    expect(repo.activity.enabled()).toBe(false)
    expect(repo.activity.pending()).toBe(0)
    repo.activity.record({ kind: 'open', area: 'tasks' })
    line(a)
    expect(repo.activity.pending()).toBe(0)
    expect(repo.activity.flush()).toBe(0)
    expect(stored()).toEqual([])
    repo.setSetting(ACTIVITY_ENABLED_KEY, null)
    expect(repo.activity.enabled()).toBe(true)
    repo.activity.record({ kind: 'open', area: 'sky' })
    expect(repo.activity.flush()).toBe(1)
  })

  it('is read from the stored setting when the database opens', () => {
    repo.setSetting(ACTIVITY_ENABLED_KEY, false)
    const again = new Repo(db)
    expect(again.activity.enabled()).toBe(false)
  })
})

describe('retention and delete', () => {
  it('prunes rows older than 12 months and keeps the rest', () => {
    repo.activity.record({ kind: 'open', area: 'today' })
    t = T0 + 200 * 24 * 60 * MINUTE
    repo.activity.record({ kind: 'open', area: 'tasks' })
    repo.activity.flush()
    t = new Date(2027, 9, 22, 9, 0, 1).getTime()
    expect(retentionCutoff(t)).toBe(new Date(2026, 9, 22, 9, 0, 1).getTime())
    expect(repo.activity.prune()).toBe(1)
    expect(stored().map((r) => r.area)).toEqual(['tasks'])
    expect(repo.activity.prune()).toBe(0)
  })

  it('deletes the whole history, what waits in memory too', () => {
    repo.activity.record({ kind: 'open', area: 'today' })
    repo.activity.flush()
    repo.activity.record({ kind: 'open', area: 'tasks' })
    repo.activity.clear()
    expect(repo.activity.count()).toBe(0)
    expect(repo.activity.pending()).toBe(0)
    expect(repo.activity.oldest()).toBeNull()
  })

  it('reads rows of a span, oldest first, writing what waits first', () => {
    repo.activity.record({ kind: 'open', area: 'today' })
    t += MINUTE
    repo.activity.record({ kind: 'open', area: 'page', pageId: 'p' })
    expect(repo.activity.rows(T0, T0 + MINUTE)).toEqual([
      { at: T0, kind: 'open', area: 'today', pageId: null, project: null, count: 1, minutes: null }
    ])
    expect(repo.activity.rows(0, Number.MAX_SAFE_INTEGER).map((r) => r.pageId)).toEqual([null, 'p'])
    expect(repo.activity.oldest()).toBe(T0)
  })
})

describe('privacy', () => {
  it('stays on this computer: the setting is not a synced one, and sync reads no row of the log', () => {
    expect(syncedAtOf(ACTIVITY_ENABLED_KEY)).toBeNull()
    const a = page('A')
    line(a)
    repo.activity.record({ kind: 'open', area: 'page', pageId: a })
    repo.activity.flush()
    expect(repo.activity.count()).toBeGreaterThan(0)
    const synced = JSON.stringify(repo.syncRows())
    expect(synced).not.toContain('"edit"')
    expect(synced).not.toContain('activity')
  })
})
