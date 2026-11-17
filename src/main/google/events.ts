// A task as an event of Google Calendar. Pure.
import { createHash } from 'node:crypto'
import { ruleFor, type FeedTask } from '../../shared/tasks/ics'

/** How long a task with an hour takes on the calendar: it has a moment, not a length. */
const MINUTES = 30

export interface GoogleEvent {
  /** The task's own id, as Google takes one: the same task is the same event from any computer. */
  id: string
  body: Record<string, unknown>
  /** A mark of what the event says: unchanged, there is nothing to send. */
  mark: string
}

const pad = (n: number): string => String(n).padStart(2, '0')
const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/u

/** A task's id as an event's: Google takes the letters a to v and the digits, and a UUID's are among them. */
export function eventId(taskId: string): string | null {
  const id = taskId.replaceAll('-', '').toLowerCase()
  return /^[0-9a-f]{32}$/u.test(id) ? id : null
}

/** The event of a task, or null when its date or its id does not read. */
export function eventOf(task: FeedTask, timeZone: string): GoogleEvent | null {
  const id = eventId(task.id)
  const match = DUE_RE.exec(task.due)
  if (!id || !match) return null
  const [, y, m, d, hh, mm] = match
  const timed = hh !== undefined
  let start: Record<string, string>
  let end: Record<string, string>
  if (timed) {
    const until = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm) + MINUTES))
    const stamp = `${until.getUTCFullYear()}-${pad(until.getUTCMonth() + 1)}-${pad(until.getUTCDate())}T${pad(until.getUTCHours())}:${pad(until.getUTCMinutes())}:00`
    start = { dateTime: `${y}-${m}-${d}T${hh}:${mm}:00`, timeZone }
    end = { dateTime: stamp, timeZone }
  } else {
    const next = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 1))
    start = { date: `${y}-${m}-${d}` }
    end = { date: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}` }
  }
  const notes = [
    task.project ? `#${task.project}` : '',
    task.priority && task.priority !== 'P4' ? task.priority : '',
    ...task.labels.map((label) => `@${label}`)
  ]
    .filter(Boolean)
    .join(' ')
  // Only what repeats by its date is a series on a calendar: "after it is done" has no next date yet.
  const rule = task.recurrence?.from === 'due' ? ruleFor(task.recurrence.rule, timed) : null
  const body: Record<string, unknown> = {
    summary: (task.title.trim() || 'Untitled').slice(0, 1000),
    description: notes,
    start,
    end,
    recurrence: rule ? [`RRULE:${rule}`] : [],
    // A task does not take the hour: the day stays free for whoever looks at the calendar.
    transparency: 'transparent',
    // An event deleted in Google and still a task in sel is put back.
    status: 'confirmed'
  }
  return { id, body, mark: createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32) }
}
