/**
 * The quick-add parser: "Pagar aluguel amanhã 9h p1 #Casa @contas" becomes a title and the
 * task's fields. Portuguese (pt-BR) and English are understood at the same time, always.
 *
 * Pure: the text, the moment it is typed and the known projects / labels go in; the fields and
 * the spans that were recognised come out. The spans are what the input highlights while typing;
 * a span the user un-recognises (a click on the highlight, Backspace right after it) comes back
 * in `ignored` and is then left in the title as typed. That is what makes it safe to recognise
 * everyday words such as "segunda" ("comprar tinta de segunda mão").
 *
 * Days are counted on the civil calendar of the local zone of `now`: "em 3 dias" is three days
 * later whatever daylight saving does in between. Dates come out as stored, `YYYY-MM-DD` or
 * `YYYY-MM-DDTHH:mm` (a wall-clock time).
 *
 * Rules worth knowing:
 *  - a weekday alone ("sexta", "friday") is the next one, today included;
 *  - "next friday", "próxima sexta", "sexta que vem" are the Friday of next week (Todoist's reading);
 *  - a time without a day is today; a recurrence without a day starts at its first occurrence;
 *  - "todo!" / "every!" (with the exclamation mark) repeats from the completion, not the due date;
 *  - a repeat said in one word ("weekly", "quinzenal") counts only when the line says no other.
 */

export type TokenKind = 'date' | 'time' | 'recurrence' | 'priority' | 'project' | 'label' | 'remind'

export interface ParsedToken {
  start: number
  end: number
  kind: TokenKind
  /** The text as typed. */
  text: string
}

/** What `tasks.recurrence` stores (as JSON): an RRULE subset, what it counts from, and the words typed. */
export interface TaskRecurrence {
  rule: string
  from: 'due' | 'completion'
  text: string
}

export interface ParsedTask {
  title: string
  due: string | null
  recurrence: TaskRecurrence | null
  priority: 1 | 2 | 3 | 4 | null
  /** The project as typed, or as the known project it names (its own spelling). */
  project: string | null
  labels: string[]
  /** When to remind, a wall-clock moment. */
  remind: string | null
  tokens: ParsedToken[]
}

export interface ParseOptions {
  /** The moment the task is typed; its local day is "today". */
  now?: Date
  /** `10/11` is the 10th of November (true, the default) or October 11th (false, as in en-US). */
  dayFirst?: boolean
  /** Known names, so `#Two words` can match a project with a space in its name. */
  projects?: readonly string[]
  labels?: readonly string[]
  /** Spans the user un-recognised: left as text. Matched by start and text. */
  ignored?: readonly { start: number; text: string }[]
}

// ---- the civil calendar -----------------------------------------------------------------

const DAY_MS = 86_400_000

/** A civil day as the UTC midnight of that date: arithmetic without zones. */
type Day = number

