/**
 * Dates said in words, Portuguese (pt-BR) and English at the same time: "amanhã 9h", "sex 15h",
 * "daqui 3 dias", "dia 5", "next monday", "20/10". The date half of the quick-add parser
 * (./parse.ts), on its own so that a date field can read what is typed into it too.
 *
 * Pure: the text and the moment it is typed go in, a stored date comes out (`YYYY-MM-DD` or
 * `YYYY-MM-DDTHH:mm`, a wall-clock time). Days are counted on the civil calendar of the local
 * zone of `now`: "em 3 dias" is three days later whatever daylight saving does in between.
 *
 * Rules worth knowing:
 *  - a weekday alone ("sexta", "friday") is the next one, today included;
 *  - "next friday", "próxima sexta", "sexta que vem" are the Friday of next week (Todoist's reading);
 *  - a time without a day is today.
 */

// ---- the civil calendar -----------------------------------------------------------------

const DAY_MS = 86_400_000

/** A civil day as the UTC midnight of that date: arithmetic without zones. */
export type Day = number

export function dayOfDate(date: Date): Day {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

export function makeDay(year: number, month: number, day: number): Day | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1 || year > 9999) return null
  const ms = Date.UTC(year, month - 1, day)
  const d = new Date(ms)
  // `Date.UTC` treats years below 100 as 19xx.
  if (year < 100) d.setUTCFullYear(year)
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.getTime() : null
}

export const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

export function isoOf(day: Day): string {
  const d = new Date(day)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const weekdayOf = (day: Day): number => new Date(day).getUTCDay()
export const addDays = (day: Day, n: number): Day => day + n * DAY_MS

export function addMonths(day: Day, n: number): Day {
  const d = new Date(day)
  const month = d.getUTCMonth() + n
  const year = d.getUTCFullYear() + Math.floor(month / 12)
  const m = ((month % 12) + 12) % 12
  const last = new Date(Date.UTC(year, m + 1, 0)).getUTCDate()
  return Date.UTC(year, m, Math.min(d.getUTCDate(), last))
}

/** The next `weekday` (0 = Sunday), today included. */
export function nextWeekday(today: Day, weekday: number): Day {
  return addDays(today, (weekday - weekdayOf(today) + 7) % 7)
}

/** The Monday after today (never today). */
export function nextMonday(today: Day): Day {
  return addDays(today, (8 - weekdayOf(today)) % 7 || 7)
}

/** The weekend: today on a Sunday, else the next Saturday (today included). */
export function nextWeekend(today: Day): Day {
  return weekdayOf(today) === 0 ? today : nextWeekday(today, 6)
}

/** The next day numbered `date` of a month, today included (months without it are skipped). */
export function nextMonthDay(today: Day, date: number): Day | null {
  if (date < 1 || date > 31) return null
  const d = new Date(today)
  let year = d.getUTCFullYear()
  let month = d.getUTCMonth() + 1
  for (let i = 0; i < 14; i++) {
    const candidate = makeDay(year, month, date)
    if (candidate !== null && candidate >= today) return candidate
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }
  return null
}

/** A date with no year is the next one: this year, or the next when it has passed. */
export function nextDate(today: Day, month: number, date: number, year?: number): Day | null {
  if (year !== undefined) return makeDay(year < 100 ? 2000 + year : year, month, date)
  const thisYear = new Date(today).getUTCFullYear()
  const candidate = makeDay(thisYear, month, date)
  if (candidate !== null && candidate >= today) return candidate
  return makeDay(thisYear + 1, month, date) ?? makeDay(thisYear + 4, month, date)
}

// ---- words ------------------------------------------------------------------------------

/** Lower case without accents, one character for one: offsets in the folded text are offsets in the text. */
export function fold(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const code = ch.charCodeAt(0)
    if (code < 0x80) {
      out += ch.toLowerCase()
      continue
    }
    // Surrogate halves pass through untouched.
    if (code >= 0xd800 && code <= 0xdfff) {
      out += ch
      continue
    }
    const plain = ch.normalize('NFD')[0]?.toLowerCase()[0]
    out += plain && plain.length === 1 ? plain : ch
  }
  return out
}

const B = '(?<![\\p{L}\\p{N}_])'
const E = '(?![\\p{L}\\p{N}_])'

