import { localDay } from '../../shared/briefing'
import {
  HERMAN_NUDGE_KINDS,
  type HermanFeedback,
  type HermanFrequency,
  type HermanNudgeKind,
  type HermanQuietHours
} from '../../shared/herman'

/**
 * When Herman may speak unasked. Restraint is the feature: a few times a day at most, well
 * apart, never into typing, never at night, never the same thing twice in a row. Pure: the
 * clock comes in as an argument, and what he remembers is a plain value that the caller stores.
 */

const MINUTE = 60_000

export interface SchedulerConfig {
  /** The shortest time between two nudges. */
  gapMs: number
  /** How many he may offer in one local day. */
  perDay: number
  /** How long no key must have been pressed. */
  idleMs: number
  quietHours: HermanQuietHours | null
}

export const FREQUENCIES: Record<HermanFrequency, { gapMs: number; perDay: number }> = {
  rare: { gapMs: 180 * MINUTE, perDay: 2 },
  sometimes: { gapMs: 90 * MINUTE, perDay: 4 },
  often: { gapMs: 45 * MINUTE, perDay: 8 }
}

export const IDLE_MS = 20_000
/** "Fewer like this" halves how often a kind is considered, down to this. */
export const MIN_WEIGHT = 0.125
/** How many of his own lines he remembers having used. */
export const RECENT_LINES = 40

/** What he remembers between nudges. Stored as a setting only the main process writes. */
export interface HermanMemory {
  /** The local day `shown` and `said` are about. */
  day: string
  shown: number
  /** Kinds said on `day`. */
  said: HermanNudgeKind[]
  /** When he last spoke (ms), and of what. */
  lastAt: number
  lastKind: HermanNudgeKind | null
  /** The nudge on screen or last shown: feedback names it by id. */
  lastId: string | null
  /** How welcome each kind is; absent means 1. */
  weights: Partial<Record<HermanNudgeKind, number>>
  /** Lines used lately, as `kind:index`, oldest first. */
  recent: string[]
  /** He has introduced himself. */
  met: boolean
  /** The last local day the app was started on. */
  launchDay: string
}

export const EMPTY_MEMORY: HermanMemory = {
  day: '',
  shown: 0,
  said: [],
  lastAt: 0,
  lastKind: null,
  lastId: null,
  weights: {},
  recent: [],
  met: false,
  launchDay: ''
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const isKind = (value: unknown): value is HermanNudgeKind =>
  typeof value === 'string' && (HERMAN_NUDGE_KINDS as readonly string[]).includes(value)

/** What is stored, made safe to use: anything malformed falls back to "remembers nothing". */
export function readMemory(raw: unknown): HermanMemory {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_MEMORY }
  const value = raw as Record<string, unknown>
  const day = (candidate: unknown): string => (typeof candidate === 'string' && DAY_RE.test(candidate) ? candidate : '')
  const weights: Partial<Record<HermanNudgeKind, number>> = {}
  if (value['weights'] !== null && typeof value['weights'] === 'object') {
    for (const [kind, weight] of Object.entries(value['weights'] as Record<string, unknown>)) {
      if (isKind(kind) && typeof weight === 'number' && Number.isFinite(weight)) weights[kind] = Math.min(1, Math.max(MIN_WEIGHT, weight))
    }
  }
  return {
    day: day(value['day']),
    shown: typeof value['shown'] === 'number' && Number.isFinite(value['shown']) ? Math.max(0, Math.floor(value['shown'])) : 0,
    said: Array.isArray(value['said']) ? [...new Set(value['said'].filter(isKind))] : [],
    lastAt: typeof value['lastAt'] === 'number' && Number.isFinite(value['lastAt']) ? Math.max(0, value['lastAt']) : 0,
    lastKind: isKind(value['lastKind']) ? value['lastKind'] : null,
    lastId: typeof value['lastId'] === 'string' && value['lastId'].length <= 64 ? value['lastId'] : null,
    weights,
    recent: Array.isArray(value['recent'])
      ? value['recent'].filter((item): item is string => typeof item === 'string' && item.length <= 40).slice(-RECENT_LINES)
      : [],
    met: value['met'] === true,
    launchDay: day(value['launchDay'])
  }
}

/**
 * The memory as it stands on the local day of `now`: yesterday's counts do not carry over, and
 * neither does "what he spoke of last" (the rule against repeating a kind is about one day).
 */
export function forDay(memory: HermanMemory, now: number): HermanMemory {
  const day = localDay(now)
  return memory.day === day ? memory : { ...memory, day, shown: 0, said: [], lastKind: null }
}

