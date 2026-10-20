// Calendar-day maths. Days are `YYYY-MM-DD` strings and all arithmetic is done on
// the proleptic civil calendar through UTC, so no result ever depends on the
// machine's timezone or on a DST transition. Local time is only consulted to answer
// "which day is it now / which day did this timestamp fall on".
//
// A date value may also carry a time of day, `YYYY-MM-DDTHH:mm`: a wall-clock time with no
// zone ("9:00 wherever I am"), the way a to-do app means it. Everything that works on days
// reads such a value as its day; only formatting, sorting and the picker look at the time.

export type DateValue = { start: string; end?: string }

const MS_PER_DAY = 86_400_000
/** Longest range (in days) that is expanded day by day (calendar, range filters). */
export const MAX_RANGE_DAYS = 370

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** UTC midnight of a civil day. Unlike `Date.UTC`, years 0-99 are not remapped to 19xx. */
function utcMs(year: number, month1: number, day: number): number {
  const d = new Date(0)
  d.setUTCFullYear(year, month1 - 1, day)
  return d.getTime()
}

function isoFromUtc(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function daysInMonth(year: number, month1: number): number {
  return new Date(utcMs(year, month1 + 1, 0)).getUTCDate()
}

/** UTC-midnight timestamp of a strict `YYYY-M-D[...]` day string; null when it is not a real day. */
function parseDayMs(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(s.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return utcMs(year, month, day)
}

/** Local calendar day of a Date as `YYYY-MM-DD`. Empty string for an invalid Date. */
export function toISODate(d: Date): string {
  if (!(d instanceof Date) || isNaN(d.getTime())) return ''
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Today's local day. */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now)
}

/**
 * Parses `YYYY-MM-DD...` as a local date (no timezone shift). Null when the text
 * is not a real calendar day (`2024-02-30`, `2024-13-01`, free text...).
 */
export function parseISODate(s: string | null | undefined): Date | null {
  const ms = parseDayMs(s)
  if (ms === null) return null
  const utc = new Date(ms)
  const local = new Date(0)
  local.setFullYear(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate())
  local.setHours(0, 0, 0, 0)
  return isNaN(local.getTime()) ? null : local
}

/** Canonical `YYYY-MM-DD` of a day string, or null. */
export function normalizeDay(s: unknown): string | null {
  const ms = parseDayMs(s)
  return ms === null ? null : isoFromUtc(ms)
}

/**
 * The time of day a date string carries, as `HH:mm`, or null. Only a plain wall-clock time
 * counts (`T09:30`, `T09:30:15`, also after a space): a time with a zone or an offset is not a
 * local time, so such a value is read as its day alone, as before times existed.
 */
export function timeOf(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const m = /^\d{4}-\d{1,2}-\d{1,2}[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,9})?)?$/.exec(s.trim())
  return m ? clockTime(m[1], m[2]) : null
}

/** `HH:mm` of a time typed or picked (`9:05`, `09:05`), or null. */
export function normalizeTime(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  return m ? clockTime(m[1], m[2]) : null
}

function clockTime(hours: string, minutes: string): string | null {
  const h = Number(hours)
  const m = Number(minutes)
  return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null
}

/** The day `day` at `time`; the day alone when there is no (valid) time. */
export function withTime(day: string, time: string | null | undefined): string {
  const clean = normalizeTime(time)
  return clean ? `${day}T${clean}` : day
}

/**
 * Canonical form of a date string: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when it carries a
 * wall-clock time. Null when it is not a real day. Canonical strings sort in time order,
 * a day without a time before the same day with one.
 */
export function normalizeMoment(s: unknown): string | null {
  const day = normalizeDay(s)
  return day === null ? null : withTime(day, timeOf(s))
}

/**
 * Lenient parse of text a user may have typed in a text cell (`2026-04-01`,
 * `1 Apr 2026`, `04/01/2026`...). ISO text keeps a time of day it carries. Used only when
 * converting a property to a date.
 */