const WEEKDAY_WORDS: [string, number][] = [
  ['domingos?', 0],
  ['dom', 0],
  ['sunday', 0],
  ['sun', 0],
  ['segundas?(?:[- ]feiras?)?', 1],
  ['seg', 1],
  ['monday', 1],
  ['mon', 1],
  ['tercas?(?:[- ]feiras?)?', 2],
  ['ter', 2],
  ['tuesday', 2],
  ['tues', 2],
  ['tue', 2],
  ['quartas?(?:[- ]feiras?)?', 3],
  ['qua', 3],
  ['wednesday', 3],
  ['wed', 3],
  ['quintas?(?:[- ]feiras?)?', 4],
  ['qui', 4],
  ['thursday', 4],
  ['thurs', 4],
  ['thu', 4],
  ['sextas?(?:[- ]feiras?)?', 5],
  ['sex', 5],
  ['friday', 5],
  ['fri', 5],
  ['sabados?', 6],
  ['sab', 6],
  ['saturday', 6],
  ['sat', 6]
]
/** Abbreviations that are also everyday words: only a weekday after a word like "on", "na", "next". */
const AMBIGUOUS_WEEKDAYS = ['ter', 'sex', 'dom', 'sun', 'sat', 'qua', 'qui']
export const WEEKDAY = `(?:${WEEKDAY_WORDS.map(([word]) => word).join('|')})`
const SAFE_WEEKDAY = `(?:${WEEKDAY_WORDS.filter(([word]) => !AMBIGUOUS_WEEKDAYS.includes(word))
  .map(([word]) => word)
  .join('|')})`

export function weekdayNumber(word: string): number | null {
  for (const [pattern, weekday] of WEEKDAY_WORDS) if (new RegExp(`^${pattern}$`).test(word)) return weekday
  return null
}

const MONTH_WORDS: [string, number][] = [
  ['janeiro', 1],
  ['january', 1],
  ['jan', 1],
  ['fevereiro', 2],
  ['february', 2],
  ['fev', 2],
  ['feb', 2],
  ['marco', 3],
  ['march', 3],
  ['mar', 3],
  ['abril', 4],
  ['april', 4],
  ['abr', 4],
  ['apr', 4],
  ['maio', 5],
  ['may', 5],
  ['mai', 5],
  ['junho', 6],
  ['june', 6],
  ['jun', 6],
  ['julho', 7],
  ['july', 7],
  ['jul', 7],
  ['agosto', 8],
  ['august', 8],
  ['ago', 8],
  ['aug', 8],
  ['setembro', 9],
  ['september', 9],
  ['sept', 9],
  ['set', 9],
  ['sep', 9],
  ['outubro', 10],
  ['october', 10],
  ['out', 10],
  ['oct', 10],
  ['novembro', 11],
  ['november', 11],
  ['nov', 11],
  ['dezembro', 12],
  ['december', 12],
  ['dez', 12],
  ['dec', 12]
]
export const MONTH = `(?:${MONTH_WORDS.map(([word]) => word).join('|')})\\.?`
/** Before a number, "set" and "out" are more often verbs than months. */
const LEADING_MONTH = `(?:${MONTH_WORDS.filter(([word]) => word !== 'set' && word !== 'out')
  .map(([word]) => word)
  .join('|')})\\.?`

export function monthNumber(word: string): number | null {
  const clean = word.replace(/\.$/, '')
  return MONTH_WORDS.find(([name]) => name === clean)?.[1] ?? null
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  one: 1,
  a: 1,
  an: 1,
  dois: 2,
  duas: 2,
  two: 2,
  tres: 3,
  three: 3,
  quatro: 4,
  four: 4,
  cinco: 5,
  five: 5,
  seis: 6,
  six: 6,
  sete: 7,
  seven: 7,
  oito: 8,
  eight: 8,
  nove: 9,
  nine: 9,
  dez: 10,
  ten: 10
}
export const COUNT = `(\\d{1,3}|${Object.keys(NUMBER_WORDS)
  .filter((word) => word !== 'a' && word !== 'an')
  .join('|')})`

export function countOf(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : (NUMBER_WORDS[word] ?? 0)
}

export type Unit = 'day' | 'week' | 'month' | 'year'
export const UNIT = '(dias?|semanas?|mes|meses|anos?|days?|weeks?|months?|years?)'

export function unitOf(word: string): Unit {
  if (/^(dias?|days?)$/.test(word)) return 'day'
  if (/^(semanas?|weeks?)$/.test(word)) return 'week'
  if (/^(mes|meses|months?)$/.test(word)) return 'month'
  return 'year'
}

