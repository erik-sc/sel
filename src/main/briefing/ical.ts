/**
 * iCalendar (RFC 5545) reading for the briefing: a parser for the parts of a calendar file that
 * say when things happen, and an expander that turns them into the events of a window of time.
 * Pure: no file, network or Electron access, and no library. The only clock it knows is the
 * `Intl` time-zone database and the process's local zone.
 *
 * What is read: VEVENT with DTSTART / DTEND / DURATION (dates and date-times; UTC, floating and
 * TZID), SUMMARY, LOCATION, DESCRIPTION, STATUS, TRANSP, ATTENDEE (to hide what the owner
 * declined), RRULE (FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY with
 * ordinals, BYMONTHDAY, BYMONTH, BYSETPOS, WKST), EXDATE, RDATE and RECURRENCE-ID overrides.
 *
 * What is not: VTIMEZONE definitions (zones are resolved by name against the IANA database, with
 * the common Windows names mapped), sub-daily frequencies, BYWEEKNO / BYYEARDAY / BYHOUR /
 * BYMINUTE / BYSECOND (an event with one of these keeps its first occurrence only), RANGE=
 * THISANDFUTURE on overrides, RDATE periods (their start is used), VTODO, VJOURNAL, VFREEBUSY.
 *
 * The content is hostile until proven otherwise: every loop is bounded, a malformed component
 * is skipped, and nothing here throws on any input.
 */

import { civil, dayOf, mod, readRule, RRULE_LIMITS, ruleDays, type RecurrenceRule } from '../../shared/rrule'

export const ICAL_LIMITS = {
  /** Characters of one unfolded line; longer ones are cut. */
  line: 32_768,
  /** VEVENTs kept from one file. */
  events: 20_000,
  /** EXDATE / RDATE values kept per event. */
  dates: 2_000,
  /** Periods (days, weeks, months, years) one rule is stepped through. */
  periods: RRULE_LIMITS.periods,
  /** Candidate dates one rule may produce. */
  candidates: RRULE_LIMITS.candidates,
  /** Time-zone conversions one expansion may make. */
  conversions: 250_000,
  /** Occurrences returned for one window. */
  occurrences: 2_000,
  title: 300,
  location: 300,
  description: 500
} as const

const DAY_MS = 86_400_000

// ---- lines --------------------------------------------------------------------

export interface IcalLine {
  name: string
  params: Record<string, string>
  value: string
}

/** Splits into content lines, joining the continuation lines (those that start with a space or a tab). */
export function unfold(text: string): string[] {
  const out: string[] = []
  let current: string | null = null
  let at = 0
  const length = text.length
  while (at <= length) {
    let end = at
    while (end < length) {
      const code = text.charCodeAt(end)
      if (code === 10 || code === 13) break
      end++
    }
    const raw = text.slice(at, end)
    // \r\n counts as one break.
    at = end + (text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? 2 : 1)
    const first = raw.charCodeAt(0)
    if (current !== null && (first === 32 || first === 9)) {
      if (current.length < ICAL_LIMITS.line) current += raw.slice(1)
    } else {
      if (current !== null && current !== '') out.push(current.length > ICAL_LIMITS.line ? current.slice(0, ICAL_LIMITS.line) : current)
      current = raw
    }
  }
  if (current !== null && current !== '') out.push(current.length > ICAL_LIMITS.line ? current.slice(0, ICAL_LIMITS.line) : current)
  return out
}

