import { plainText } from '../../shared/richtext'
import { isSystemBlock } from '../../shared/system'
import type { Block, PropertySchema } from '../../shared/types'
import { detectSignal, fold, isOpenRow } from '../briefing/tasks'
import { REMINDER_GRACE_MS, type Fired } from './schedule'

/**
 * Reminders of tasks: the open rows of the built-in Tasks database that carry a reminder (a
 * date property `tasks.remind`, or one named like "Remind" / "Lembrete"), and those whose due
 * date has a time of day. A reminder without a time is given at 09:00 of its day; a due date
 * without a time has no reminder of its own (the morning briefing covers it).
 *
 * Pure: it is handed blocks and the clock. Schemas are user data and are not trusted.
 */

export const REMIND_PROPERTY_ID = 'tasks.remind'
const REMIND_NAMES = new Set(['remind', 'reminder', 'remind me', 'lembrete', 'lembrar', 'aviso', 'avisar'])
const DEFAULT_REMINDER_TIME = '09:00'

export interface Reminder {
  /** What it is remembered as having rung by. */
  key: string
  rowId: string
  title: string
  /** When it is due (ms). */
  at: number
  /** The task's due date as stored, for the words ("due at 10:00"). */
  due: string | null
  /** True when this is the due time itself rather than a reminder before it. */
  atDue: boolean
}

const MOMENT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/

/** The local moment a stored date string stands for; a day alone stands at `dayTime`, or for nothing without one. */
export function momentOf(value: unknown, dayTime: string | null): number | null {
  const start = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as { start?: unknown }).start : value
  if (typeof start !== 'string') return null
  const m = MOMENT_RE.exec(start)
  if (!m) return null
  const time = m[4] !== undefined ? `${m[4]}:${m[5]}` : dayTime
  if (time === null) return null
  const moment = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(time.slice(0, 2)), Number(time.slice(3, 5))).getTime()
  return Number.isFinite(moment) ? moment : null
}

function hasTime(value: unknown): boolean {
  const start = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as { start?: unknown }).start : value
  return typeof start === 'string' && start.length > 10
}

/** The reminder property of a schema: `tasks.remind` first, else a date property named like one. */
function remindProperty(schema: unknown): string | null {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return null
  const properties = Object.values(schema as Record<string, unknown>).filter(
    (p): p is PropertySchema => p !== null && typeof p === 'object' && (p as PropertySchema).type === 'date' && typeof (p as PropertySchema).id === 'string'
  )
  const byId = properties.find((p) => p.id === REMIND_PROPERTY_ID)
  if (byId) return byId.id
  return properties.find((p) => REMIND_NAMES.has(fold(p.name)))?.id ?? null
}

/** The built-in Tasks database among the root blocks, when it exists. */
export function tasksDatabase(roots: readonly Block[]): Block | null {
  return roots.find((block) => block.type === 'database' && block.trashedAt === null && isSystemBlock(block) && block.props.system === 'tasks') ?? null
}

/** Every reminder the open rows of the Tasks database carry, earliest first. */
export function remindersOf(database: Block, rows: readonly Block[], options: { atDue: boolean }): Reminder[] {
  const signal = detectSignal(database.props)
  if (!signal) return []
  const remind = remindProperty(database.props.schema)
  const out: Reminder[] = []
  for (const row of rows) {
    if (row.type !== 'page' || row.trashedAt !== null || row.parentId !== database.id) continue
    if (!isOpenRow(signal, row.props)) continue
    const values = row.props.values ?? {}
    const due = signal.date !== undefined && Object.hasOwn(values, signal.date) ? values[signal.date] : undefined
    const dueText = due !== null && typeof due === 'object' && !Array.isArray(due) ? due.start : null
    const title = plainText(row.props.title ?? []).trim() || 'Untitled'
    if (remind !== null && Object.hasOwn(values, remind)) {
      const at = momentOf(values[remind], DEFAULT_REMINDER_TIME)
      if (at !== null) out.push({ key: `r:${row.id}:${at}`, rowId: row.id, title, at, due: dueText, atDue: false })
    }
    if (options.atDue && hasTime(due)) {
      const at = momentOf(due, null)
      if (at !== null && !out.some((r) => r.rowId === row.id && r.at === at)) out.push({ key: `d:${row.id}:${at}`, rowId: row.id, title, at, due: dueText, atDue: true })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/** The reminders due now that have not rung, within the grace period. */
export function dueReminders(reminders: readonly Reminder[], fired: Fired, now: number, graceMs = REMINDER_GRACE_MS): Reminder[] {
  return reminders.filter((r) => r.at <= now && now - r.at <= graceMs && fired[r.key] === undefined)
}

/** The first reminder after `now`, or null. */
export function nextReminderAt(reminders: readonly Reminder[], now: number): number | null {
  for (const r of reminders) if (r.at > now) return r.at
  return null
}
