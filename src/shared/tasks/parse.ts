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

import {
  COUNT,
  UNIT,
  WEEKDAY,
  addDays,
  clockOf,
  countOf,
  dateRules,
  dayOfDate,
  firstMatch,
  fold,
  isoOf,
  MONTH,
  monthNumber,
  nextDate,
  nextMonthDay,
  nextWeekday,
  pad,
  rule,
  TIMES,
  unitOf,
  weekdayNumber,
  weekdayOf,
  type DateReading,
  type Day,
  type Rule
} from './dates'

// ---- matchers ---------------------------------------------------------------------------

type Reading =
  | DateReading
  | { kind: 'recurrence'; rule: string; from: 'due' | 'completion'; first: (today: Day) => Day }
  | { kind: 'remind'; time?: string; before?: number }
  | { kind: 'priority'; priority: 1 | 2 | 3 | 4 }

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

const EVERY = '(a cada|every|todos os|todas as|todos|todas|todo|toda|cada)(!?)'
const WEEKDAY_LIST = `(${WEEKDAY}(?:\\s*(?:,|e|and|&)\\s*${WEEKDAY})*)`

function recurrence(rrule: string, bang: string | undefined, first: (today: Day) => Day): Reading {
  return { kind: 'recurrence', rule: rrule, from: bang === '!' ? 'completion' : 'due', first }
}

/** `;INTERVAL=n`, or nothing for one. */
const every = (interval: number): string => (interval === 1 ? '' : `;INTERVAL=${interval}`)

/** A weekly repeat on the days of a list of weekday names ("seg e qua", "mon, wed"). */
function weekly(names: string, interval: number, bang: string | undefined): Reading | null {
  if (interval < 1 || interval > 999) return null
  const days = [
    ...new Set(
      names
        .split(/\s*(?:,|\be\b|\band\b|&)\s*/)
        .map((word) => weekdayNumber(word.trim()))
        .filter((day): day is number => day !== null)
    )
  ]
  if (!days.length) return null
  days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  return recurrence(`FREQ=WEEKLY${every(interval)};BYDAY=${days.map((day) => RRULE_DAYS[day]).join(',')}`, bang, (today) =>
    Math.min(...days.map((day) => nextWeekday(today, day)))
  )
}

/** The last day of the month of `day`. */
function lastOfMonth(day: Day): Day {
  const d = new Date(day)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
}