/** `HH:mm` of a clock time as typed: 9h, 9h30, 9am, 2:30pm, 14:00, 14. Null when it is not one. */
export function clockOf(text: string): string | null {
  const m = /^(\d{1,2})(?:(?::|h)(\d{2})?)?(?:min)?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(text.trim().toLowerCase())
  if (!m) return null
  let hours = Number(m[1])
  const minutes = m[2] ? Number(m[2]) : 0
  const half = m[3]?.[0]
  if (half) {
    if (hours < 1 || hours > 12) return null
    if (half === 'p' && hours !== 12) hours += 12
    if (half === 'a' && hours === 12) hours = 0
  }
  return hours <= 23 && minutes <= 59 ? `${pad(hours)}:${pad(minutes)}` : null
}

// ---- matchers ---------------------------------------------------------------------------

export type DateReading = { kind: 'date'; day: Day; time?: string } | { kind: 'time'; time: string }

export type Matcher<R> = (m: RegExpExecArray, today: Day) => R | null

export interface Rule<R> {
  re: RegExp
  read: Matcher<R>
}

/** A pattern matched on whole words of the folded text, and how to read a match. */
export function rule<R>(source: string, read: Matcher<R>): Rule<R> {
  return { re: new RegExp(`${B}(?:${source})${E}`, 'gu'), read }
}

export interface Span {
  start: number
  end: number
}

/**
 * The earliest (then longest) match of any of `rules` in `folded` whose span is free and that
 * reads as something. Null when none does. Nothing is claimed: the caller decides.
 */
export function firstMatch<R>(
  folded: string,
  rules: readonly Rule<R>[],
  today: Day,
  free: (span: Span) => boolean
): (Span & { reading: R }) | null {
  const hits: (Span & { read: () => R | null })[] = []
  for (const { re, read } of rules) {
    re.lastIndex = 0
    for (let m = re.exec(folded); m; m = re.exec(folded)) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      const match = m
      const span = { start: match.index, end: match.index + match[0].length }
      if (free(span)) hits.push({ ...span, read: () => read(match, today) })
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  for (const hit of hits) {
    if (!free(hit)) continue
    const reading = hit.read()
    if (reading) return { start: hit.start, end: hit.end, reading }
  }
  return null
}

const DATE_PREFIX = '(?:(?:ate|by|on|na|no|nesta|neste|nessa|nesse|this|para|pra|due|for)\\s+)?'
const NEXT_PREFIX = '(?:(?:na|no)\\s+)?(?:next|proxima|proximo)'

export const DATES: Rule<DateReading>[] = [
  rule('tonight|hoje (?:a|de) noite|esta noite|essa noite', (_m, today) => ({ kind: 'date', day: today, time: '19:00' })),
  rule('depois de amanha|day after tomorrow', (_m, today) => ({ kind: 'date', day: addDays(today, 2) })),
  rule('hoje|today', (_m, today) => ({ kind: 'date', day: today })),
  rule('amanha|tomorrow', (_m, today) => ({ kind: 'date', day: addDays(today, 1) })),
  rule(`(?:em|daqui a|in)\\s+${COUNT}\\s+${UNIT}`, (m, today) => {
    const count = countOf(m[1])
    if (count < 1 || count > 999) return null
    const unit = unitOf(m[2])
    const day =
      unit === 'day'
        ? addDays(today, count)
        : unit === 'week'
          ? addDays(today, 7 * count)
          : addMonths(today, unit === 'month' ? count : 12 * count)
    return { kind: 'date', day }
  }),
  rule(`(?:(?:no|neste|nesse|this|next)\\s+)?(?:fim de semana|final de semana|fds|weekend)`, (_m, today) => ({
    kind: 'date',
    day: nextWeekend(today)
  })),
  rule('semana que vem|(?:na )?proxima semana|next week', (_m, today) => ({ kind: 'date', day: nextMonday(today) })),
  rule('mes que vem|(?:no )?proximo mes|next month', (_m, today) => {
    const d = new Date(today)
    return { kind: 'date', day: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) }
  }),
  rule(`${NEXT_PREFIX}\\s+(${WEEKDAY})|(${WEEKDAY})\\s+(?:que vem|da semana que vem|da proxima semana)`, (m, today) => {
    const weekday = weekdayNumber(m[1] ?? m[2])
    if (weekday === null) return null
    return { kind: 'date', day: addDays(nextMonday(today), (weekday + 6) % 7) }
  }),
  rule(`(?:ate|by|on|na|no|nesta|neste|nessa|nesse|this|para|pra|due|for)\\s+(${WEEKDAY})|(${SAFE_WEEKDAY})`, (m, today) => {
    const weekday = weekdayNumber(m[1] ?? m[2])
    return weekday === null ? null : { kind: 'date', day: nextWeekday(today, weekday) }
  }),
  rule(`${DATE_PREFIX}(?:(?:no )?dia\\s+(\\d{1,2})(?![:h\\d/])|(?:the |on the )?(\\d{1,2})(?:st|nd|rd|th))`, (m, today) => {
    const day = nextMonthDay(today, Number(m[1] ?? m[2]))
    return day === null ? null : { kind: 'date', day }
  }),
  rule(`${DATE_PREFIX}(\\d{4})-(\\d{2})-(\\d{2})`, (m) => {
    const day = makeDay(Number(m[1]), Number(m[2]), Number(m[3]))
    return day === null ? null : { kind: 'date', day }
  })
]

