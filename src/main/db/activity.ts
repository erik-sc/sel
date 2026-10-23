import {
  ACTIVITY_ENABLED_KEY,
  ACTIVITY_RETENTION_MONTHS,
  type ActivityEvent,
  type ActivityRow,
  activityEnabled,
  isActivityKind
} from '../../shared/activity'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import type { BlockProps } from '../../shared/types'
import type { SqlStatement } from './driver'

/**
 * The local activity log (src/shared/activity.ts): events wait in memory and are written in one
 * transaction now and then (a timer of the activity feature, a full buffer, closing the
 * database), so that recording costs nothing a keystroke would notice. Edits are counted per
 * page and per minute: one row however many keystrokes. The repository owns it, so that every
 * writer's edits and task changes reach it and so that closing the database writes what waits.
 */

export interface ActivityDeps {
  stmt(sql: string): SqlStatement
  transaction<T>(fn: () => T): T
  clock(): number
  getSetting(key: string): unknown
}

/** A row of the Tasks database, before (null when it is new) and after a write. */
export interface TaskWrite {
  before: BlockProps | null
  after: BlockProps
}

/** Past this many waiting entries the buffer is written at once. */
export const ACTIVITY_BUFFER_MAX = 256
const MINUTE = 60_000
const MAX_TEXT = 64

const clip = (value: unknown): string | null => (typeof value === 'string' && value ? value.slice(0, MAX_TEXT) : null)

export class ActivityLog {
  private events: { at: number; event: ActivityEvent }[] = []
  /** `minute \0 pageId` → edits in that minute. */
  private edits = new Map<string, number>()
  private on: boolean | null = null

  constructor(private readonly deps: ActivityDeps) {}

  /** Whether events are recorded: the setting, read once and again after it changes. */
  enabled(): boolean {
    if (this.on === null) {
      try {
        this.on = activityEnabled(this.deps.getSetting(ACTIVITY_ENABLED_KEY))
      } catch {
        this.on = true
      }
    }
    return this.on
  }

  /** The setting was written: read again. Turned off, what waits is dropped and nothing more is kept. */
  settingChanged(): void {
    this.on = null
    if (!this.enabled()) this.drop()
  }

  /** Records one event now. Ignored while off; never throws. */
  record(event: ActivityEvent): void {
    if (!this.enabled() || !isActivityKind(event.kind) || event.kind === 'edit') return
    this.events.push({ at: this.deps.clock(), event })
    this.maybeFlush()
  }

  /** Pages written by a committed transaction, and the rows of the Tasks database it wrote. */
  afterCommit(pages: readonly string[], tasks: readonly TaskWrite[]): void {
    if (!this.enabled() || (!pages.length && !tasks.length)) return
    const minute = Math.floor(this.deps.clock() / MINUTE) * MINUTE
    for (const page of pages) {
      // A task added or changed is its own event, not an edit of the Tasks database.
      if (page === TASKS_DATABASE_ID) continue
      const key = `${minute}\u0000${page}`
      this.edits.set(key, (this.edits.get(key) ?? 0) + 1)
    }
    const at = this.deps.clock()
    for (const write of tasks) for (const event of taskEvents(write)) this.events.push({ at, event })
    this.maybeFlush()
  }

  /** How many entries wait to be written. */
  pending(): number {
    return this.events.length + this.edits.size
  }

  private maybeFlush(): void {
    if (this.pending() < ACTIVITY_BUFFER_MAX) return
    try {
      this.flush()
    } catch (err) {
      console.error('[activity] could not write the log', err)
    }
  }

  /** Writes what waits, in one transaction. Returns how many entries were written. */
  flush(): number {
    const count = this.pending()
    if (!count) return 0
    const events = this.events
    const edits = this.edits
    this.events = []
    this.edits = new Map()
    if (!this.enabled()) return 0
    this.deps.transaction(() => {
      const insert = this.deps.stmt('INSERT INTO activity (at, kind, area, page_id, project, count, minutes) VALUES (?, ?, ?, ?, ?, 1, ?)')
      for (const { at, event } of events) {
        const minutes = typeof event.minutes === 'number' && Number.isFinite(event.minutes) ? Math.round(event.minutes) : null
        insert.run(at, event.kind, clip(event.area), clip(event.pageId), clip(event.project), minutes)
      }
      const edit = this.deps.stmt(
        `INSERT INTO activity (at, kind, page_id, count) VALUES (?, 'edit', ?, ?)
         ON CONFLICT(page_id, at) WHERE kind = 'edit' DO UPDATE SET count = count + excluded.count`
      )
      for (const [key, n] of edits) {
        const split = key.indexOf('\u0000')
        edit.run(Number(key.slice(0, split)), key.slice(split + 1), n)
      }
    })
    return count
  }