/** `NAME;PARAM=value;PARAM="quoted:value":value`. Null when the line has no name or no colon. */
export function parseLine(line: string): IcalLine | null {
  let at = 0
  const length = line.length
  while (at < length) {
    const ch = line[at]
    if (ch === ';' || ch === ':') break
    at++
  }
  if (at === 0 || at >= length) return null
  const name = line.slice(0, at).toUpperCase()
  if (!/^[A-Z0-9-]+$/.test(name)) return null
  const params: Record<string, string> = Object.create(null) as Record<string, string>
  while (line[at] === ';') {
    at++
    const eq = line.indexOf('=', at)
    if (eq < 0) return null
    const key = line.slice(at, eq).toUpperCase()
    at = eq + 1
    let value = ''
    // A parameter value is a list of quoted or bare strings; a quoted one may hold `:` and `;`.
    for (;;) {
      if (line[at] === '"') {
        const close = line.indexOf('"', at + 1)
        if (close < 0) return null
        value += line.slice(at + 1, close)
        at = close + 1
      } else {
        const start = at
        while (at < length && line[at] !== ';' && line[at] !== ':' && line[at] !== ',') at++
        value += line.slice(start, at)
      }
      if (line[at] === ',') {
        value += ','
        at++
      } else break
    }
    if (/^[A-Z0-9-]+$/.test(key) && !(key in params)) params[key] = value
    if (at >= length) return null
  }
  if (line[at] !== ':') return null
  return { name, params, value: line.slice(at + 1) }
}

/** TEXT values: `\n`, `\,`, `\;` and `\\`. */
export function unescapeText(value: string): string {
  if (!value.includes('\\')) return value
  return value.replace(/\\([\\;,nN])/g, (_all, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch))
}

/** Splits a value on the commas that are not escaped. */
function splitList(value: string): string[] {
  if (!value.includes('\\')) return value.split(',')
  const out: string[] = []
  let current = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && i + 1 < value.length) {
      current += ch + value[++i]
    } else if (ch === ',') {
      out.push(current)
      current = ''
    } else current += ch
  }
  out.push(current)
  return out
}

function entities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/** One line of plain text: control characters out, whitespace collapsed, capped. */
function plainLine(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const text = unescapeText(value).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/**
 * A description as plain text. Calendars put HTML in descriptions; the tags are removed here
 * and the result is only ever shown as text.
 */
export function plainDescription(value: string, max: number = ICAL_LIMITS.description): string {
  const raw = unescapeText(value.length > 20_000 ? value.slice(0, 20_000) : value)
  const text = entities(raw.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]{0,2000}>/g, ''))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

// ---- time zones ---------------------------------------------------------------