export function parseLooseDay(text: string, locale?: string): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  // ISO-like text is either a real day or nothing: Date.parse would read it as UTC
  // (shifting the day west of Greenwich) and roll `02-30` over into March.
  if (/^\d{4}-/.test(trimmed)) return normalizeMoment(trimmed)
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed)
  if (numeric) {
    const [first, second] = [Number(numeric[1]), Number(numeric[2])]
    const [day, month] = dayComesFirst(locale) ? [first, second] : [second, first]
    return normalizeDay(`${numeric[3]}-${month}-${day}`)
  }
  // Month names ("1 Apr 2026"): a day, a year and a word are required, which rules
  // out the bare numbers and short junk that Date.parse happily accepts.
  if (!/[a-z]{3}/i.test(trimmed) || !/\b\d{1,2}\b/.test(trimmed) || !/\b\d{4}\b/.test(trimmed)) return null
  const d = new Date(trimmed)
  if (isNaN(d.getTime())) return null
  const year = d.getFullYear()
  return year >= 1 && year <= 9999 ? toISODate(d) : null
}

/** Whether numeric dates of a locale are written day/month (most of the world) or month/day. */
function dayComesFirst(locale?: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).formatToParts(new Date(utcMs(2000, 12, 25)))
    const order = parts.filter((p) => p.type === 'day' || p.type === 'month').map((p) => p.type)
    return order[0] !== 'month'
  } catch {
    return true
  }
}

export function isDateValue(v: unknown): v is DateValue {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as DateValue).start === 'string'
}

/**
 * Normalises any date-ish value (date value, ISO string, timestamp) to a
 * `YYYY-MM-DD` day key. Timestamps map to the local day they fall on.
 */
export function dayKey(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? toISODate(new Date(v)) || null : null
  if (typeof v === 'string') return normalizeDay(v)
  if (isDateValue(v)) return normalizeDay(v.start)
  return null
}

/**
 * A clean date value: canonical start, end kept only when it comes later. Both ends keep
 * their time of day, but an end has one only when the start has one too (a span of whole
 * days that ends at 17:00 means nothing).
 */
export function normalizeDateValue(v: unknown): DateValue | null {
  const start = typeof v === 'string' ? normalizeMoment(v) : isDateValue(v) ? normalizeMoment(v.start) : null
  if (!start) return null
  let end = isDateValue(v) ? normalizeMoment(v.end) : null
  if (end && timeOf(start) === null) end = end.slice(0, 10)
  return end && end > start ? { start, end } : { start }
}

/** What a date is sorted on: its canonical start (time order, a day without a time first). */
export function momentKey(v: unknown): string | null {
  if (typeof v === 'number') return dayKey(v)
  if (typeof v === 'string') return normalizeMoment(v)
  if (isDateValue(v)) return normalizeMoment(v.start)
  return null
}

/** The day `days` days away; a time of day comes along unchanged. */
export function addDays(iso: string, days: number): string {
  const ms = parseDayMs(iso)
  if (ms === null || !isFinite(days)) return iso
  const next = ms + Math.trunc(days) * MS_PER_DAY
  const year = new Date(next).getUTCFullYear()
  return isFinite(next) && year >= 1 && year <= 9999 ? withTime(isoFromUtc(next), timeOf(iso)) : iso
}

export function diffDays(fromIso: string, toIso: string): number {
  const a = parseDayMs(fromIso)
  const b = parseDayMs(toIso)
  if (a === null || b === null) return 0
  return Math.round((b - a) / MS_PER_DAY)
}

/** Moves a date value so that it starts on the day `newStart`, keeping its duration and its times of day. */
export function shiftDateValue(value: DateValue, newStart: string): DateValue {
  const from = dayKey(value.start)
  const day = dayKey(newStart) ?? newStart
  if (!from) return { start: day }
  const delta = diffDays(from, day)
  const start = normalizeMoment(value.start) ?? from
  const out: DateValue = { start: addDays(start, delta) }
  let end = value.end ? normalizeMoment(value.end) : null
  if (end && timeOf(start) === null) end = end.slice(0, 10)
  if (end && end > start) out.end = addDays(end, delta)
  return out
}