  /** Deletes rows older than the retention (12 months before `now`). Returns how many went. */
  prune(now = this.deps.clock()): number {
    const cutoff = retentionCutoff(now)
    const before = this.count()
    this.deps.stmt('DELETE FROM activity WHERE at < ?').run(cutoff)
    return before - this.count()
  }

  /** Deletes the whole history, and what waits to be written. */
  clear(): void {
    this.drop()
    this.deps.stmt('DELETE FROM activity').run()
  }

  private drop(): void {
    this.events = []
    this.edits = new Map()
  }

  count(): number {
    const row = this.deps.stmt('SELECT count(*) AS n FROM activity').get() as { n: number } | undefined
    return Number(row?.n ?? 0)
  }

  oldest(): number | null {
    const row = this.deps.stmt('SELECT min(at) AS at FROM activity').get() as { at: number | null } | undefined
    return row?.at === null || row?.at === undefined ? null : Number(row.at)
  }

  /** The stored rows with `from <= at < to`, oldest first. What is still in memory is written first. */
  rows(from: number, to: number): ActivityRow[] {
    this.flush()
    const raw = this.deps
      .stmt('SELECT at, kind, area, page_id, project, count, minutes FROM activity WHERE at >= ? AND at < ? ORDER BY at, id')
      .all(from, to) as {
      at: number
      kind: string
      area: string | null
      page_id: string | null
      project: string | null
      count: number
      minutes: number | null
    }[]
    const out: ActivityRow[] = []
    for (const r of raw) {
      if (!isActivityKind(r.kind)) continue
      out.push({
        at: Number(r.at),
        kind: r.kind,
        area: r.area,
        pageId: r.page_id,
        project: r.project,
        count: Number(r.count),
        minutes: r.minutes === null ? null : Number(r.minutes)
      })
    }
    return out
  }
}

/** The first moment still kept at `now`: the same day and time, 12 months before. */
export function retentionCutoff(now: number): number {
  const date = new Date(now)
  date.setMonth(date.getMonth() - ACTIVITY_RETENTION_MONTHS)
  return date.getTime()
}

// ---- task events --------------------------------------------------------------------

function valuesOf(props: BlockProps | null): Record<string, unknown> {
  const values = props?.values
  return values && typeof values === 'object' && !Array.isArray(values) ? (values as Record<string, unknown>) : {}
}

/** The moment of a date value (`'2026-10-22'` or `{ start }`), or null. */
function dateOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const start = (value as { start?: unknown }).start
    return typeof start === 'string' && start ? start : null
  }
  return null
}

/**
 * What a write of a row of the Tasks database was: created, completed (a later `Completed at`,
 * which a repeating task moving on also is), postponed (a due day moved later, by itself). The
 * same reading as src/main/tasks/completions.ts.
 */
export function taskEvents({ before, after }: TaskWrite): ActivityEvent[] {
  const now = valuesOf(after)
  const project = typeof now[TASK_PROPS.project] === 'string' ? (now[TASK_PROPS.project] as string) : null
  if (before === null) return [{ kind: 'task.created', project }]
  const was = valuesOf(before)
  const doneBefore = dateOf(was[TASK_PROPS.completedAt])
  const doneAfter = dateOf(now[TASK_PROPS.completedAt])
  if (doneAfter !== null && (doneBefore === null || doneAfter > doneBefore)) return [{ kind: 'task.completed', project }]
  const dueBefore = dateOf(was[TASK_PROPS.due])?.slice(0, 10) ?? null
  const dueAfter = dateOf(now[TASK_PROPS.due])?.slice(0, 10) ?? null
  if (dueBefore !== null && dueAfter !== null && dueAfter > dueBefore) return [{ kind: 'task.postponed', project }]
  return []
}

export const isTaskRow = (type: string, parentId: string | null): boolean => type === 'page' && parentId === TASKS_DATABASE_ID