/** The Windows zone names calendars written by Outlook and Exchange use, as IANA zones. */
const WINDOWS_ZONES: Record<string, string> = {
  'dateline standard time': 'Etc/GMT+12',
  'utc-11': 'Etc/GMT+11',
  'hawaiian standard time': 'Pacific/Honolulu',
  'alaskan standard time': 'America/Anchorage',
  'pacific standard time': 'America/Los_Angeles',
  'pacific standard time (mexico)': 'America/Tijuana',
  'us mountain standard time': 'America/Phoenix',
  'mountain standard time': 'America/Denver',
  'mountain standard time (mexico)': 'America/Mazatlan',
  'central america standard time': 'America/Guatemala',
  'central standard time': 'America/Chicago',
  'central standard time (mexico)': 'America/Mexico_City',
  'canada central standard time': 'America/Regina',
  'sa pacific standard time': 'America/Bogota',
  'eastern standard time': 'America/New_York',
  'us eastern standard time': 'America/Indiana/Indianapolis',
  'venezuela standard time': 'America/Caracas',
  'paraguay standard time': 'America/Asuncion',
  'atlantic standard time': 'America/Halifax',
  'central brazilian standard time': 'America/Cuiaba',
  'sa western standard time': 'America/La_Paz',
  'pacific sa standard time': 'America/Santiago',
  'newfoundland standard time': 'America/St_Johns',
  'e. south america standard time': 'America/Sao_Paulo',
  'tocantins standard time': 'America/Araguaina',
  'bahia standard time': 'America/Bahia',
  'sa eastern standard time': 'America/Cayenne',
  'argentina standard time': 'America/Argentina/Buenos_Aires',
  'greenland standard time': 'America/Nuuk',
  'montevideo standard time': 'America/Montevideo',
  'utc-02': 'Etc/GMT+2',
  'azores standard time': 'Atlantic/Azores',
  'cape verde standard time': 'Atlantic/Cape_Verde',
  utc: 'UTC',
  'coordinated universal time': 'UTC',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'morocco standard time': 'Africa/Casablanca',
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'romance standard time': 'Europe/Paris',
  'central european standard time': 'Europe/Warsaw',
  'w. central africa standard time': 'Africa/Lagos',
  'gtb standard time': 'Europe/Bucharest',
  'middle east standard time': 'Asia/Beirut',
  'egypt standard time': 'Africa/Cairo',
  'south africa standard time': 'Africa/Johannesburg',
  'fle standard time': 'Europe/Kyiv',
  'israel standard time': 'Asia/Jerusalem',
  'e. europe standard time': 'Europe/Chisinau',
  'turkey standard time': 'Europe/Istanbul',
  'arabic standard time': 'Asia/Baghdad',
  'arab standard time': 'Asia/Riyadh',
  'russian standard time': 'Europe/Moscow',
  'e. africa standard time': 'Africa/Nairobi',
  'iran standard time': 'Asia/Tehran',
  'arabian standard time': 'Asia/Dubai',
  'azerbaijan standard time': 'Asia/Baku',
  'caucasus standard time': 'Asia/Yerevan',
  'afghanistan standard time': 'Asia/Kabul',
  'west asia standard time': 'Asia/Tashkent',
  'pakistan standard time': 'Asia/Karachi',
  'india standard time': 'Asia/Kolkata',
  'sri lanka standard time': 'Asia/Colombo',
  'nepal standard time': 'Asia/Kathmandu',
  'central asia standard time': 'Asia/Almaty',
  'bangladesh standard time': 'Asia/Dhaka',
  'myanmar standard time': 'Asia/Yangon',
  'se asia standard time': 'Asia/Bangkok',
  'china standard time': 'Asia/Shanghai',
  'singapore standard time': 'Asia/Singapore',
  'w. australia standard time': 'Australia/Perth',
  'taipei standard time': 'Asia/Taipei',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'cen. australia standard time': 'Australia/Adelaide',
  'aus central standard time': 'Australia/Darwin',
  'e. australia standard time': 'Australia/Brisbane',
  'aus eastern standard time': 'Australia/Sydney',
  'tasmania standard time': 'Australia/Hobart',
  'west pacific standard time': 'Pacific/Port_Moresby',
  'central pacific standard time': 'Pacific/Guadalcanal',
  'new zealand standard time': 'Pacific/Auckland',
  'fiji standard time': 'Pacific/Fiji',
  'tonga standard time': 'Pacific/Tongatapu',
  'samoa standard time': 'Pacific/Apia'
}

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  let formatter = formatters.get(zone)
  if (formatter !== undefined) return formatter
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
  } catch {
    formatter = null
  }
  // A hostile file could name any number of zones: the cache stays small.
  if (formatters.size > 400) formatters.clear()
  formatters.set(zone, formatter)
  return formatter
}

/**
 * The IANA zone a TZID names: itself when the runtime knows it, the zone behind a Windows
 * name, or the IANA name at the end of a prefixed id (`/mozilla.org/20050126_1/Europe/Berlin`).
 * Null when it cannot be told.
 */
export function resolveZone(tzid: string): string | null {
  const id = tzid.trim().replace(/^"|"$/g, '')
  if (!id || id.length > 120) return null
  if (/^(utc|gmt|z|etc\/utc|etc\/gmt)$/i.test(id)) return 'UTC'
  const mapped = WINDOWS_ZONES[id.toLowerCase()]
  if (mapped) return formatterFor(mapped) ? mapped : null
  if (/^[A-Za-z0-9_+\-/]+$/.test(id) && formatterFor(id)) return id
  const parts = id.split('/').filter(Boolean)
  for (let take = 3; take >= 2; take--) {
    if (parts.length <= take) continue
    const tail = parts.slice(-take).join('/')
    if (/^[A-Za-z0-9_+\-/]+$/.test(tail) && formatterFor(tail)) return tail
  }
  return null
}