function dayOfDate(date: Date): Day {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

function makeDay(year: number, month: number, day: number): Day | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1 || year > 9999) return null
  const ms = Date.UTC(year, month - 1, day)
  const d = new Date(ms)
  // `Date.UTC` treats years below 100 as 19xx.
  if (year < 100) d.setUTCFullYear(year)
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.getTime() : null
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function isoOf(day: Day): string {
  const d = new Date(day)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

const weekdayOf = (day: Day): number => new Date(day).getUTCDay()
const addDays = (day: Day, n: number): Day => day + n * DAY_MS

function addMonths(day: Day, n: number): Day {
  const d = new Date(day)
  const month = d.getUTCMonth() + n
  const year = d.getUTCFullYear() + Math.floor(month / 12)
  const m = ((month % 12) + 12) % 12
  const last = new Date(Date.UTC(year, m + 1, 0)).getUTCDate()
  return Date.UTC(year, m, Math.min(d.getUTCDate(), last))
}

/** The next `weekday` (0 = Sunday), today included. */
function nextWeekday(today: Day, weekday: number): Day {
  return addDays(today, (weekday - weekdayOf(today) + 7) % 7)
}

/** The Monday after today (never today). */
function nextMonday(today: Day): Day {
  return addDays(today, ((8 - weekdayOf(today)) % 7) || 7)
}

/** The next day numbered `date` of a month, today included (months without it are skipped). */
function nextMonthDay(today: Day, date: number): Day | null {
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
function nextDate(today: Day, month: number, date: number, year?: number): Day | null {
  if (year !== undefined) return makeDay(year < 100 ? 2000 + year : year, month, date)
  const thisYear = new Date(today).getUTCFullYear()
  const candidate = makeDay(thisYear, month, date)
  if (candidate !== null && candidate >= today) return candidate
  return makeDay(thisYear + 1, month, date) ?? makeDay(thisYear + 4, month, date)
}

// ---- words ------------------------------------------------------------------------------

/** Lower case without accents, one character for one: offsets in the folded text are offsets in the text. */
function fold(text: string): string {
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
  ['domingos?', 0], ['dom', 0], ['sunday', 0], ['sun', 0],
  ['segundas?(?:[- ]feiras?)?', 1], ['seg', 1], ['monday', 1], ['mon', 1],
  ['tercas?(?:[- ]feiras?)?', 2], ['ter', 2], ['tuesday', 2], ['tues', 2], ['tue', 2],
  ['quartas?(?:[- ]feiras?)?', 3], ['qua', 3], ['wednesday', 3], ['wed', 3],
  ['quintas?(?:[- ]feiras?)?', 4], ['qui', 4], ['thursday', 4], ['thurs', 4], ['thu', 4],
  ['sextas?(?:[- ]feiras?)?', 5], ['sex', 5], ['friday', 5], ['fri', 5],
  ['sabados?', 6], ['sab', 6], ['saturday', 6], ['sat', 6]
]
/** Abbreviations that are also everyday words: only a weekday after a word like "on", "na", "next". */
const AMBIGUOUS_WEEKDAYS = ['ter', 'sex', 'dom', 'sun', 'sat', 'qua', 'qui']
const WEEKDAY = `(?:${WEEKDAY_WORDS.map(([word]) => word).join('|')})`
const SAFE_WEEKDAY = `(?:${WEEKDAY_WORDS.filter(([word]) => !AMBIGUOUS_WEEKDAYS.includes(word)).map(([word]) => word).join('|')})`

function weekdayNumber(word: string): number | null {
  for (const [pattern, weekday] of WEEKDAY_WORDS) if (new RegExp(`^${pattern}$`).test(word)) return weekday
  return null
}

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

const MONTH_WORDS: [string, number][] = [
  ['janeiro', 1], ['january', 1], ['jan', 1],
  ['fevereiro', 2], ['february', 2], ['fev', 2], ['feb', 2],
  ['marco', 3], ['march', 3], ['mar', 3],
  ['abril', 4], ['april', 4], ['abr', 4], ['apr', 4],
  ['maio', 5], ['may', 5], ['mai', 5],
  ['junho', 6], ['june', 6], ['jun', 6],
  ['julho', 7], ['july', 7], ['jul', 7],
  ['agosto', 8], ['august', 8], ['ago', 8], ['aug', 8],
  ['setembro', 9], ['september', 9], ['sept', 9], ['set', 9], ['sep', 9],
  ['outubro', 10], ['october', 10], ['out', 10], ['oct', 10],
  ['novembro', 11], ['november', 11], ['nov', 11],
  ['dezembro', 12], ['december', 12], ['dez', 12], ['dec', 12]
]
const MONTH = `(?:${MONTH_WORDS.map(([word]) => word).join('|')})\\.?`
/** Before a number, "set" and "out" are more often verbs than months. */
const LEADING_MONTH = `(?:${MONTH_WORDS.filter(([word]) => word !== 'set' && word !== 'out').map(([word]) => word).join('|')})\\.?`

function monthNumber(word: string): number | null {
  const clean = word.replace(/\.$/, '')
  return MONTH_WORDS.find(([name]) => name === clean)?.[1] ?? null
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, one: 1, a: 1, an: 1, dois: 2, duas: 2, two: 2, tres: 3, three: 3, quatro: 4, four: 4,
  cinco: 5, five: 5, seis: 6, six: 6, sete: 7, seven: 7, oito: 8, eight: 8, nove: 9, nine: 9, dez: 10, ten: 10
}
const COUNT = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).filter((word) => word !== 'a' && word !== 'an').join('|')})`

function countOf(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : (NUMBER_WORDS[word] ?? 0)
}

type Unit = 'day' | 'week' | 'month' | 'year'
const UNIT = '(dias?|semanas?|mes|meses|anos?|days?|weeks?|months?|years?)'

function unitOf(word: string): Unit {
  if (/^(dias?|days?)$/.test(word)) return 'day'
  if (/^(semanas?|weeks?)$/.test(word)) return 'week'
  if (/^(mes|meses|months?)$/.test(word)) return 'month'
  return 'year'
}

/** `HH:mm` of a clock time as typed: 9h, 9h30, 9am, 2:30pm, 14:00, 14. Null when it is not one. */
function clockOf(text: string): string | null {
  const m = /^(\d{1,2})(?:(?::|h)(\d{2})?)?(?:min)?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(text.trim())
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

interface Hit {
  start: number
  end: number
  /** Read once the match won its span. */
  read: () => Reading | null
}

type Reading =
  | { kind: 'date'; day: Day; time?: string }
  | { kind: 'time'; time: string }
  | { kind: 'recurrence'; rule: string; from: 'due' | 'completion'; first: (today: Day) => Day }
  | { kind: 'remind'; time?: string; before?: number }
  | { kind: 'priority'; priority: 1 | 2 | 3 | 4 }

type Matcher = (m: RegExpExecArray, today: Day) => Reading | null

function rule(source: string, read: Matcher): { re: RegExp; read: Matcher } {
  return { re: new RegExp(`${B}(?:${source})${E}`, 'gu'), read }
}

const EVERY = '(a cada|every|todos os|todas as|todos|todas|todo|toda|cada)(!?)'
const WEEKDAY_LIST = `(${WEEKDAY}(?:\\s*(?:,|e|and|&)\\s*${WEEKDAY})*)`

function recurrence(rrule: string, bang: string | undefined, first: (today: Day) => Day): Reading {
  return { kind: 'recurrence', rule: rrule, from: bang === '!' ? 'completion' : 'due', first }
}

const RECURRENCES = [
  rule(`(?:${EVERY}\\s+)?(?:dias? (?:util|uteis)|weekdays?|workdays?)|${EVERY}\\s+(?:dia util|weekday|workday)`, (m) =>
    recurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', m[2] ?? m[4], (today) => {
      const weekday = weekdayOf(today)
      return weekday === 0 ? addDays(today, 1) : weekday === 6 ? addDays(today, 2) : today
    })
  ),
  rule(`${EVERY}\\s+${COUNT}\\s+${UNIT}`, (m) => {
    const count = countOf(m[3])
    if (count < 1 || count > 999) return null
    const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[unitOf(m[4])]
    return recurrence(count === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${count}`, m[2], (today) => today)
  }),
  rule(`${EVERY}\\s+(?:dia\\s+(\\d{1,2})(?![:h\\d])|(\\d{1,2})(?:st|nd|rd|th|º|o)?(?: (?:do mes|of the month))?)`, (m, today) => {
    const date = Number(m[3] ?? m[4])
    if (date < 1 || date > 31) return null
    if (nextMonthDay(today, date) === null) return null
    return recurrence(`FREQ=MONTHLY;BYMONTHDAY=${date}`, m[2], (from) => nextMonthDay(from, date) ?? from)
  }),
  rule(`${EVERY}\\s+${WEEKDAY_LIST}`, (m) => {
    const days = [...new Set(m[3].split(/\s*(?:,|\be\b|\band\b|&)\s*/).map((word) => weekdayNumber(word.trim())).filter((day): day is number => day !== null))]
    if (!days.length) return null
    days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    return recurrence(`FREQ=WEEKLY;BYDAY=${days.map((day) => RRULE_DAYS[day]).join(',')}`, m[2], (today) => Math.min(...days.map((day) => nextWeekday(today, day))))
  }),
  // "every other week", "every other monday": every second one.
  rule(`(every)(!?)\\s+other\\s+${UNIT}`, (m) => {
    const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[unitOf(m[3])]
    return recurrence(`FREQ=${freq};INTERVAL=2`, m[2], (today) => today)
  }),
  rule(`(every)(!?)\\s+other\\s+(${WEEKDAY})`, (m) => {
    const day = weekdayNumber(m[3])
    return day === null ? null : recurrence(`FREQ=WEEKLY;INTERVAL=2;BYDAY=${RRULE_DAYS[day]}`, m[2], (today) => nextWeekday(today, day))
  }),
  // "dia sim, dia não", "semana sim, semana não".
  rule(`(?:(todo|toda)(!?)\\s+)?(dia|semana|mes|ano)\\s+sim,?\\s+\\3\\s+nao`, (m) => {
    const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[unitOf(m[3])]
    return recurrence(`FREQ=${freq};INTERVAL=2`, m[2], (today) => today)
  }),
  rule(`${EVERY}\\s+(?:quinzenas?|fortnights?)`, (m) => recurrence('FREQ=WEEKLY;INTERVAL=2', m[2], (today) => today)),
  rule(`${EVERY}\\s+(?:dias?|days?)`, (m) => recurrence('FREQ=DAILY', m[2], (today) => today)),
  rule(`${EVERY}\\s+(?:semanas?|weeks?)`, (m) => recurrence('FREQ=WEEKLY', m[2], (today) => today)),
  rule(`${EVERY}\\s+(?:mes|meses|months?)`, (m) => recurrence('FREQ=MONTHLY', m[2], (today) => today)),
  rule(`${EVERY}\\s+(?:anos?|years?)`, (m) => recurrence('FREQ=YEARLY', m[2], (today) => today))
]

