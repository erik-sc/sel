/**
 * The recurrence picker's side that needs no screen: its presets, its "Custom" form and the rule
 * each one writes, and the first due date of a rule. Rules are the RRULE subset the quick add
 * writes (./parse.ts) and repeating tasks read (./recur.ts).
 */
import { civil, dayNumber, readRule, ruleDays, weekdayOf, type RecurrenceRule } from '../rrule'

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/
const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** The day number of a stored date (`YYYY-MM-DD…`), or null. */
function dayOfIso(value: string | null | undefined): number | null {
  const m = typeof value === 'string' ? DAY_RE.exec(value) : null
  if (!m) return null
  const day = dayNumber(Number(m[1]), Number(m[2]), Number(m[3]))
  const back = civil(day)
  return back.month === Number(m[2]) && back.date === Number(m[3]) ? day : null
}

function isoOfDay(day: number): string {
  const { year, month, date } = civil(day)
  return `${pad(year, 4)}-${pad(month)}-${pad(date)}`
}

export type RepeatPreset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export const REPEAT_PRESETS: readonly RepeatPreset[] = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly']

/**
 * The rule of a preset, anchored on a day (`YYYY-MM-DD`, the task's due date or today): weekly on
 * its weekday, monthly on its date, yearly on its month and date.
 */
export function presetRule(preset: RepeatPreset, anchor: string): string {
  const day = dayOfIso(anchor) ?? 0
  const { month, date } = civil(day)
  switch (preset) {
    case 'daily':
      return 'FREQ=DAILY'
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${RRULE_DAYS[weekdayOf(day)]}`
    case 'monthly':
      return `FREQ=MONTHLY;BYMONTHDAY=${date}`
    case 'yearly':
      return `FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${date}`
  }
}

/** The preset a rule is, for that anchor; null when it is something else (shown as Custom). */
export function presetOf(rule: string, anchor: string): RepeatPreset | null {
  const form = formOf(rule)
  if (!form) return null
  const canonical = ruleOf(form)
  return REPEAT_PRESETS.find((preset) => presetRule(preset, anchor) === canonical) ?? null
}

export type RepeatEnd = { kind: 'never' } | { kind: 'until'; date: string } | { kind: 'count'; count: number }

/** The "Custom" form: every N periods, on these weekdays / this day of the month, until… */
export interface RepeatForm {
  freq: RecurrenceRule['freq']
  /** 1 to 999. */
  interval: number
  /** Weekly: the weekdays (0 = Sunday), Monday first; empty = the due date's. */
  weekdays: number[]
  /** Monthly: the day of the month (-1 = the last); yearly: with `month`. Null = the due date's. */
  monthDay: number | null
  /** Yearly: 1 to 12, with `monthDay`. */
  month: number | null
  end: RepeatEnd
}

export function defaultForm(): RepeatForm {
  return { freq: 'WEEKLY', interval: 1, weekdays: [], monthDay: null, month: null, end: { kind: 'never' } }
}

const byWeekOrder = (a: number, b: number): number => ((a + 6) % 7) - ((b + 6) % 7)

/**
 * A rule as the Custom form; null when it says more than the form can (ordinal weekdays, set
 * positions, several months…): such a rule is kept as it is, and shown in words.
 */
export function formOf(value: string): RepeatForm | null {
  const { rule, until } = readRule(value.replace(/^RRULE:/i, ''))
  if (!rule || rule.bySetPos.length || rule.byDay.some((entry) => entry.ordinal !== 0)) return null
  const form: RepeatForm = { ...defaultForm(), freq: rule.freq, interval: Math.min(999, rule.interval) }
  if (rule.freq === 'WEEKLY') {
    if (rule.byMonth.length || rule.byMonthDay.length) return null
    form.weekdays = [...new Set(rule.byDay.map((entry) => entry.weekday))].sort(byWeekOrder)
  } else if (rule.freq === 'MONTHLY') {
    if (rule.byDay.length || rule.byMonth.length || rule.byMonthDay.length > 1) return null
    form.monthDay = rule.byMonthDay[0] ?? null
  } else if (rule.freq === 'YEARLY') {
    if (rule.byDay.length || rule.byMonth.length > 1 || rule.byMonthDay.length > 1) return null
    if (rule.byMonth.length !== rule.byMonthDay.length) return null
    form.month = rule.byMonth[0] ?? null
    form.monthDay = rule.byMonthDay[0] ?? null
    if (form.monthDay !== null && form.monthDay < 1) return null
  } else if (rule.byDay.length || rule.byMonth.length || rule.byMonthDay.length) return null
  if (rule.count !== undefined) form.end = { kind: 'count', count: rule.count }
  else if (until) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(until)
    if (!m) return null
    form.end = { kind: 'until', date: `${m[1]}-${m[2]}-${m[3]}` }
  }
  return form
}

/** The rule a Custom form writes. */
export function ruleOf(form: RepeatForm): string {
  const parts = [`FREQ=${form.freq}`]
  const interval = Math.max(1, Math.min(999, Math.round(form.interval) || 1))
  if (interval > 1) parts.push(`INTERVAL=${interval}`)
  if (form.freq === 'WEEKLY' && form.weekdays.length) {
    parts.push(
      `BYDAY=${[...new Set(form.weekdays)]
        .sort(byWeekOrder)
        .map((day) => RRULE_DAYS[day])
        .join(',')}`
    )
  }
  if (form.freq === 'MONTHLY' && form.monthDay !== null) parts.push(`BYMONTHDAY=${form.monthDay}`)
  if (form.freq === 'YEARLY' && form.month !== null && form.monthDay !== null)
    parts.push(`BYMONTH=${form.month}`, `BYMONTHDAY=${form.monthDay}`)
  if (form.end.kind === 'count') parts.push(`COUNT=${Math.max(1, Math.min(999, Math.round(form.end.count) || 1))}`)
  if (form.end.kind === 'until' && dayOfIso(form.end.date) !== null) parts.push(`UNTIL=${form.end.date.slice(0, 10).replaceAll('-', '')}`)
  return parts.join(';')
}

/**
 * The first day a rule falls on from `from` (`YYYY-MM-DD`, that day included): the due date a
 * task gets when a repeat is set on a task without one. Null when there is none (it ended).
 */
export function firstOccurrence(rule: string, from: string): string | null {
  const { rule: parsed, until } = readRule(rule)
  const start = dayOfIso(from)
  if (!parsed || start === null) return null
  const last = until ? dayOfIso(`${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`) : null
  const unit = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[parsed.freq]
  const toDay = start + Math.min((parsed.interval + 1) * unit + 1500, 366 * 40)
  const days = ruleDays({ ...parsed, count: undefined }, start, start, toDay, (day) =>
    day < start ? 'before' : last !== null && day > last ? 'after' : 'ok'
  )
  return days.length ? isoOfDay(days[0]) : null
}