/** In a date field every word is about the date: "sex", "ter", "sun" are weekdays there. */
const FIELD_WEEKDAY: Rule<DateReading> = rule(`(${WEEKDAY})`, (m, today) => {
  const weekday = weekdayNumber(m[1])
  return weekday === null ? null : { kind: 'date', day: nextWeekday(today, weekday) }
})

/** Dates that need the reading order of numbers: built per call. */
export function numericDate(dayFirst: boolean): Rule<DateReading> {
  return rule(`${DATE_PREFIX}(?:(?:no )?dia\\s+)?(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{4}|\\d{2}))?`, (m, today) => {
    const a = Number(m[1])
    const b = Number(m[2])
    // A first number above 12 can only be a day.
    const [date, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : dayFirst ? [a, b] : [b, a]
    const day = nextDate(today, month, date, m[3] !== undefined ? Number(m[3]) : undefined)
    return day === null ? null : { kind: 'date', day }
  })
}

export const NAMED_DATES: Rule<DateReading>[] = [
  rule(
    `${DATE_PREFIX}(?:(?:no )?dia\\s+)?(\\d{1,2})(?:st|nd|rd|th|º)?(?:\\s+de)?\\s+(${MONTH})(?:(?:\\s+de|,)?\\s+(\\d{4}))?`,
    (m, today) => {
      const month = monthNumber(m[2])
      const day = month === null ? null : nextDate(today, month, Number(m[1]), m[3] !== undefined ? Number(m[3]) : undefined)
      return day === null ? null : { kind: 'date', day }
    }
  ),
  rule(`${DATE_PREFIX}(${LEADING_MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, (m, today) => {
    const month = monthNumber(m[1])
    const day = month === null ? null : nextDate(today, month, Number(m[2]), m[3] !== undefined ? Number(m[3]) : undefined)
    return day === null ? null : { kind: 'date', day }
  })
]

const AT = '(?:(?:as|a|at|ate|by)\\s+)'

export const TIMES: Rule<DateReading>[] = [
  rule(`${AT}?(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.))`, (m) => {
    const time = clockOf(m[1])
    return time ? { kind: 'time', time } : null
  }),
  rule(`${AT}?(\\d{1,2}h(?:\\d{2})?)(?:min)?`, (m) => {
    const time = clockOf(m[1])
    return time ? { kind: 'time', time } : null
  }),
  rule(`${AT}?(\\d{1,2}:\\d{2})`, (m) => {
    const time = clockOf(m[1])
    return time ? { kind: 'time', time } : null
  }),
  rule('(?:as|at)\\s+(\\d{1,2})(?![/.:\\d])', (m) => {
    const time = clockOf(m[1])
    return time ? { kind: 'time', time } : null
  }),
  rule('(?:(?:ao|a|at)\\s+)?(?:meio[- ]dia|noon|midday)', () => ({ kind: 'time', time: '12:00' })),
  rule('(?:(?:a|at)\\s+)?(?:meia[- ]noite|midnight)', () => ({ kind: 'time', time: '00:00' })),
  rule('(?:de|pela|in the|this)\\s+(?:manha|morning)', () => ({ kind: 'time', time: '09:00' })),
  rule('(?:a|de|pela|in the|this)\\s+(?:tarde|afternoon)', () => ({ kind: 'time', time: '15:00' })),
  rule('(?:a|de|pela|in the|this)\\s+(?:noite|evening)', () => ({ kind: 'time', time: '19:00' }))
]

/** Every date pattern, in the order the quick add tries them. */
export function dateRules(dayFirst: boolean): Rule<DateReading>[] {
  return [...DATES, numericDate(dayFirst), ...NAMED_DATES]
}

/** A day and a time read apart: the stored date they make (a time alone is today; a day's own time gives way to one typed). */
export function combine(today: Day, date: DateReading | null, time: DateReading | null, fallbackDay: Day | null = null): string | null {
  const dateReading = date?.kind === 'date' ? date : null
  const clock = time?.kind === 'time' ? time.time : (dateReading?.time ?? null)
  let day: Day | null = dateReading?.day ?? fallbackDay
  if (day === null && clock) day = today
  return day === null ? null : clock ? `${isoOf(day)}T${clock}` : isoOf(day)
}

// ---- a date field -----------------------------------------------------------------------

export interface DateFieldOptions {
  /** The moment the text is typed; its local day is "today". */
  now?: Date
  /** `10/11` is the 10th of November (true, the default) or October 11th (false, as in en-US). */
  dayFirst?: boolean
}

export interface ParsedDate {
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`; null when no date was understood. */
  date: string | null
  /** What was typed that is not part of the date, trimmed. */
  rest: string
}

/**
 * What a date field holds: "sex 15h", "amanhã", "daqui 3 dias", "dia 5", "next monday", "20/10".
 * Everything typed there is about the date, so short weekdays ("sex", "ter", "sun") count.
 */
export function parseDate(text: string, options: DateFieldOptions = {}): ParsedDate {
  const input = text.slice(0, 200)
  const folded = fold(input)
  const today = dayOfDate(options.now ?? new Date())
  const claimed: Span[] = []
  const free = (span: Span): boolean => !claimed.some((other) => other.start < span.end && span.start < other.end)
  const take = (rules: readonly Rule<DateReading>[]): DateReading | null => {
    const hit = firstMatch(folded, rules, today, free)
    if (!hit) return null
    claimed.push(hit)
    return hit.reading
  }
  // "daqui 3 dias" is how it is said aloud; the quick add knows "daqui a 3 dias".
  const date = take([...dateRules(options.dayFirst ?? true), FIELD_WEEKDAY, DAQUI])
  // A number alone is not a time ("15" may be the 15th); after a day it is ("sex 15").
  const time = take(TIMES) ?? (date ? take([BARE_CLOCK]) : null)
  claimed.sort((a, b) => a.start - b.start)
  let rest = ''
  let at = 0
  for (const span of claimed) {
    rest += `${input.slice(at, span.start)} `
    at = span.end
  }
  rest = (rest + input.slice(at)).replace(/\s+/gu, ' ').trim()
  return { date: combine(today, date, time), rest }
}

const DAQUI: Rule<DateReading> = rule(`daqui\\s+${COUNT}\\s+${UNIT}`, (m, today) => {
  const count = countOf(m[1])
  if (count < 1 || count > 999) return null
  const unit = unitOf(m[2])
  const day =
    unit === 'day'
      ? addDays(today, count)
      : unit === 'week'
        ? addDays(today, 7 * count)
        : addMonths(today, unit === 'month' ? count : 12 * count)
  return { kind: 'date', day }
})

/** In a date field, a number after the day is its hour: "sex 15", "amanhã 9". */
const BARE_CLOCK: Rule<DateReading> = rule('(\\d{1,2})(?![/.:\\d])', (m) => {
  const time = clockOf(m[1])
  return time ? { kind: 'time', time } : null
})

export type QuickDate = 'today' | 'tomorrow' | 'weekend' | 'nextWeek'

/** The day a quick choice of a date picker means, `YYYY-MM-DD`. */
export function quickDate(choice: QuickDate, now: Date = new Date()): string {
  const today = dayOfDate(now)
  switch (choice) {
    case 'today':
      return isoOf(today)
    case 'tomorrow':
      return isoOf(addDays(today, 1))
    case 'weekend':
      return isoOf(nextWeekend(today))
    case 'nextWeek':
      return isoOf(nextMonday(today))
  }
}

/** A time (`HH:mm`) `delta` quarters of an hour away, on the quarter: 9:10 goes up to 9:15 and down to 9:00. */
export function stepTime(time: string, delta: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  const total = m ? Number(m[1]) * 60 + Number(m[2]) : 0
  const snapped = delta > 0 ? Math.floor(total / 15) * 15 + 15 * delta : delta < 0 ? Math.ceil(total / 15) * 15 + 15 * delta : total
  const wrapped = ((snapped % 1440) + 1440) % 1440
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`
}