/**
 * A repeat said in one word. Read only when the line says no other way: "Weekly review every
 * friday" repeats on Fridays, and "Weekly" stays in the title.
 */
const ADVERBS = [
  rule('diariamente|daily', () => recurrence('FREQ=DAILY', undefined, (today) => today)),
  rule('semanalmente|weekly', () => recurrence('FREQ=WEEKLY', undefined, (today) => today)),
  rule('quinzenalmente|quinzenal|biweekly|fortnightly', () => recurrence('FREQ=WEEKLY;INTERVAL=2', undefined, (today) => today)),
  rule('mensalmente|monthly', () => recurrence('FREQ=MONTHLY', undefined, (today) => today)),
  rule('anualmente|yearly|annually', () => recurrence('FREQ=YEARLY', undefined, (today) => today))
]

const REMIND = '(?:me lembrar|lembre-me|lembre me|lembrar|lembrete|remind me|remind)'
const CLOCK = '(\\d{1,2}(?:(?::|h)\\d{2}|h)?(?:\\s*(?:am|pm|a\\.m\\.|p\\.m\\.))?)'

const REMINDERS = [
  rule(`${REMIND}\\s+(\\d{1,3})\\s*(min|mins|minutos?|minutes?|h|hs|horas?|hours?|hrs?)\\s+(?:antes|before)`, (m) => {
    const amount = Number(m[1])
    const minutes = /^(min|mins|minutos?|minutes?)$/.test(m[2]) ? amount : amount * 60
    return minutes > 0 && minutes <= 60 * 24 * 7 ? { kind: 'remind', before: minutes } : null
  }),
  rule(`${REMIND}\\s+(?:(?:as|a|at)\\s+)?${CLOCK}`, (m) => {
    const time = clockOf(m[1])
    return time ? { kind: 'remind', time } : null
  })
]

