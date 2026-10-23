import { HERMAN_NUDGE_KINDS, type HermanLocale, type HermanNudge, type HermanNudgeKind, type PersonaId } from '../../shared/herman'
import { agoWords, capitalize, LINES, numberWord, phrasesOf, sinceWords, spanWords, type Words } from './lines'

/**
 * Herman's counsel without AI: one short line about the user's own day, composed here from what
 * the app already knows. Pure: it is handed the state and answers with a line, or with nothing.
 * No model is involved, nothing is fetched, and whether he may speak at all is decided
 * elsewhere (./scheduler.ts).
 */

/** A task as this module reads it. */
export interface CounselTask {
  title: string
  pageId: string
  /** `YYYY-MM-DD`. */
  due?: string
}

/**
 * A calendar event of today as this module reads it. An event about to start is not his to
 * mention: the alarms announce it (src/main/alarms/events.ts), with the offer to record a meeting.
 */
export interface CounselEvent {
  title: string
  start: number
  end: number
  allDay: boolean
}

export interface CounselThresholds {
  /** How long a page is edited without a real pause before he says so. */
  longSessionMs: number
  /** How many days a page went untouched before reopening it is worth a word. */
  untouchedDays: number
  /** How many tasks completed in a row make a streak. */
  streak: number
  /** The shortest stretch without events he calls free. */
  freeBlockMs: number
  /** Minutes of the local day: mornings end, the working day ends, the evening ends. */
  morningFrom: number
  morningTo: number
  workFrom: number
  eveningFrom: number
  eveningTo: number
}

export const COUNSEL_DEFAULTS: CounselThresholds = {
  longSessionMs: 50 * 60_000,
  untouchedDays: 30,
  streak: 3,
  freeBlockMs: 90 * 60_000,
  morningFrom: 5 * 60,
  morningTo: 12 * 60,
  workFrom: 8 * 60,
  eveningFrom: 17 * 60 + 30,
  eveningTo: 22 * 60
}

/** Kinds said at most once a day: the day they are about barely changes while it lasts. */
export const ONCE_A_DAY: ReadonlySet<HermanNudgeKind> = new Set(['morning', 'evening', 'free-block', 'overdue', 'today', 'inbox'])

export const TITLE_CHARS = 48

export interface CounselInput {
  now: number
  locale: HermanLocale
  /** Who says the lines: only the words that name the persona (the "Ask …" button) differ. Herman when absent. */
  persona?: PersonaId
  tasks: { overdue: readonly CounselTask[]; today: readonly CounselTask[] }
  /** Today's events, in order. */
  events: readonly CounselEvent[]
  /**
   * Tasks in the Inbox, still to refine, for two days or more (shared/tasks/refine.ts): how many,
   * and the one that has waited longest. Absent when the user turned this reminder off.
   */
  inbox?: { waiting: number; title: string; days: number } | null
  /** How long the current page has been edited without a real pause. */
  editingMs?: number
  /** The page in front, when it was opened after a long time untouched. */
  reopened?: { pageId: string; days: number } | null
  /** The app was started for the first time today, a moment ago. */
  firstLaunch?: boolean
  /** Tasks completed one after the other just now. */
  streak?: number
  /** The kind he spoke of last: never the same twice in a row. */
  lastKind?: HermanNudgeKind | null
  /** Kinds already said today (only the once-a-day ones matter). */
  saidToday?: readonly HermanNudgeKind[]
  /** How welcome each kind is, from 1 (as written) down toward 0 ("Fewer like this"). */
  weights?: Partial<Record<HermanNudgeKind, number>>
  /** Lines used lately, as `kind:index`: he avoids repeating himself. */
  recent?: readonly string[]
  /** Only these kinds are considered (a nudge raised by one event, like a streak). */
  only?: readonly HermanNudgeKind[]
  thresholds?: Partial<CounselThresholds>
  /** A number in [0, 1); injectable so that tests are exact. */
  random?: () => number
}

export interface Counsel {
  kind: HermanNudgeKind
  text: string
  action?: HermanNudge['action']
  /** `kind:index` of the line used. */
  variant: string
}

/** A title as it may appear in a line: one line, no control characters, capped. */
export function tidyTitle(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const clean = raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202f]+/g, ' ')
    .replace(/[\u201c\u201d"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > TITLE_CHARS ? `${clean.slice(0, TITLE_CHARS - 1).trimEnd()}…` : clean
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Whole days from the local day `from` to the local day of `now`. */
function daysSince(from: string | undefined, now: Date): number {
  const match = from ? DAY_RE.exec(from) : null
  if (!match) return 0
  const then = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - then) / 86_400_000)
}

/** Minutes as he would say them: exact when few, to the nearest five or ten beyond. */
function roundMinutes(minutes: number): number {
  if (minutes <= 7) return Math.max(1, Math.round(minutes))
  if (minutes <= 20) return Math.round(minutes / 5) * 5
  return Math.round(minutes / 10) * 10
}

interface Candidate {
  words: Partial<Words>
  /** The action offered with a line that names no title, and with one that does. */
  action?: HermanNudge['action']
  titledAction?: HermanNudge['action']
}

const BLANK: Words = {
  n: '',
  N: '',
  one: false,
  title: '',
  since: '',
  minutes: '',
  Minutes: '',
  until: '',
  span: '',
  Span: '',
  ago: '',
  Ago: ''
}