/**
 * The days a relative date names, counted from `today` (`YYYY-MM-DD`). A missing bound is
 * open. `whole` asks for a value that lies entirely inside (overdue: it ended before today),
 * otherwise touching one day of the span is enough. Null for anything that is not a name.
 * Weeks start on `weekStart` (0 = Sunday), as the calendars do.
 */
export function relativeSpan(name: unknown, today: string, weekStart = 0): { from?: string; to?: string; whole?: boolean } | null {
  if (!normalizeDay(today)) return null
  switch (name) {
    case 'today':
      return { from: today, to: today }
    case 'tomorrow':
      return { from: addDays(today, 1), to: addDays(today, 1) }
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) }
    case 'overdue':
      return { to: addDays(today, -1), whole: true }
    case 'by_today':
      return { to: today }
    case 'next_7_days':
      return { from: today, to: addDays(today, 6) }
    case 'past_7_days':
      return { from: addDays(today, -6), to: today }
    case 'this_week': {
      const week = weekOf(today, weekStart)
      return { from: week[0], to: week[6] }
    }
    case 'next_week': {
      const week = weekOf(addDays(today, 7), weekStart)
      return { from: week[0], to: week[6] }
    }
    case 'this_month': {
      const first = `${today.slice(0, 8)}01`
      const { year, month } = monthOf(today)
      return { from: first, to: isoFromUtc(utcMs(year, month + 1, daysInMonth(year, month + 1))) }
    }
    case 'last_month': {
      // Day 0 of this month is the last day of the one before; month 0 rolls back a year.
      const { year, month } = monthOf(today)
      return { from: isoFromUtc(utcMs(year, month, 1)), to: isoFromUtc(utcMs(year, month + 1, 0)) }
    }
    case 'past_30_days':
      return { from: addDays(today, -29), to: today }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }
    default:
      return null
  }
}

/** Whether the days `start` to `end` fall in a relative span (see `relativeSpan`). */
export function inSpan(start: string, end: string, span: { from?: string; to?: string; whole?: boolean }): boolean {
  if (span.whole) return (span.from === undefined || start >= span.from) && (span.to === undefined || end <= span.to)
  return (span.from === undefined || end >= span.from) && (span.to === undefined || start <= span.to)
}

export interface MonthCursor {
  year: number
  /** 0-based */
  month: number
}

export function monthOf(iso: string | null | undefined, fallback: Date = new Date()): MonthCursor {
  const ms = parseDayMs(iso)
  if (ms === null) return { year: fallback.getFullYear(), month: fallback.getMonth() }
  const d = new Date(ms)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
}

/** Month `delta` months away, clamped to the years a day string can express. */
export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const index = cursor.year * 12 + cursor.month + Math.trunc(delta)
  const clamped = Math.max(1 * 12, Math.min(9999 * 12 + 11, index))
  return { year: Math.floor(clamped / 12), month: clamped % 12 }
}

export interface CalendarDay {
  /** `YYYY-MM-DD` */
  date: string
  day: number
  inMonth: boolean
}

/**
 * Weeks of the month grid. `month` is 0-based. Weeks always have 7 days and
 * include the leading/trailing days of the adjacent months.
 */
export function calendarMatrix(year: number, month: number, weekStart = 0): CalendarDay[][] {
  const first = utcMs(year, month + 1, 1)
  const firstDate = new Date(first)
  const lead = (firstDate.getUTCDay() - weekStart + 7) % 7
  const count = daysInMonth(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1)
  const weekCount = Math.ceil((lead + count) / 7)
  const weeks: CalendarDay[][] = []
  for (let w = 0; w < weekCount; w++) {
    const week: CalendarDay[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(first + (w * 7 + i - lead) * MS_PER_DAY)
      week.push({
        date: isoFromUtc(d.getTime()),
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === firstDate.getUTCMonth() && d.getUTCFullYear() === firstDate.getUTCFullYear()
      })
    }
    weeks.push(week)
  }
  return weeks
}