/** The wall clock of `zone` at an instant, as "naive" ms: the same digits read as if they were UTC. */
export function zoneWall(instant: number, zone: string): number {
  if (zone === 'UTC') return instant
  const formatter = formatterFor(zone)
  if (!formatter) return instant
  let year = 0
  let month = 1
  let day = 1
  let hour = 0
  let minute = 0
  let second = 0
  for (const part of formatter.formatToParts(instant)) {
    const n = Number(part.value)
    if (part.type === 'year') year = n
    else if (part.type === 'month') month = n
    else if (part.type === 'day') day = n
    else if (part.type === 'hour') hour = n === 24 ? 0 : n
    else if (part.type === 'minute') minute = n
    else if (part.type === 'second') second = n
  }
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

/**
 * The instant at which the wall clock of `zone` shows the naive time `wall`. A time that
 * happens twice (clocks going back) is its first occurrence; a time that never happens
 * (clocks going forward) is read with the offset before the gap, as RFC 5545 asks: 02:30 on
 * such a night is 03:30.
 */
export function zoneInstant(wall: number, zone: string): number {
  if (zone === 'UTC') return wall
  if (!formatterFor(zone)) return wall
  const offsets = new Set<number>()
  for (const probe of [wall - 26 * 3_600_000, wall, wall + 26 * 3_600_000]) offsets.add(zoneWall(probe, zone) - probe)
  let best: number | null = null
  let smallest = Infinity
  for (const offset of offsets) {
    if (offset < smallest) smallest = offset
    const instant = wall - offset
    if (zoneWall(instant, zone) === wall && (best === null || instant < best)) best = instant
  }
  return best ?? wall - smallest
}

/** The same two conversions for the process's own zone (floating times and all-day events). */
function localInstant(wall: number): number {
  const d = new Date(wall)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime()
}

function localWall(instant: number): number {
  const d = new Date(instant)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())
}

// ---- values -------------------------------------------------------------------

/**
 * A DATE or DATE-TIME. `wall` is naive ms: the calendar fields read as if they were UTC.
 * `zone` is an IANA name, 'UTC', or null for a floating time (the process's zone).
 */
export interface IcalTime {
  date: boolean
  wall: number
  zone: string | null
}

export type IcalRule = RecurrenceRule

export interface IcalEvent {
  uid: string
  start: IcalTime
  /** Naive length when start and end share a zone (so 09:00–10:00 stays that across a clock change). */
  wallDuration: number
  /** Exact length, used when the end is in another zone. */
  exactDuration: number | null
  title: string
  location?: string
  description?: string
  cancelled: boolean
  declined: boolean
  /** TRANSP:TRANSPARENT: does not block time. */
  transparent: boolean
  rule?: IcalRule
  /** The rule has parts this reader does not expand: only the first occurrence is kept. */
  ruleUnsupported?: boolean
  exdates: IcalTime[]
  rdates: IcalTime[]
  recurrenceId?: IcalTime
}

export type IcalNote = 'unknown-timezone' | 'unsupported-rule' | 'truncated'

export interface ParsedCalendar {
  name?: string
  events: IcalEvent[]
  notes: IcalNote[]
}

function utcDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number | null {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 60) return null
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  d.setUTCHours(hour, minute, Math.min(second, 59), 0)
  // 31 February and friends roll over: they are not dates.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return d.getTime()
}

interface ZoneContext {
  notes: Set<IcalNote>
  cache: Map<string, string | null>
}

function zoneOf(tzid: string | undefined, context: ZoneContext): string | null {
  if (!tzid) return null
  let zone = context.cache.get(tzid)
  if (zone === undefined) {
    zone = resolveZone(tzid)
    if (context.cache.size < 200) context.cache.set(tzid, zone)
  }
  // An unknown zone falls back to the process's own; the caller is told through a note.
  if (zone === null) context.notes.add('unknown-timezone')
  return zone
}

const TIME_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i

