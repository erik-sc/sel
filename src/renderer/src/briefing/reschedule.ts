// Moving a task on the calendar screen: the date a dropped task gets, the time a point of the
// week's hours stands for, and the write itself (with what undoes it). The first two are pure.
import type { BriefingTask } from '@shared/briefing'
import type { Op, PropertyValue } from '@shared/types'
import { addDays, dayKey, diffDays, normalizeDay, timeOf } from '@shared/database/dates'
import { applyOps, fetchBlocks, getBlock } from '@/store/blocks'

/** The start of a stored date value: `{ start, end? }` or a bare string. */
function startOf(value: PropertyValue | undefined): string | null {
  if (typeof value === 'string') return value || null
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.start === 'string') return value.start
  return null
}

function endOf(value: PropertyValue | undefined): string | null {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.end === 'string' ? value.end : null
}

/**
 * A date value moved to `day` (`YYYY-MM-DD`). `time` is the time of day it gets there: a `HH:mm`,
 * null for none (the day alone), or undefined to keep the one it had. A range keeps its length
 * and its times, its end landing on `day` (the end is when a task with a range is due).
 */
export function rescheduleValue(value: PropertyValue | undefined, day: string, time?: string | null): PropertyValue {
  const target = normalizeDay(day)
  if (!target) return value ?? null
  const start = startOf(value)
  const end = endOf(value)
  const startDay = dayKey(start)
  const endDay = dayKey(end)
  if (start && end && startDay && endDay && endDay > startDay) {
    const delta = diffDays(endDay, target)
    return { start: addDays(start, delta), end: addDays(end, delta) }
  }
  const keep = time === undefined ? timeOf(start) : time
  return { start: keep ? `${target}T${keep}` : target }
}

/** The time of day a point of a day's hours stands for, on the `step` (minutes) before it. */
export function slotTime(offset: number, height: number, step = 15): string {
  const fraction = height > 0 ? Math.min(Math.max(offset / height, 0), 1) : 0
  const minutes = Math.min(1440 - step, Math.floor((fraction * 1440) / step) * step)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Whether a task of the agenda can be moved: a database row whose date property is known. */
export function canMove(task: BriefingTask): boolean {
  return task.kind === 'row' && !!task.dateProperty
}

/** What a move changed: putting `previous` back undoes it. */
export interface Move {
  rowId: string
  property: string
  previous: PropertyValue | undefined
  next: PropertyValue
}

/** Writes one property of a row, read fresh from the database first (the agenda's copy may be old). */
async function writeProperty(
  rowId: string,
  property: string,
  change: (current: PropertyValue | undefined) => PropertyValue | undefined
): Promise<PropertyValue | undefined> {
  await fetchBlocks(() => window.api.blocks.getMany([rowId]))
  const row = getBlock(rowId)
  if (!row || row.trashedAt) throw new Error('The task is gone')
  const values = { ...((row.props.values ?? {}) as Record<string, PropertyValue>) }
  const current = Object.hasOwn(values, property) ? values[property] : undefined
  const next = change(current)
  if (next === undefined) delete values[property]
  else values[property] = next
  const op: Op = { op: 'update', id: rowId, patch: { props: { values } } }
  await applyOps([op])
  return current
}

/** Moves a task to `day` (and `time`, see rescheduleValue). Null when there was nothing to change. */
export async function moveTask(task: BriefingTask, day: string, time?: string | null): Promise<Move | null> {
  if (!canMove(task)) return null
  const property = task.dateProperty as string
  let next: PropertyValue = null
  let changed = false
  const previous = await writeProperty(task.id, property, (current) => {
    next = rescheduleValue(current, day, time)
    changed = JSON.stringify(next) !== JSON.stringify(current ?? null)
    return changed ? next : current
  })
  return changed ? { rowId: task.id, property, previous, next } : null
}

/** Puts a moved task back where it was. */
export async function undoMove(move: Move): Promise<void> {
  await writeProperty(move.rowId, move.property, () => move.previous)
}