/** The seven days of the week `iso` falls in, starting on `weekStart` (0 = Sunday). Empty for a non-day. */
export function weekOf(iso: string, weekStart = 0): string[] {
  const ms = parseDayMs(iso)
  if (ms === null) return []
  const lead = (new Date(ms).getUTCDay() - weekStart + 7) % 7
  return Array.from({ length: 7 }, (_, index) => addDays(isoFromUtc(ms), index - lead))
}

/** "October 2026", or "September – October 2026" when the days from `fromIso` to `toIso` span two months. */
export function monthRangeLabel(fromIso: string, toIso: string, locale?: string): string {
  const from = parseDayMs(fromIso)
  const to = parseDayMs(toIso)
  if (from === null || to === null) return ''
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).formatRange(new Date(from), new Date(to))
  } catch {
    return formatCivil(from, locale, 'month')
  }
}

export interface FormatOptions {
  locale?: string
  currency?: string
}

const CIVIL_FORMATS = {
  day: { year: 'numeric', month: 'short', day: 'numeric' },
  time: { hour: 'numeric', minute: '2-digit' },
  month: { month: 'long', year: 'numeric' },
  shortMonth: { month: 'short', year: 'numeric' },
  weekday: { weekday: 'short' }
} satisfies Record<string, Intl.DateTimeFormatOptions>

/**
 * Formatters by locale and kind. Building one is far dearer than formatting with it, and a
 * long list formats a date per row on every render.
 */
const civilFormatters = new Map<string, Intl.DateTimeFormat>()
const MAX_CIVIL_FORMATTERS = 64

/** Formats a civil day. The formatter runs in UTC on a UTC date, so the day never shifts. */
function formatCivil(ms: number, locale: string | undefined, kind: keyof typeof CIVIL_FORMATS): string {
  try {
    const key = `${kind}|${locale ?? ''}`
    let formatter = civilFormatters.get(key)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, { ...CIVIL_FORMATS[kind], timeZone: 'UTC' })
      if (civilFormatters.size >= MAX_CIVIL_FORMATTERS) civilFormatters.clear()
      civilFormatters.set(key, formatter)
    }
    return formatter.format(new Date(ms))
  } catch {
    return isoFromUtc(ms)
  }
}

export function formatDay(iso: string, opts: FormatOptions = {}): string {
  const ms = parseDayMs(iso)
  if (ms === null) return ''
  return formatCivil(ms, opts.locale, 'day')
}

/** A wall-clock `HH:mm` the way the locale writes times ("09:30", "9:30 AM"). */
export function formatTime(time: string, opts: FormatOptions = {}): string {
  const clean = normalizeTime(time)
  if (!clean) return ''
  const ms = utcMs(2000, 1, 1) + (Number(clean.slice(0, 2)) * 60 + Number(clean.slice(3))) * 60_000
  return formatCivil(ms, opts.locale, 'time')
}

/** A day, with its time of day when it has one. */
export function formatMoment(iso: string, opts: FormatOptions = {}): string {
  const day = formatDay(iso, opts)
  const time = timeOf(iso)
  return day && time ? `${day}, ${formatTime(time, opts)}` : day
}

export function formatDate(v: DateValue, opts: FormatOptions = {}): string {
  const start = formatMoment(v.start, opts)
  if (!start || !v.end) return start
  // A span within one day names the day once: "Oct 15, 2026, 09:00 → 10:30".
  if (dayKey(v.end) === dayKey(v.start)) {
    const from = timeOf(v.start)
    const to = timeOf(v.end)
    return from && to && to !== from ? `${start} → ${formatTime(to, opts)}` : start
  }
  const end = formatMoment(v.end, opts)
  return end ? `${start} → ${end}` : start
}