function parseTime(value: string, params: Record<string, string>, context: ZoneContext): IcalTime | null {
  const match = TIME_RE.exec(value.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s, z] = match
  if (h === undefined) {
    const wall = utcDate(Number(y), Number(mo), Number(d))
    return wall === null ? null : { date: true, wall, zone: null }
  }
  if ((params['VALUE'] ?? '').toUpperCase() === 'DATE') return null
  const wall = utcDate(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s))
  if (wall === null) return null
  return { date: false, wall, zone: z ? 'UTC' : zoneOf(params['TZID'], context) }
}

function parseTimes(value: string, params: Record<string, string>, context: ZoneContext, into: IcalTime[]): void {
  for (const part of value.split(',')) {
    if (into.length >= ICAL_LIMITS.dates) return
    // RDATE may hold periods (`start/end`): their start is what recurs.
    const time = parseTime(part.split('/')[0], params, context)
    if (time) into.push(time)
  }
}

const DURATION_RE = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i

/** `P1DT2H30M` in ms; null when it is not a duration. Negative ones count as zero. */
export function parseDuration(value: string): number | null {
  const match = DURATION_RE.exec(value.trim())
  if (!match || value.trim().length < 3) return null
  const [, sign, w, d, h, m, s] = match
  if (w === undefined && d === undefined && h === undefined && m === undefined && s === undefined) return null
  const total = Number(w ?? 0) * 7 * DAY_MS + Number(d ?? 0) * DAY_MS + Number(h ?? 0) * 3_600_000 + Number(m ?? 0) * 60_000 + Number(s ?? 0) * 1000
  if (!Number.isFinite(total)) return null
  return sign === '-' ? 0 : Math.min(total, 3660 * DAY_MS)
}

/** An RRULE value. Null when it is malformed; `unsupported` when it uses parts this reader does not expand. */
export function parseRule(value: string, context: ZoneContext = { notes: new Set(), cache: new Map() }): { rule: IcalRule | null; unsupported: boolean } {
  const { rule, unsupported, until } = readRule(value)
  if (rule && until) {
    const time = parseTime(until, {}, context)
    if (time) rule.until = time.date ? { wall: time.wall + DAY_MS - 1 } : time.zone === 'UTC' ? { instant: time.wall } : { wall: time.wall }
  }
  return { rule, unsupported }
}

// ---- parsing ------------------------------------------------------------------

/** True when the text starts like an iCalendar file (after an optional byte-order mark and blank lines). */
export function looksLikeCalendar(text: string): boolean {
  return /^﻿?\s*BEGIN:VCALENDAR\s*(?:\r|\n|$)/i.test(text.slice(0, 512))
}

function emailOf(value: string): string | null {
  const match = /^mailto:(.+)$/i.exec(value.trim())
  const email = (match ? match[1] : value).trim().toLowerCase()
  return /^[^\s@<>]+@[^\s@<>]+$/.test(email) ? email : null
}

interface Draft {
  lines: IcalLine[]
}

