import { NOTEBOOK_ID, NOTEBOOK_LIMITS, type DayReviewItem } from '../../shared/notebook'
import { SKY_ID } from '../../shared/sky'
import { plainText } from '../../shared/richtext'
import type { BlockProps } from '../../shared/types'
import { detectSignal, type TaskBlock, type TaskSignal } from '../briefing/tasks'

/**
 * What happened today, for the first step of closing the day: the tasks completed and the pages
 * edited. Pure: it is handed blocks and the bounds of the day and answers with two short lists.
 *
 * Nothing records when a task was completed, so a task counts as completed today when it is done
 * now and was last changed today: a row whose database says it is done (the same signals the
 * Today screen reads, see ../briefing/tasks.ts), or a checked to-do. A row of a task database is
 * a task and not an edited page; the notebook is neither.
 */

export interface DayBounds {
  /** The first and the last millisecond of the local day. */
  from: number
  to: number
  /** Items per list. */
  cap?: number
}

export interface DayCollection {
  completed: DayReviewItem[]
  edited: DayReviewItem[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function titleOf(props: unknown): string {
  const title = isObject(props) ? props['title'] : undefined
  if (!Array.isArray(title)) return ''
  try {
    return plainText(title as BlockProps['title'])
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  } catch {
    return ''
  }
}

/** Whether a row is done (not merely closed: a cancelled task was not completed). */
export function isDoneRow(signal: TaskSignal, props: unknown): boolean {
  const values = isObject(props) && isObject(props['values']) ? props['values'] : {}
  const own = (key: string): unknown => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined)
  if (signal.checkbox && own(signal.checkbox) === true) return true
  return !!signal.status && own(signal.status.property) === signal.status.done
}

/**
 * The tasks completed and the pages edited between `from` and `to`, the most recent first.
 * Blocks may come in any order and more than once; trashed ones, and what sits in them, are
 * left out as far as the blocks handed over tell.
 */
export function collectDay(blocks: Iterable<TaskBlock>, bounds: DayBounds): DayCollection {
  const cap = Math.max(1, bounds.cap ?? NOTEBOOK_LIMITS.review)
  const within = (at: unknown): boolean => typeof at === 'number' && at >= bounds.from && at <= bounds.to
  const heads = new Map<string, { type: string; parentId: string | null; trashed: boolean; title: string }>()
  const all = new Map<string, TaskBlock>()
  for (const block of blocks) {
    if (!block || typeof block.id !== 'string' || all.has(block.id)) continue
    all.set(block.id, block)
    heads.set(block.id, {
      type: block.type,
      parentId: typeof block.parentId === 'string' ? block.parentId : null,
      trashed: block.trashedAt !== null && block.trashedAt !== undefined,
      title: titleOf(block.props)
    })
  }

  const isDead = (id: string | null): boolean => {
    for (let depth = 0, current = id; current !== null && depth < 200; depth++) {
      const head = heads.get(current)
      if (!head) return false
      if (head.trashed) return true
      current = head.parentId
    }
    return false
  }
  /** The page a block is on: its nearest ancestor that is a page. */
  const pageOf = (id: string | null): string | null => {
    for (let depth = 0, current = id; current !== null && depth < 200; depth++) {
      const head = heads.get(current)
      if (!head) return null
      if (head.type === 'page' || head.type === 'database') return head.type === 'page' ? current : null
      current = head.parentId
    }
    return null
  }

  const signals = new Map<string, TaskSignal | null>()
  const signalOf = (databaseId: string | null): TaskSignal | null => {
    if (databaseId === null) return null
    if (!signals.has(databaseId)) {
      const database = all.get(databaseId)
      const props = database && isObject(database.props) ? (database.props as BlockProps) : null
      const usable = !!database && database.type === 'database' && !!props && typeof props.sourceId !== 'string'
      signals.set(databaseId, usable ? detectSignal(props) : null)
    }
    return signals.get(databaseId) ?? null
  }

  const completed: (DayReviewItem & { at: number })[] = []
  const edited: (DayReviewItem & { at: number })[] = []
  for (const block of all.values()) {
    if (block.trashedAt !== null && block.trashedAt !== undefined) continue
    if (!within(block.updatedAt)) continue
    const parentId = typeof block.parentId === 'string' ? block.parentId : null
    if (block.id === NOTEBOOK_ID || parentId === NOTEBOOK_ID || block.id === SKY_ID || parentId === SKY_ID) continue
    const title = heads.get(block.id)?.title ?? ''
    if (block.type === 'page') {
      const signal = signalOf(parentId)
      if (signal) {
        if (isDoneRow(signal, block.props) && !isDead(parentId))
          completed.push({ id: block.id, title: title || 'Untitled', pageId: block.id, at: block.updatedAt })
      } else if (!isDead(parentId)) {
        edited.push({ id: block.id, title: title || 'Untitled', pageId: block.id, at: block.updatedAt })
      }
    } else if (block.type === 'to_do') {
      const props = isObject(block.props) ? block.props : {}
      if (props['checked'] !== true || !title) continue
      const pageId = pageOf(parentId)
      if (pageId === null || isDead(parentId)) continue
      completed.push({ id: block.id, title, pageId, at: block.updatedAt })
    }
  }
  const newest = (a: { at: number }, b: { at: number }): number => b.at - a.at
  const strip = ({ at: _at, ...item }: DayReviewItem & { at: number }): DayReviewItem => item
  return { completed: completed.sort(newest).slice(0, cap).map(strip), edited: edited.sort(newest).slice(0, cap).map(strip) }
}