export function formatTimestamp(ms: number, opts: FormatOptions = {}): string {
  if (typeof ms !== 'number' || !isFinite(ms) || isNaN(new Date(ms).getTime())) return ''
  try {
    return new Intl.DateTimeFormat(opts.locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

export function monthLabel(year: number, month: number, locale?: string): string {
  return formatCivil(utcMs(year, month + 1, 1), locale, 'month')
}

/** Short weekday names starting on `weekStart` (0 = Sunday). */
export function weekdayLabels(locale?: string, weekStart = 0): string[] {
  const out: string[] = []
  // 2023-01-01 was a Sunday.
  for (let i = 0; i < 7; i++) out.push(formatCivil(utcMs(2023, 1, 1 + weekStart + i), locale, 'weekday'))
  return out
}

// ---------------------------------------------------------------------------
// Buckets (charts): civil days grouped into ISO weeks, months, quarters and years
// ---------------------------------------------------------------------------

export type DateBucket = 'day' | 'week' | 'month' | 'quarter' | 'year'

function dayStringOf(ms: number, fallback: string): string {
  const year = new Date(ms).getUTCFullYear()
  return isFinite(ms) && year >= 1 && year <= 9999 ? isoFromUtc(ms) : fallback
}

/** First day of the bucket a day falls in (weeks start on Monday, as in ISO 8601). Null for a non-day. */
export function bucketStart(iso: unknown, bucket: DateBucket): string | null {
  const ms = parseDayMs(iso)
  if (ms === null) return null
  const d = new Date(ms)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1
  const day = isoFromUtc(ms)
  switch (bucket) {
    case 'week':
      return dayStringOf(ms - ((d.getUTCDay() + 6) % 7) * MS_PER_DAY, day)
    case 'month':
      return isoFromUtc(utcMs(year, month, 1))
    case 'quarter':
      return isoFromUtc(utcMs(year, Math.floor((month - 1) / 3) * 3 + 1, 1))
    case 'year':
      return isoFromUtc(utcMs(year, 1, 1))
    default:
      return day
  }
}

/** First day of the bucket after the one starting on `start`; `start` itself at the end of the calendar. */
export function nextBucketStart(start: string, bucket: DateBucket): string {
  const ms = parseDayMs(start)
  if (ms === null) return start
  const d = new Date(ms)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1
  switch (bucket) {
    case 'week':
      return dayStringOf(ms + 7 * MS_PER_DAY, start)
    case 'month':
      return dayStringOf(utcMs(year, month + 1, 1), start)
    case 'quarter':
      return dayStringOf(utcMs(year, month + 3, 1), start)
    case 'year':
      return dayStringOf(utcMs(year + 1, 1, 1), start)
    default:
      return dayStringOf(ms + MS_PER_DAY, start)
  }
}

/** ISO 8601 week of a day: weeks start on Monday and belong to the year their Thursday falls in. */
export function isoWeekOf(iso: unknown): { year: number; week: number } | null {
  const ms = parseDayMs(iso)
  if (ms === null) return null
  const thursday = ms + (3 - ((new Date(ms).getUTCDay() + 6) % 7)) * MS_PER_DAY
  const year = new Date(thursday).getUTCFullYear()
  return { year, week: 1 + Math.floor((thursday - utcMs(year, 1, 1)) / (7 * MS_PER_DAY)) }
}

/** Axis label of the bucket that starts on `start`. */
export function bucketLabel(start: string, bucket: DateBucket, opts: FormatOptions = {}): string {
  const ms = parseDayMs(start)
  if (ms === null) return ''
  const d = new Date(ms)
  switch (bucket) {
    case 'week': {
      const week = isoWeekOf(start)
      return week ? `W${week.week} ${week.year}` : ''
    }
    case 'month':
      return formatCivil(ms, opts.locale, 'shortMonth')
    case 'quarter':
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`
    case 'year':
      return String(d.getUTCFullYear())
    default:
      return formatDay(start, opts)
  }
}