function buildEvent(draft: Draft, context: ZoneContext, self: ReadonlySet<string>): IcalEvent | null {
  let uid = ''
  let start: IcalTime | null = null
  let end: IcalTime | null = null
  let duration: number | null = null
  let title = ''
  let location = ''
  let description = ''
  let cancelled = false
  let declined = false
  let transparent = false
  let rule: IcalRule | undefined
  let ruleUnsupported = false
  let recurrenceId: IcalTime | undefined
  const exdates: IcalTime[] = []
  const rdates: IcalTime[] = []

  for (const line of draft.lines) {
    switch (line.name) {
      case 'UID':
        uid = line.value.trim().slice(0, 400)
        break
      case 'DTSTART':
        start = parseTime(line.value, line.params, context)
        break
      case 'DTEND':
        end = parseTime(line.value, line.params, context)
        break
      case 'DURATION':
        duration = parseDuration(line.value)
        break
      case 'SUMMARY':
        title = plainLine(line.value, ICAL_LIMITS.title)
        break
      case 'LOCATION':
        location = plainLine(line.value, ICAL_LIMITS.location)
        break
      case 'DESCRIPTION':
        description = plainDescription(line.value)
        break
      case 'STATUS':
        cancelled = line.value.trim().toUpperCase() === 'CANCELLED'
        break
      case 'TRANSP':
        transparent = line.value.trim().toUpperCase() === 'TRANSPARENT'
        break
      case 'ATTENDEE': {
        if ((line.params['PARTSTAT'] ?? '').toUpperCase() !== 'DECLINED' || self.size === 0) break
        const email = emailOf(line.value)
        if (email && self.has(email)) declined = true
        break
      }
      case 'RRULE': {
        // Only the first rule counts: a second one was deprecated by RFC 5545.
        if (rule || ruleUnsupported) break
        const parsed = parseRule(line.value, context)
        if (parsed.rule) rule = parsed.rule
        ruleUnsupported = parsed.unsupported
        break
      }
      case 'EXDATE':
        parseTimes(line.value, line.params, context, exdates)
        break
      case 'RDATE':
        parseTimes(line.value, line.params, context, rdates)
        break
      case 'RECURRENCE-ID':
        recurrenceId = parseTime(line.value, line.params, context) ?? undefined
        break
    }
  }
  if (!start) return null
  let wallDuration = 0
  let exactDuration: number | null = null
  if (end && end.date === start.date) {
    if (end.zone === start.zone) wallDuration = Math.max(0, end.wall - start.wall)
    else exactDuration = Math.max(0, timeInstant(end) - timeInstant(start))
  } else if (duration !== null) {
    wallDuration = duration
  }
  if (start.date) {
    // A day at least, in whole days.
    wallDuration = Math.max(DAY_MS, Math.ceil(wallDuration / DAY_MS) * DAY_MS)
    exactDuration = null
  }
  wallDuration = Math.min(wallDuration, 3660 * DAY_MS)
  if (ruleUnsupported) {
    context.notes.add('unsupported-rule')
    if (rule) rule = undefined
  }
  const event: IcalEvent = {
    uid: uid || `no-uid-${start.wall}-${title.slice(0, 40)}`,
    start,
    wallDuration,
    exactDuration,
    title,
    cancelled,
    declined,
    transparent,
    exdates,
    rdates
  }
  if (location) event.location = location
  if (description) event.description = description
  if (rule) event.rule = rule
  if (ruleUnsupported) event.ruleUnsupported = true
  if (recurrenceId) event.recurrenceId = recurrenceId
  return event
}

export interface ParseOptions {
  /** Addresses of the calendar's owner: an event one of them declined is hidden. */
  selfEmails?: readonly string[]
}

/**
 * Reads a calendar file. Never throws: what cannot be understood is left out, and a text that
 * is not a calendar at all gives no events (check `looksLikeCalendar` first to tell the two apart).
 */
export function parseCalendar(text: string, options: ParseOptions = {}): ParsedCalendar {
  const context: ZoneContext = { notes: new Set(), cache: new Map() }
  const events: IcalEvent[] = []
  const self = new Set<string>()
  for (const email of options.selfEmails ?? []) {
    const clean = emailOf(String(email))
    if (clean) self.add(clean)
  }
  let name: string | undefined
  if (typeof text !== 'string') return { events, notes: [] }

  const lines = unfold(text)
  // The calendar's name comes before its events; Google names a personal calendar after its owner's address.
  for (let i = 0; i < lines.length && i < 200; i++) {
    const head = lines[i]
    if (/^BEGIN:VEVENT/i.test(head)) break
    if (/^X-WR-CALNAME[;:]/i.test(head)) {
      const parsed = parseLine(head)
      if (parsed) {
        name = plainLine(parsed.value, 120) || undefined
        const email = name ? emailOf(name) : null
        if (email) self.add(email)
      }
    }
  }

  let draft: Draft | null = null
  /** Depth of components nested inside the open VEVENT (alarms): their lines are not the event's. */
  let nested = 0
  for (const raw of lines) {
    if (draft === null) {
      if (/^BEGIN:VEVENT\s*$/i.test(raw)) {
        draft = { lines: [] }
        nested = 0
      }
      continue
    }
    if (/^BEGIN:/i.test(raw)) {
      // A VEVENT inside a VEVENT is a file that lost an END: start over from here.
      if (/^BEGIN:VEVENT\s*$/i.test(raw)) {
        draft = { lines: [] }
        nested = 0
      } else nested++
      continue
    }
    if (/^END:/i.test(raw)) {
      if (nested > 0) {
        nested--
        continue
      }
      if (/^END:VEVENT\s*$/i.test(raw)) {
        try {
          const event = buildEvent(draft, context, self)
          if (event) {
            if (events.length < ICAL_LIMITS.events) events.push(event)
            else context.notes.add('truncated')
          }
        } catch {
          /* a malformed event is skipped */
        }
      }
      draft = null
      continue
    }
    if (nested > 0 || draft.lines.length >= 4000) continue
    const line = parseLine(raw)
    if (line) draft.lines.push(line)
  }
  const parsed: ParsedCalendar = { events, notes: [...context.notes] }
  if (name) parsed.name = name
  return parsed
}

