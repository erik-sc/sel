// A new event for Google Calendar, as the address that opens it there already filled in: sel
// reads calendars (by their private iCal address) and cannot write to them, so the event is
// saved in Google's own page, one click away, and comes back with the calendar's next refresh.
// Pure: no React, no DOM.

export interface NewEvent {
  title: string
  /** `YYYY-MM-DD`. */
  day: string
  /** `HH:mm`, or null for an event that takes the whole day. */
  start: string | null
  /** `HH:mm`, the same day; at or before `start` it ends the day after. Ignored without `start`. */
  end: string | null
  location?: string
  details?: string
  /** The IANA time zone the hours are in, when known. */
  timeZone?: string
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/u

const pad = (n: number): string => String(n).padStart(2, '0')

/** The day after `day`. */
export function dayAfter(day: string): string {
  const [, y, m, d] = DAY.exec(day) ?? []
  const next = new Date(Number(y), Number(m) - 1, Number(d) + 1)
  return `${String(next.getFullYear()).padStart(4, '0')}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
}

/** `time` moved by `minutes`, within the day: 23:30 + 60 is 23:59. */
export function clockPlus(time: string, minutes: number): string {
  const [, h, m] = CLOCK.exec(time) ?? []
  const total = Math.min(23 * 60 + 59, Math.max(0, Number(h) * 60 + Number(m) + minutes))
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** What is wrong with the event as typed, or null. */
export function newEventProblem(event: NewEvent): 'title' | 'day' | 'time' | null {
  if (!event.title.trim()) return 'title'
  if (!DAY.test(event.day)) return 'day'
  if (event.start !== null && (!CLOCK.test(event.start) || (event.end !== null && !CLOCK.test(event.end)))) return 'time'
  return null
}

/** Google Calendar's page for a new event, filled in. Null when the event cannot be made as typed. */
export function googleEventUrl(event: NewEvent): string | null {
  if (newEventProblem(event)) return null
  const compact = (day: string): string => day.replaceAll('-', '')
  let dates: string
  if (event.start === null) {
    // A whole day ends, for Google, on the day after.
    dates = `${compact(event.day)}/${compact(dayAfter(event.day))}`
  } else {
    const end = event.end ?? clockPlus(event.start, 60)
    const endDay = end <= event.start ? dayAfter(event.day) : event.day
    const stamp = (day: string, time: string): string => `${compact(day)}T${time.replace(':', '')}00`
    dates = `${stamp(event.day, event.start)}/${stamp(endDay, end)}`
  }
  const query = new URLSearchParams({ action: 'TEMPLATE', text: event.title.trim().slice(0, 300), dates })
  if (event.start !== null && event.timeZone) query.set('ctz', event.timeZone)
  if (event.location?.trim()) query.set('location', event.location.trim().slice(0, 300))
  if (event.details?.trim()) query.set('details', event.details.trim().slice(0, 2000))
  return `https://calendar.google.com/calendar/render?${query.toString()}`
}
