/**
 * Recurrence rules (RFC 5545 RRULE) on the civil calendar: reading a rule and listing the days it
 * falls on. Shared by the calendar reader (main/briefing/ical.ts), which adds zones and times of
 * day, and by repeating tasks (shared/tasks/recur.ts), which only need days.
 *
 * Days are numbered: whole days since 1970-01-01. Pure, bounded, and nothing here throws.
 */

const DAY_MS = 86_400_000

export const RRULE_LIMITS = {
  /** Periods (days, weeks, months, years) one rule is stepped through. */
  periods: 30_000,
  /** Candidate dates one rule may produce. */
  candidates: 60_000
} as const

export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count?: number
  /** As an instant when written in UTC, otherwise as naive wall time (the end of the day for a date). */
  until?: { instant?: number; wall?: number }
  byDay: { ordinal: number; weekday: number }[]
  byMonthDay: number[]
  byMonth: number[]
  bySetPos: number[]
  /** 0 = Sunday. */
  weekStart: number
}

export const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function intList(value: string | undefined, min: number, max: number, allowNegative: boolean, cap = 64): number[] {
  if (!value) return []
  const out: number[] = []
  for (const part of value.split(',')) {
    if (out.length >= cap) break
    if (!/^[+-]?\d{1,4}$/.test(part.trim())) continue
    const n = Number(part)
    const size = Math.abs(n)
    if (n === 0 || size < min || size > max || (n < 0 && !allowNegative)) continue
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/**
 * The parts of an RRULE value. Null when it is malformed; `unsupported` when it uses parts that
 * are not expanded. UNTIL comes back as written: what it means depends on the zone of the start,
 * which the caller knows (the calendar reader resolves it, a task reads its day).
 */
export function readRule(value: string): { rule: RecurrenceRule | null; unsupported: boolean; until?: string } {
  const parts: Record<string, string> = Object.create(null) as Record<string, string>
  for (const piece of value.split(';')) {
    const eq = piece.indexOf('=')
    if (eq > 0) parts[piece.slice(0, eq).trim().toUpperCase()] = piece.slice(eq + 1).trim()
  }
  const freq = (parts['FREQ'] ?? '').toUpperCase()
  if (freq === 'SECONDLY' || freq === 'MINUTELY' || freq === 'HOURLY') return { rule: null, unsupported: true }
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return { rule: null, unsupported: false }
  const unsupported = ['BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND'].some((key) => key in parts)
  const interval = /^\d{1,4}$/.test(parts['INTERVAL'] ?? '') ? Math.max(1, Number(parts['INTERVAL'])) : 1
  const rule: RecurrenceRule = { freq, interval, byDay: [], byMonthDay: [], byMonth: [], bySetPos: [], weekStart: 1 }
  if (/^\d{1,6}$/.test(parts['COUNT'] ?? '')) rule.count = Number(parts['COUNT'])
  for (const part of (parts['BYDAY'] ?? '').split(',')) {
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(part.trim())
    if (!match || rule.byDay.length >= 64) continue
    const ordinal = match[1] ? Number(match[1]) : 0
    if (Math.abs(ordinal) > 53) continue
    rule.byDay.push({ ordinal, weekday: WEEKDAYS[match[2].toUpperCase()] })
  }
  rule.byMonthDay = intList(parts['BYMONTHDAY'], 1, 31, true)
  rule.byMonth = intList(parts['BYMONTH'], 1, 12, false)
  rule.bySetPos = intList(parts['BYSETPOS'], 1, 366, true)
  const weekStart = WEEKDAYS[(parts['WKST'] ?? '').toUpperCase()]
  if (weekStart !== undefined) rule.weekStart = weekStart
  return parts['UNTIL'] ? { rule, unsupported, until: parts['UNTIL'] } : { rule, unsupported }
}

export const mod = (n: number, m: number): number => ((n % m) + m) % m
/** Day number: whole days since 1970-01-01 on the civil calendar. */
export const dayOf = (wall: number): number => Math.floor(wall / DAY_MS)
/** 0 = Sunday. */
export const weekdayOf = (day: number): number => mod(day + 4, 7)

export function civil(day: number): { year: number; month: number; date: number } {
  const d = new Date(day * DAY_MS)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate() }
}

export function dayNumber(year: number, month: number, date: number): number {
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, date)
  return Math.floor(d.getTime() / DAY_MS)
}

export function daysInMonth(year: number, month: number): number {
  return civil(dayNumber(year, month + 1, 1) - 1).date
}

/** The days of one month that a rule's BYMONTHDAY / BYDAY select, or the fallback day when it has neither. */
function monthDays(rule: RecurrenceRule, year: number, month: number, fallbackDate: number, into: number[]): void {
  const length = daysInMonth(year, month)
  const first = dayNumber(year, month, 1)
  if (rule.byMonthDay.length) {
    for (const n of rule.byMonthDay) {
      const date = n > 0 ? n : length + 1 + n
      if (date < 1 || date > length) continue
      const day = first + date - 1
      if (rule.byDay.length && !rule.byDay.some((entry) => entry.weekday === weekdayOf(day))) continue
      into.push(day)
    }
  } else if (rule.byDay.length) {
    for (const { ordinal, weekday } of rule.byDay) {
      const offset = mod(weekday - weekdayOf(first), 7)
      if (ordinal === 0) {
        for (let date = 1 + offset; date <= length; date += 7) into.push(first + date - 1)
      } else if (ordinal > 0) {
        const date = 1 + offset + (ordinal - 1) * 7
        if (date <= length) into.push(first + date - 1)
      } else {
        const last = first + length - 1
        const date = length - mod(weekdayOf(last) - weekday, 7) + (ordinal + 1) * 7
        if (date >= 1) into.push(first + date - 1)
      }
    }
  } else if (fallbackDate <= length) {
    into.push(first + fallbackDate - 1)
  }
}