// ---- recurrence ---------------------------------------------------------------

interface Budget {
  conversions: number
}

// ---- expansion ----------------------------------------------------------------

function timeInstant(time: IcalTime): number {
  if (time.date || time.zone === null) return localInstant(time.wall)
  return zoneInstant(time.wall, time.zone)
}

/** The wall clock of an event's zone at an instant. */
function wallIn(instant: number, zone: string | null): number {
  return zone === null ? localWall(instant) : zoneWall(instant, zone)
}

export interface CalendarOccurrence {
  id: string
  calendarId: string
  title: string
  /** Epoch ms. All-day: local midnight of the first day, and of the day after the last. */
  start: number
  end: number
  allDay: boolean
  /** All-day only: the same span as civil days (`endDay` exclusive), which survive a change of time zone. */
  startDay?: string
  endDay?: string
  location?: string
  description?: string
  recurring: boolean
}

export interface ExpandOptions {
  calendarId?: string
  /** Events that do not block time (TRANSP:TRANSPARENT) are kept unless this is false. */
  includeTransparent?: boolean
}

function isoDay(wall: number): string {
  const c = civil(dayOf(wall))
  return `${String(c.year).padStart(4, '0')}-${String(c.month).padStart(2, '0')}-${String(c.date).padStart(2, '0')}`
}

/**
 * The events of a parsed calendar that overlap [from, to) (epoch ms), in the local zone:
 * all-day events first, then by start. Cancelled and declined events are left out, recurring
 * ones are expanded inside the window only, and an occurrence that has an override shows the
 * override instead.
 */