const DATE_PREFIX = '(?:(?:ate|by|on|na|no|nesta|neste|nessa|nesse|this|para|pra|due|for)\\s+)?'
const NEXT_PREFIX = '(?:(?:na|no)\\s+)?(?:next|proxima|proximo)'

const DATES = [
  rule('tonight|hoje (?:a|de) noite|esta noite|essa noite', (_m, today) => ({ kind: 'date', day: today, time: '19:00' })),
  rule('depois de amanha|day after tomorrow', (_m, today) => ({ kind: 'date', day: addDays(today, 2) })),
  rule('hoje|today', (_m, today) => ({ kind: 'date', day: today })),
  rule('amanha|tomorrow', (_m, today) => ({ kind: 'date', day: addDays(today, 1) })),
  rule(`(?:em|daqui a|in)\\s+${COUNT}\\s+${UNIT}`, (m, today) => {
    const count = countOf(m[1])
    if (count < 1 || count > 999) return null
    const unit = unitOf(m[2])
    const day = unit === 'day' ? addDays(today, count) : unit === 'week' ? addDays(today, 7 * count) : addMonths(today, unit === 'month' ? count : 12 * count)
    return { kind: 'date', day }
  }),
  rule(`(?:(?:no|neste|nesse|this|next)\\s+)?(?:fim de semana|final de semana|fds|weekend)`, (_m, today) => ({
    kind: 'date',
    day: weekdayOf(today) === 0 ? today : nextWeekday(today, 6)
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

/** Dates that need the reading order of numbers: built per call. */
function numericDate(dayFirst: boolean): { re: RegExp; read: Matcher } {
  return rule(`${DATE_PREFIX}(?:(?:no )?dia\\s+)?(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{4}|\\d{2}))?`, (m, today) => {
    const a = Number(m[1])
    const b = Number(m[2])
    // A first number above 12 can only be a day.
    const [date, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : dayFirst ? [a, b] : [b, a]
    const day = nextDate(today, month, date, m[3] !== undefined ? Number(m[3]) : undefined)
    return day === null ? null : { kind: 'date', day }
  })
}

const NAMED_DATES = [
  rule(`${DATE_PREFIX}(?:(?:no )?dia\\s+)?(\\d{1,2})(?:st|nd|rd|th|º)?(?:\\s+de)?\\s+(${MONTH})(?:(?:\\s+de|,)?\\s+(\\d{4}))?`, (m, today) => {
    const month = monthNumber(m[2])
    const day = month === null ? null : nextDate(today, month, Number(m[1]), m[3] !== undefined ? Number(m[3]) : undefined)
    return day === null ? null : { kind: 'date', day }
  }),
  rule(`${DATE_PREFIX}(${LEADING_MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, (m, today) => {
    const month = monthNumber(m[1])
    const day = month === null ? null : nextDate(today, month, Number(m[2]), m[3] !== undefined ? Number(m[3]) : undefined)
    return day === null ? null : { kind: 'date', day }
  })
]

const AT = '(?:(?:as|a|at|ate|by)\\s+)'

const TIMES = [
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

const PRIORITIES = [rule('p([1-4])', (m) => ({ kind: 'priority', priority: Number(m[1]) as 1 | 2 | 3 | 4 }))]

// ---- the parse --------------------------------------------------------------------------

interface Claimed {
  start: number
  end: number
}

const overlaps = (a: Claimed, b: Claimed): boolean => a.start < b.end && b.start < a.end

/** Strips punctuation a name picked up at the end of a sentence. */
function trimName(name: string): string {
  return name.replace(/[.,;:!?)\]]+$/u, '')
}

export function parseTask(text: string, options: ParseOptions = {}): ParsedTask {
  const input = text.slice(0, 2000)
  const folded = fold(input)
  const today = dayOfDate(options.now ?? new Date())
  const claimed: Claimed[] = []
  const tokens: (ParsedToken & { reading?: Reading })[] = []

  // What the user un-recognised stays text, and nothing else may take it either.
  for (const span of options.ignored ?? []) {
    if (span.text && input.slice(span.start, span.start + span.text.length) === span.text) claimed.push({ start: span.start, end: span.start + span.text.length })
  }
  const free = (span: Claimed): boolean => !claimed.some((other) => overlaps(other, span))

  /** The earliest (then longest) free match of any of `rules` that reads as something; it claims its span. */
  const take = (kind: TokenKind, rules: { re: RegExp; read: Matcher }[]): Reading | null => {
    const hits: Hit[] = []
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
      if (!reading) continue
      claimed.push(hit)
      tokens.push({ start: hit.start, end: hit.end, kind, text: input.slice(hit.start, hit.end), reading })
      return reading
    }
    return null
  }

  const repeat = take('recurrence', RECURRENCES) ?? take('recurrence', ADVERBS)
  const remind = take('remind', REMINDERS)
  const date = take('date', [...DATES, numericDate(options.dayFirst ?? true), ...NAMED_DATES])
  const time = take('time', TIMES)
  const priority = take('priority', PRIORITIES)

  /** `#name` / `@name`: a known name (the longest that fits) or the word that follows. */
  const names = (sigil: '#' | '@', known: readonly string[], kind: 'project' | 'label', many: boolean): string[] => {
    const found: string[] = []
    const knownFolded = [...known].map((name) => ({ name, folded: fold(name) })).sort((a, b) => b.folded.length - a.folded.length)
    for (let i = folded.indexOf(sigil); i >= 0; i = folded.indexOf(sigil, i + 1)) {
      if (i > 0 && !/\s/u.test(folded[i - 1])) continue
      const rest = folded.slice(i + 1)
      const exact = knownFolded.find((entry) => entry.folded && rest.startsWith(entry.folded) && !/[\p{L}\p{N}_-]/u.test(rest[entry.folded.length] ?? ''))
      const word = /^[^\s#@]+/u.exec(input.slice(i + 1))?.[0] ?? ''
      const length = exact ? exact.folded.length : trimName(word).length
      if (!length) continue
      const span = { start: i, end: i + 1 + length }
      if (!free(span)) continue
      claimed.push(span)
      tokens.push({ ...span, kind, text: input.slice(span.start, span.end) })
      found.push(exact ? exact.name : input.slice(i + 1, i + 1 + length))
      if (!many) break
    }
    return found
  }
  const project = names('#', options.projects ?? [], 'project', false)[0] ?? null
  const labels = names('@', options.labels ?? [], 'label', true)

  // The day: the one typed, else the recurrence's first, else today when only a time was typed.
  const dateReading = date?.kind === 'date' ? date : null
  const timeReading = time?.kind === 'time' ? time.time : (dateReading?.time ?? null)
  const recurrenceReading = repeat?.kind === 'recurrence' ? repeat : null
  let day: Day | null = dateReading?.day ?? (recurrenceReading ? recurrenceReading.first(today) : null)
  if (day === null && timeReading) day = today
  const due = day === null ? null : timeReading ? `${isoOf(day)}T${timeReading}` : isoOf(day)

  // A reminder at a time is on the due day (today without one); "30 min before" needs a due time.
  let remindAt: string | null = null
  if (remind?.kind === 'remind') {
    if (remind.time) remindAt = `${isoOf(day ?? today)}T${remind.time}`
    else if (remind.before !== undefined && due && timeReading) {
      const [hours, minutes] = timeReading.split(':').map(Number)
      const at = (day as Day) + (hours * 60 + minutes - remind.before) * 60_000
      const d = new Date(at)
      remindAt = `${isoOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    }
    if (remindAt === null) {
      const index = tokens.findIndex((token) => token.kind === 'remind')
      if (index >= 0) tokens.splice(index, 1)
    }
  }

  tokens.sort((a, b) => a.start - b.start)
  const cut = tokens.map(({ start, end }) => ({ start, end }))
  let title = ''
  let at = 0
  for (const span of cut) {
    title += input.slice(at, span.start) + ' '
    at = span.end
  }
  title += input.slice(at)
  title = title
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .trim()
    .replace(/^[,;:\-–—]+\s*|\s*[,;:\-–—]+$/gu, '')
    .trim()

  return {
    title,
    due,
    recurrence: recurrenceReading ? { rule: recurrenceReading.rule, from: recurrenceReading.from, text: tokens.find((token) => token.kind === 'recurrence')?.text.trim() ?? '' } : null,
    priority: priority?.kind === 'priority' ? priority.priority : null,
    project,
    labels: [...new Set(labels)],
    remind: remindAt,
    tokens: tokens.map(({ start, end, kind, text: typed }) => ({ start, end, kind, text: typed }))
  }
}