/** The days of one year a yearly rule without BYMONTH selects through BYDAY (ordinals count within the year). */
function yearWeekdays(rule: RecurrenceRule, year: number, into: number[]): void {
  const first = dayNumber(year, 1, 1)
  const last = dayNumber(year + 1, 1, 1) - 1
  for (const { ordinal, weekday } of rule.byDay) {
    if (ordinal === 0) {
      for (let day = first + mod(weekday - weekdayOf(first), 7); day <= last; day += 7) into.push(day)
    } else if (ordinal > 0) {
      const day = first + mod(weekday - weekdayOf(first), 7) + (ordinal - 1) * 7
      if (day <= last) into.push(day)
    } else {
      const day = last - mod(weekdayOf(last) - weekday, 7) + (ordinal + 1) * 7
      if (day >= first) into.push(day)
    }
  }
}

/**
 * The start days of a rule's occurrences whose day falls in [fromDay, toDay], in order.
 * `accept` decides, for a candidate day, whether it is at or after the start and not past
 * UNTIL (it needs the time of day and the zone, which this function does not know).
 * Counting for COUNT starts at the first occurrence, so a rule with one is walked from its
 * beginning; any other rule jumps close to the window first.
 */
export function ruleDays(
  rule: RecurrenceRule,
  startDay: number,
  fromDay: number,
  toDay: number,
  accept: (day: number) => 'before' | 'ok' | 'after'
): number[] {
  const out: number[] = []
  const start = civil(startDay)
  const interval = rule.interval
  let remaining = rule.count ?? Infinity
  let candidates = 0
  const weekAnchor = startDay - mod(weekdayOf(startDay) - rule.weekStart, 7)
  const monthIndex = start.year * 12 + (start.month - 1)

  // Where to begin: period 0, or the last period that starts before the window.
  let k = 0
  if (rule.count === undefined && fromDay > startDay) {
    const from = civil(fromDay)
    const periods =
      rule.freq === 'DAILY'
        ? fromDay - startDay
        : rule.freq === 'WEEKLY'
          ? Math.floor((fromDay - weekAnchor) / 7)
          : rule.freq === 'MONTHLY'
            ? from.year * 12 + (from.month - 1) - monthIndex
            : from.year - start.year
    k = Math.max(0, Math.floor(periods / interval) - 1)
  }

  const set: number[] = []
  for (let steps = 0; steps < RRULE_LIMITS.periods && remaining > 0; steps++, k++) {
    set.length = 0
    let periodStart: number
    if (rule.freq === 'DAILY') {
      const day = startDay + k * interval
      periodStart = day
      const c = civil(day)
      let ok = !rule.byMonth.length || rule.byMonth.includes(c.month)
      if (ok && rule.byMonthDay.length) {
        const length = daysInMonth(c.year, c.month)
        ok = rule.byMonthDay.some((n) => (n > 0 ? n : length + 1 + n) === c.date)
      }
      if (ok && rule.byDay.length) ok = rule.byDay.some((entry) => entry.weekday === weekdayOf(day))
      if (ok) set.push(day)
    } else if (rule.freq === 'WEEKLY') {
      const week = weekAnchor + k * interval * 7
      periodStart = week
      if (rule.byDay.length) {
        for (const { weekday } of rule.byDay) set.push(week + mod(weekday - rule.weekStart, 7))
      } else set.push(week + mod(weekdayOf(startDay) - rule.weekStart, 7))
      if (rule.byMonth.length) {
        for (let i = set.length - 1; i >= 0; i--) if (!rule.byMonth.includes(civil(set[i]).month)) set.splice(i, 1)
      }
    } else if (rule.freq === 'MONTHLY') {
      const index = monthIndex + k * interval
      const year = Math.floor(index / 12)
      const month = mod(index, 12) + 1
      if (year > 9999) break
      periodStart = dayNumber(year, month, 1)
      if (!rule.byMonth.length || rule.byMonth.includes(month)) monthDays(rule, year, month, start.date, set)
    } else {
      const year = start.year + k * interval
      if (year > 9999) break
      periodStart = dayNumber(year, 1, 1)
      if (rule.byMonth.length) {
        for (const month of rule.byMonth) monthDays(rule, year, month, start.date, set)
      } else if (rule.byMonthDay.length) {
        for (let month = 1; month <= 12; month++) monthDays(rule, year, month, start.date, set)
      } else if (rule.byDay.length) {
        yearWeekdays(rule, year, set)
      } else {
        monthDays(rule, year, start.month, start.date, set)
      }
    }
    if (periodStart > toDay) break
    if (!set.length) continue
    set.sort((a, b) => a - b)
    // The same day can be named twice (BYDAY=MO,MO): once is enough.
    let days = set.filter((day, index) => index === 0 || day !== set[index - 1])
    if (rule.bySetPos.length) {
      const picked: number[] = []
      for (const position of rule.bySetPos) {
        const day = position > 0 ? days[position - 1] : days[days.length + position]
        if (day !== undefined && !picked.includes(day)) picked.push(day)
      }
      days = picked.sort((a, b) => a - b)
    }
    let ended = false
    for (const day of days) {
      if (++candidates > RRULE_LIMITS.candidates) return out
      const verdict = accept(day)
      if (verdict === 'before') continue
      if (verdict === 'after') {
        ended = true
        break
      }
      if (remaining-- <= 0) {
        ended = true
        break
      }
      if (day >= fromDay && day <= toDay) out.push(day)
    }
    if (ended) break
  }
  return out
}