export function expandCalendar(calendar: ParsedCalendar, window: { from: number; to: number }, options: ExpandOptions = {}): CalendarOccurrence[] {
  const out: CalendarOccurrence[] = []
  const { from, to } = window
  if (!calendar || !Array.isArray(calendar.events) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return out
  const calendarId = options.calendarId ?? ''
  const budget: Budget = { conversions: ICAL_LIMITS.conversions }

  // Overrides replace the occurrence of their series that would have started at RECURRENCE-ID.
  const overridden = new Map<string, Set<number>>()
  for (const event of calendar.events) {
    if (!event.recurrenceId) continue
    let set = overridden.get(event.uid)
    if (!set) overridden.set(event.uid, (set = new Set()))
    if (set.size < ICAL_LIMITS.dates) set.add(timeInstant(event.recurrenceId))
  }

  const push = (event: IcalEvent, startWall: number, recurring: boolean): void => {
    if (out.length >= ICAL_LIMITS.occurrences) return
    const { start: time } = event
    let start: number
    let end: number
    if (time.date) {
      start = localInstant(startWall)
      end = localInstant(startWall + event.wallDuration)
    } else {
      start = time.zone === null ? localInstant(startWall) : zoneInstant(startWall, time.zone)
      end =
        event.exactDuration !== null
          ? start + event.exactDuration
          : event.wallDuration === 0
            ? start
            : time.zone === null
              ? localInstant(startWall + event.wallDuration)
              : zoneInstant(startWall + event.wallDuration, time.zone)
      if (end < start) end = start
    }
    // A moment (no length) belongs to the window it starts in; anything longer, to those it overlaps.
    const inside = end > start ? start < to && end > from : start >= from && start < to
    if (!inside) return
    const occurrence: CalendarOccurrence = {
      id: `${calendarId}:${event.uid}:${start}`.slice(0, 500),
      calendarId,
      title: event.title,
      start,
      end,
      allDay: time.date,
      recurring
    }
    if (time.date) {
      occurrence.startDay = isoDay(startWall)
      occurrence.endDay = isoDay(startWall + event.wallDuration)
    }
    if (event.location) occurrence.location = event.location
    if (event.description) occurrence.description = event.description
    out.push(occurrence)
  }

  for (const event of calendar.events) {
    if (out.length >= ICAL_LIMITS.occurrences || budget.conversions <= 0) break
    try {
      if (event.cancelled || event.declined) continue
      if (event.transparent && options.includeTransparent === false) continue
      const { start: time } = event
      const zone = time.date ? null : time.zone
      const recurring = !!event.rule || event.rdates.length > 0

      if (event.recurrenceId || !recurring) {
        push(event, time.wall, !!event.recurrenceId)
        continue
      }

      // The window on the event's own wall clock, widened by its length and by a day on each
      // side: candidates are cheap, and each one is checked against the real window afterwards.
      const length = Math.max(event.wallDuration, event.exactDuration ?? 0)
      const fromDay = dayOf(wallIn(from, zone) - length) - 1
      const toDay = dayOf(wallIn(to, zone)) + 1
      const timeOfDay = mod(time.wall, DAY_MS)
      const startDay = dayOf(time.wall)
      const instantOf = (wall: number): number => {
        budget.conversions--
        return time.date || zone === null ? localInstant(wall) : zoneInstant(wall, zone)
      }

      const starts = new Set<number>()
      if (event.rule) {
        const { until } = event.rule
        const days = ruleDays(event.rule, startDay, fromDay, toDay, (day) => {
          if (budget.conversions <= 0) return 'after'
          const wall = day * DAY_MS + timeOfDay
          if (wall < time.wall) return 'before'
          if (until) {
            if (until.wall !== undefined && wall > until.wall) return 'after'
            if (until.instant !== undefined && (time.date ? wall > until.instant : instantOf(wall) > until.instant)) return 'after'
          }
          return 'ok'
        })
        for (const day of days) starts.add(day * DAY_MS + timeOfDay)
      }
      // The start itself is always an occurrence, whether or not the rule would produce it.
      if (!event.rule || event.rule.count === undefined || event.rule.count > 0) starts.add(time.wall)
      for (const extra of event.rdates) {
        // An RDATE in another zone is brought onto this event's wall clock.
        if (extra.date || time.date) starts.add(dayOf(extra.wall) * DAY_MS + (time.date ? 0 : mod(extra.wall, DAY_MS)))
        else starts.add(extra.zone === zone ? extra.wall : wallIn(timeInstant(extra), zone))
      }

      const skipped = new Set<number>()
      const skippedDays = new Set<number>()
      for (const exdate of event.exdates) {
        if (exdate.date) skippedDays.add(dayOf(exdate.wall))
        else skipped.add(timeInstant(exdate))
      }
      const replaced = overridden.get(event.uid)

      for (const wall of [...starts].sort((a, b) => a - b)) {
        if (budget.conversions <= 0 || out.length >= ICAL_LIMITS.occurrences) break
        const day = dayOf(wall)
        if (day < fromDay || day > toDay) continue
        if (skippedDays.has(day)) continue
        if (skipped.size || replaced) {
          const instant = instantOf(wall)
          if (skipped.has(instant) || replaced?.has(instant)) continue
        }
        push(event, wall, true)
      }
    } catch {
      /* one bad event does not cost the others */
    }
  }

  out.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.start - b.start || a.end - b.end || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)))
  return out
}