const RECURRENCES: Rule<Reading>[] = [
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
  rule(`${EVERY}\\s+${WEEKDAY_LIST}`, (m) => weekly(m[3], 1, m[2])),
  // What the recurrence picker writes (shared/rrule.ts ruleText) reads back as itself:
  // "a cada 2 semanas na segunda e quarta", "every 2 weeks on Monday", "toda semana na sexta".
  rule(`${EVERY}\\s+(?:${COUNT}\\s+)?(?:semanas?|weeks?)\\s+(?:(?:na|no|nas|nos|on|aos|as)\\s+)?${WEEKDAY_LIST}`, (m) =>
    weekly(m[4], m[3] ? countOf(m[3]) : 1, m[2])
  ),
  // "todo mês no dia 5", "a cada 2 meses no dia 10", "every month on the 5th", "todo mês no último dia".
  rule(
    `${EVERY}\\s+(?:${COUNT}\\s+)?(?:mes|meses|months?)\\s+(?:(?:no dia|on the|on day)\\s+(\\d{1,2})(?:st|nd|rd|th|º)?(?![:h\\d])|(no ultimo dia|on the last day))`,
    (m) => {
      const interval = m[3] ? countOf(m[3]) : 1
      const date = m[5] ? -1 : Number(m[4])
      if (interval < 1 || interval > 999 || (date !== -1 && (date < 1 || date > 31))) return null
      return recurrence(`FREQ=MONTHLY${every(interval)};BYMONTHDAY=${date}`, m[2], (from) =>
        date === -1 ? lastOfMonth(from) : (nextMonthDay(from, date) ?? from)
      )
    }
  ),
  // "todo ano em 20 de outubro", "every year on October 20".
  rule(
    `${EVERY}\\s+(?:${COUNT}\\s+)?(?:anos?|years?)\\s+(?:em|on|no dia)\\s+(?:(\\d{1,2})(?:st|nd|rd|th|º)?(?:\\s+de)?\\s+(${MONTH})|(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?)`,
    (m, today) => {
      const interval = m[3] ? countOf(m[3]) : 1
      const month = monthNumber(m[5] ?? m[6])
      const date = Number(m[4] ?? m[7])
      if (interval < 1 || interval > 999 || month === null || nextDate(today, month, date) === null) return null
      return recurrence(
        `FREQ=YEARLY${every(interval)};BYMONTH=${month};BYMONTHDAY=${date}`,
        m[2],
        (from) => nextDate(from, month, date) ?? from
      )
    }
  ),
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
const ADVERBS: Rule<Reading>[] = [
  rule('diariamente|daily', () => recurrence('FREQ=DAILY', undefined, (today) => today)),
  rule('semanalmente|weekly', () => recurrence('FREQ=WEEKLY', undefined, (today) => today)),
  rule('quinzenalmente|quinzenal|biweekly|fortnightly', () => recurrence('FREQ=WEEKLY;INTERVAL=2', undefined, (today) => today)),
  rule('mensalmente|monthly', () => recurrence('FREQ=MONTHLY', undefined, (today) => today)),
  rule('anualmente|yearly|annually', () => recurrence('FREQ=YEARLY', undefined, (today) => today))
]

const REMIND = '(?:me lembrar|lembre-me|lembre me|lembrar|lembrete|remind me|remind)'
const CLOCK = '(\\d{1,2}(?:(?::|h)\\d{2}|h)?(?:\\s*(?:am|pm|a\\.m\\.|p\\.m\\.))?)'

const REMINDERS: Rule<Reading>[] = [
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

const PRIORITIES: Rule<Reading>[] = [rule('p([1-4])', (m) => ({ kind: 'priority', priority: Number(m[1]) as 1 | 2 | 3 | 4 }))]

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
    if (span.text && input.slice(span.start, span.start + span.text.length) === span.text)
      claimed.push({ start: span.start, end: span.start + span.text.length })
  }
  const free = (span: Claimed): boolean => !claimed.some((other) => overlaps(other, span))

  /** The earliest (then longest) free match of any of `rules` that reads as something; it claims its span. */
  const take = (kind: TokenKind, rules: readonly Rule<Reading>[]): Reading | null => {
    const hit = firstMatch(folded, rules, today, free)
    if (!hit) return null
    claimed.push(hit)
    tokens.push({ start: hit.start, end: hit.end, kind, text: input.slice(hit.start, hit.end), reading: hit.reading })
    return hit.reading
  }

  const repeat = take('recurrence', RECURRENCES) ?? take('recurrence', ADVERBS)
  const remind = take('remind', REMINDERS)
  const date = take('date', dateRules(options.dayFirst ?? true))
  const time = take('time', TIMES)
  const priority = take('priority', PRIORITIES)

  /** `#name` / `@name`: a known name (the longest that fits) or the word that follows. */
  const names = (sigil: '#' | '@', known: readonly string[], kind: 'project' | 'label', many: boolean): string[] => {
    const found: string[] = []
    const knownFolded = [...known].map((name) => ({ name, folded: fold(name) })).sort((a, b) => b.folded.length - a.folded.length)
    for (let i = folded.indexOf(sigil); i >= 0; i = folded.indexOf(sigil, i + 1)) {
      if (i > 0 && !/\s/u.test(folded[i - 1])) continue
      const rest = folded.slice(i + 1)
      const exact = knownFolded.find(
        (entry) => entry.folded && rest.startsWith(entry.folded) && !/[\p{L}\p{N}_-]/u.test(rest[entry.folded.length] ?? '')
      )
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
    recurrence: recurrenceReading
      ? {
          rule: recurrenceReading.rule,
          from: recurrenceReading.from,
          text: tokens.find((token) => token.kind === 'recurrence')?.text.trim() ?? ''
        }
      : null,
    priority: priority?.kind === 'priority' ? priority.priority : null,
    project,
    labels: [...new Set(labels)],
    remind: remindAt,
    tokens: tokens.map(({ start, end, kind, text: typed }) => ({ start, end, kind, text: typed }))
  }
}
