/**
 * Reminders said relative to the due date: "at the time", "15 min before", "1 hour before",
 * "1 day before at 9:00". They are worked out once, when picked, and stored as the absolute
 * moment they mean (`tasks.remind` is a wall-clock `YYYY-MM-DDTHH:mm`, which is what the alarms
 * read): moving the due date afterwards does not move the reminder, as with any other.
 */
import { civil, dayNumber } from '../rrule'

export type ReminderShortcut = 'atTime' | 'minutes15' | 'hour1' | 'dayBefore'
export const REMINDER_SHORTCUTS: readonly ReminderShortcut[] = ['atTime', 'minutes15', 'hour1', 'dayBefore']

const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/
const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function moment(day: number, minutes: number): string {
  const total = day * 1440 + minutes
  const at = Math.floor(total / 1440)
  const rest = total - at * 1440
  const { year, month, date } = civil(at)
  return `${pad(year, 4)}-${pad(month)}-${pad(date)}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`
}

/**
 * The moment a shortcut means for a due date (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`); null when it
 * means nothing: no due date, or minutes before a due date that has no time. A due date without
 * a time is "at the time" at 9:00 of its day.
 */
export function reminderAt(due: string | null | undefined, shortcut: ReminderShortcut): string | null {
  const m = typeof due === 'string' ? DUE_RE.exec(due) : null
  if (!m) return null
  const day = dayNumber(Number(m[1]), Number(m[2]), Number(m[3]))
  const back = civil(day)
  if (back.month !== Number(m[2]) || back.date !== Number(m[3])) return null
  const time = m[4] !== undefined ? Number(m[4]) * 60 + Number(m[5]) : null
  if (time !== null && time >= 1440) return null
  // The time a reminder gets on a day without one (a due date without a time, "1 day before").
  const morning = 9 * 60
  switch (shortcut) {
    case 'atTime':
      return moment(day, time ?? morning)
    case 'minutes15':
      return time === null ? null : moment(day, time - 15)
    case 'hour1':
      return time === null ? null : moment(day, time - 60)
    case 'dayBefore':
      return moment(day - 1, morning)
  }
}

/** Which shortcut a stored reminder is for that due date, when it is one. */
export function reminderShortcutOf(due: string | null | undefined, remind: string | null | undefined): ReminderShortcut | null {
  if (!remind) return null
  return REMINDER_SHORTCUTS.find((shortcut) => reminderAt(due, shortcut) === remind.slice(0, 16)) ?? null
}