function candidates(input: CounselInput, limits: CounselThresholds): Partial<Record<HermanNudgeKind, Candidate>> {
  const { locale } = input
  const now = new Date(input.now)
  const minuteOfDay = now.getHours() * 60 + now.getMinutes()
  const phrases = phrasesOf(locale, input.persona)
  const out: Partial<Record<HermanNudgeKind, Candidate>> = {}
  const count = (n: number): Partial<Words> => {
    const word = numberWord(n, locale, true)
    return { n: word, N: capitalize(word), one: n === 1 }
  }
  const minutesOf = (ms: number): Partial<Words> => {
    const word = numberWord(roundMinutes(ms / 60_000), locale)
    return { minutes: word, Minutes: capitalize(word) }
  }
  const openToday: HermanNudge['action'] = { label: phrases.openToday, command: { type: 'open-today' } }
  const openTask = (task: CounselTask): HermanNudge['action'] => ({
    label: phrases.openTask,
    command: { type: 'open-page', pageId: task.pageId }
  })
  const ask = (question: string): HermanNudge['action'] => ({ label: phrases.ask, command: { type: 'ask', question } })

  const timed = input.events.filter((event) => !event.allDay && event.end > event.start)

  if ((input.streak ?? 0) >= limits.streak) out.streak = { words: count(input.streak ?? 0) }

  if ((input.editingMs ?? 0) >= limits.longSessionMs) out['long-session'] = { words: minutesOf(input.editingMs ?? 0) }

  if (input.reopened && input.reopened.days >= limits.untouchedDays) {
    const ago = agoWords(input.reopened.days, locale)
    out.reopened = { words: { ago, Ago: capitalize(ago) }, action: ask(phrases.askPage) }
  }

  if (input.firstLaunch && minuteOfDay >= limits.morningFrom && minuteOfDay < limits.morningTo)
    out.morning = { words: {}, action: openToday }

  // The evening line is an invitation to close the day: a few quiet steps, then the window rests.
  if (minuteOfDay >= limits.eveningFrom && minuteOfDay < limits.eveningTo)
    out.evening = { words: {}, action: { label: phrases.closeDay, command: { type: 'close-day' } } }

  // A stretch with nothing on the calendar, on a day that has a calendar at all.
  const busyNow = timed.some((event) => event.start <= input.now && event.end > input.now)
  if (timed.length > 0 && !busyNow && minuteOfDay >= limits.workFrom && minuteOfDay < limits.eveningFrom) {
    const next = timed.find((event) => event.start > input.now)
    const endOfWork = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, limits.eveningFrom).getTime()
    const until = next ? next.start : endOfWork
    if (until - input.now >= limits.freeBlockMs) {
      const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(until)
      const span = spanWords((until - input.now) / 60_000, locale)
      const phrase = next
        ? locale === 'pt-BR'
          ? `até as ${clock}`
          : `until ${clock}`
        : locale === 'pt-BR'
          ? 'pelo resto do dia'
          : 'for the rest of the day'
      out['free-block'] = { words: { until: phrase, span, Span: capitalize(span) }, action: ask(phrases.askFirst) }
    }
  }

  const { overdue, today } = input.tasks
  if (overdue.length > 0) {
    // The one that has waited longest speaks for the rest.
    const oldest = [...overdue].sort((a, b) => ((a.due ?? '9999') < (b.due ?? '9999') ? -1 : 1))[0]
    out.overdue = {
      words: { ...count(overdue.length), title: tidyTitle(oldest.title), since: sinceWords(daysSince(oldest.due, now), now, locale) },
      action: openToday,
      titledAction: openTask(oldest)
    }
  } else if (today.length > 0) {
    out.today = { words: { ...count(today.length), title: tidyTitle(today[0].title) }, action: openToday, titledAction: openTask(today[0]) }
  }
  const inbox = input.inbox
  if (inbox && inbox.waiting > 0) {
    out.inbox = {
      words: { ...count(inbox.waiting), title: tidyTitle(inbox.title), since: sinceWords(inbox.days, now, locale) },
      action: { label: phrases.refineNow, command: { type: 'refine-inbox' } }
    }
  }
  return out
}

/**
 * The one thing worth saying now, or null. Kinds are tried in the order of
 * `HERMAN_NUDGE_KINDS` (the most timely first); the kind said last is skipped, a once-a-day
 * kind already said today is skipped, and a kind the user asked to see less of is passed over
 * that much more often.
 */
export function compose(input: CounselInput): Counsel | null {
  const limits = { ...COUNSEL_DEFAULTS, ...input.thresholds }
  const random = input.random ?? Math.random
  const found = candidates(input, limits)
  const said = new Set(input.saidToday ?? [])
  const recent = new Set(input.recent ?? [])
  for (const kind of HERMAN_NUDGE_KINDS) {
    const candidate = found[kind]
    if (!candidate) continue
    if (input.only && !input.only.includes(kind)) continue
    if (kind === input.lastKind) continue
    if (ONCE_A_DAY.has(kind) && said.has(kind)) continue
    const weight = input.weights?.[kind]
    if (typeof weight === 'number' && weight < 1 && random() >= Math.max(0, weight)) continue

    const words: Words = { ...BLANK, ...candidate.words }
    const lines = LINES[input.locale][kind]
    const usable = lines.map((line, index) => ({ line, index })).filter(({ line }) => !line.title || words.title !== '')
    if (!usable.length) continue
    const fresh = usable.filter(({ index }) => !recent.has(`${kind}:${index}`))
    const pool = fresh.length ? fresh : usable
    const { line, index } = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
    const action = line.title ? (candidate.titledAction ?? candidate.action) : candidate.action
    return { kind, text: line.text(words), variant: `${kind}:${index}`, ...(action ? { action } : {}) }
  }
  return null
}