function minuteOfDay(ms: number): number {
  const date = new Date(ms)
  return date.getHours() * 60 + date.getMinutes()
}

/** True when `now` falls in the quiet hours. They may span midnight (21:00 to 08:00). */
export function isQuiet(quiet: HermanQuietHours | null, now: number): boolean {
  if (!quiet || quiet.from === quiet.to) return false
  const minute = minuteOfDay(now)
  return quiet.from < quiet.to ? minute >= quiet.from && minute < quiet.to : minute >= quiet.from || minute < quiet.to
}

/**
 * The moment the quiet hours that hold at `now` end. Found on the local wall clock, so that a
 * night with a changed clock still ends when the clock on the wall says so.
 */
export function quietEnd(quiet: HermanQuietHours, now: number): number {
  const date = new Date(now)
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, quiet.to).getTime()
  if (today > now) return today
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, quiet.to).getTime()
}

function nextMidnight(now: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

export type Refusal = 'off' | 'busy' | 'quiet' | 'day-limit' | 'too-soon' | 'typing'

export type Decision = { ok: true } | { ok: false; reason: Refusal; waitMs: number }

export interface Moment {
  now: number
  /** Milliseconds since a key was last pressed. */
  idleMs: number
  /** A recording, a presentation, something full screen, a dialog: not now. */
  busy?: boolean
  /** Nudges are turned on. */
  enabled?: boolean
}

/** How long a caller is told to wait before asking again when no better answer exists. */
export const RETRY_MS = 5 * MINUTE

/**
 * Whether he may speak at this moment, and when it is worth asking again if not. The checks
 * that outlast the moment come first (off, quiet hours, the day's limit, the gap), so that the
 * wait that comes back is the longest one that applies.
 */
export function decide(config: SchedulerConfig, stored: HermanMemory, moment: Moment): Decision {
  const { now } = moment
  if (moment.enabled === false) return { ok: false, reason: 'off', waitMs: RETRY_MS }
  if (config.quietHours && isQuiet(config.quietHours, now))
    return { ok: false, reason: 'quiet', waitMs: Math.max(MINUTE, quietEnd(config.quietHours, now) - now) }
  const memory = forDay(stored, now)
  if (memory.shown >= config.perDay) return { ok: false, reason: 'day-limit', waitMs: Math.max(MINUTE, nextMidnight(now) - now) }
  // A clock that was set back must not open the gate early, nor close it for longer than one gap.
  const since = now - memory.lastAt
  if (memory.lastAt > 0 && since < config.gapMs)
    return { ok: false, reason: 'too-soon', waitMs: since < 0 ? config.gapMs : config.gapMs - since }
  if (moment.busy) return { ok: false, reason: 'busy', waitMs: MINUTE }
  if (moment.idleMs < config.idleMs) return { ok: false, reason: 'typing', waitMs: Math.max(1000, config.idleMs - moment.idleMs) }
  return { ok: true }
}

/** The memory after he said something. */
export function record(stored: HermanMemory, said: { id: string; kind: HermanNudgeKind; variant: string }, now: number): HermanMemory {
  const memory = forDay(stored, now)
  return {
    ...memory,
    shown: memory.shown + 1,
    said: memory.said.includes(said.kind) ? memory.said : [...memory.said, said.kind],
    lastAt: now,
    lastKind: said.kind,
    lastId: said.id,
    recent: [...memory.recent, said.variant].slice(-RECENT_LINES)
  }
}

/**
 * The memory after the user answered a nudge. "Not now" starts the wait over from this moment;
 * "Fewer like this" makes that kind half as likely from here on. Feedback that names anything
 * but the last nudge changes nothing.
 */
export function feedback(memory: HermanMemory, id: string, answer: HermanFeedback | undefined, now: number): HermanMemory {
  if (!answer || memory.lastId !== id || !memory.lastKind) return memory
  if (answer === 'not-now') return { ...memory, lastAt: Math.max(memory.lastAt, now) }
  const kind = memory.lastKind
  return { ...memory, weights: { ...memory.weights, [kind]: Math.max(MIN_WEIGHT, (memory.weights[kind] ?? 1) / 2) } }
}

/**
 * "Reset what Herman has learned": which kinds were unwelcome and which lines he used lately.
 * The day's count and the time he last spoke stay, so that a reset is not a way around his
 * restraint; so does the fact that he has introduced himself.
 */
export function forget(memory: HermanMemory): HermanMemory {
  return { ...memory, weights: {}, recent: [], lastKind: null, lastId: null }
}
