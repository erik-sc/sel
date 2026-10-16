// The Sky (Céu): each day written in Meditations lights a star; a month's stars draw a figure; each year
// is a sky. Everything that decides a position lives here, pure and tested in node (docs/plans/sky.md).
// The sky grows, never fades, never shows a number.

import type { NotebookLocale } from '../notebook'

export type Hemisphere = 'south' | 'north'

export const SKY_ID = 'sel-sky'
export const SKY_TITLES = { en: 'Sky', 'pt-BR': 'Céu' } as const

/** The events written under `sel-sky`, one block each, written once and never edited. */
export const SKY_TODO_PREFIX = 'sel-sky-todo-'
export const SKY_POMODORO_PREFIX = 'sel-sky-pomodoro-'
export const SKY_NAME_PREFIX = 'sel-sky-name-'
export const SKY_NAME_MAX = 40

export function todoEventId(blockId: string, day: string): string {
  return `${SKY_TODO_PREFIX}${blockId}-${day}`
}

export function pomodoroEventId(at: number): string {
  return `${SKY_POMODORO_PREFIX}${Math.round(at)}`
}

export function nameId(month: string): string {
  return `${SKY_NAME_PREFIX}${month}`
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value)
}

/** A name given to a month: one line, tidied like a Meditation, 1–40 characters (empty = none). */
export function cleanSkyName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, SKY_NAME_MAX)
      .trim()
  )
}

// ---- what the scene is built from ----------------------------------------------

export interface SkyLine {
  day: string
  text: string
}

/** A grain of star dust or a pomodoro: a stable key, its day, and when it happened (ms, 0 when unknown). */
export interface SkyMark {
  key: string
  day: string
  at: number
}

export interface SkyInput {
  meditations: SkyLine[]
  /** Completed tasks and checked to-dos. */
  grains: SkyMark[]
  pomodoros: SkyMark[]
  /** Names given to months, by 'YYYY-MM'. */
  names: Record<string, string>
  hemisphere: Hemisphere
  locale: NotebookLocale
}

// ---- what the window reads -----------------------------------------------------

/** This computer's own memory of the sky (local settings, never synced). */
export interface SkyLocalState {
  /** The day of the newest star already shown. */
  lastSeen: string | null
  /** When the Sky was last looked at (ms): grains and halos newer than this play their arrival. */
  seenAt: number
  /** Whether the first opening (the whole sky drawing itself) has played. */
  firstShown: boolean
  /** The day whose rare night has already played. */
  eventShown: string | null
  /** The newest month whose naming (animation 8) has already played. */
  namedShown: string | null
}

export interface SkyView extends SkyInput {
  /** The local day of this computer. */
  today: string
  enabled: boolean
  events: boolean
  local: SkyLocalState
}

/**
 * A moment Herman may remark on, once a day at most: a month that just became a constellation (the
 * opening where animation 8 plays), or tonight's rare night. The main process works out the rest
 * (the name, the event) from what it stores: the window only says that the moment came.
 */
export type SkyMoment = { kind: 'named'; month: string } | { kind: 'night' }

export function isSkyMoment(value: unknown): value is SkyMoment {
  if (!value || typeof value !== 'object') return false
  const v = value as { kind?: unknown; month?: unknown }
  return v.kind === 'night' || (v.kind === 'named' && isMonth(v.month))
}

export interface SkyApi {
  /** Everything the sky is drawn from. Reading never creates anything. */
  view(): Promise<SkyView>
  /** Names a month's constellation; an empty name gives the figure's back. */
  name(month: string, text: string): Promise<void>
  /** The Sky played a moment Herman may remark on. */
  moment(moment: SkyMoment): Promise<void>
  /** Something the sky is drawn from changed: read it again. */
  onChanged(listener: () => void): () => void
}

export const SKY_CHANGED_CHANNEL = 'sky:changed'

// ---- settings ---------------------------------------------------------------------

export const SKY_ENABLED_KEY = 'sky.enabled'
export const SKY_HEMISPHERE_KEY = 'sky.hemisphere'
export const SKY_EVENTS_KEY = 'sky.events'
export const SKY_LAST_SEEN_KEY = 'sky.lastSeen'
export const SKY_SEEN_AT_KEY = 'sky.seenAt'
export const SKY_FIRST_SHOWN_KEY = 'sky.firstShown'
export const SKY_EVENT_SHOWN_KEY = 'sky.eventShown'
export const SKY_NAMED_SHOWN_KEY = 'sky.namedShown'
/** Set by main once this computer's local pomodoro history has been written into the sky. */
export const SKY_BACKFILLED_KEY = 'sky.pomodoroBackfilled'

/** The keys a renderer may write. */
export const SKY_KEYS = [
  SKY_ENABLED_KEY,
  SKY_HEMISPHERE_KEY,
  SKY_EVENTS_KEY,
  SKY_LAST_SEEN_KEY,
  SKY_SEEN_AT_KEY,
  SKY_FIRST_SHOWN_KEY,
  SKY_EVENT_SHOWN_KEY,
  SKY_NAMED_SHOWN_KEY
] as const
export type SkyKey = (typeof SKY_KEYS)[number]

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** The value a sky setting accepts from a renderer, or undefined when it does not. */
export function cleanSkySetting(key: string, value: unknown): unknown {
  switch (key) {
    case SKY_ENABLED_KEY:
    case SKY_EVENTS_KEY:
    case SKY_FIRST_SHOWN_KEY:
      return typeof value === 'boolean' ? value : undefined
    case SKY_HEMISPHERE_KEY:
      return value === 'south' || value === 'north' ? value : undefined
    case SKY_LAST_SEEN_KEY:
    case SKY_EVENT_SHOWN_KEY:
      return value === null || (typeof value === 'string' && DAY_RE.test(value)) ? value : undefined
    case SKY_NAMED_SHOWN_KEY:
      return value === null || isMonth(value) ? value : undefined
    case SKY_SEEN_AT_KEY:
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
    default:
      return undefined
  }
}

/** The Sky is on unless turned off. */
export function skyEnabled(stored: unknown): boolean {
  return stored !== false
}

/** South for Portuguese, north otherwise, until the user says. */
export function skyHemisphere(stored: unknown, locale: NotebookLocale): Hemisphere {
  return stored === 'south' || stored === 'north' ? stored : locale === 'pt-BR' ? 'south' : 'north'
}

export function readLocalState(get: (key: string) => unknown): SkyLocalState {
  const day = (v: unknown): string | null => (typeof v === 'string' && DAY_RE.test(v) ? v : null)
  const seenAt = get(SKY_SEEN_AT_KEY)
  const named = get(SKY_NAMED_SHOWN_KEY)
  return {
    lastSeen: day(get(SKY_LAST_SEEN_KEY)),
    seenAt: typeof seenAt === 'number' && Number.isFinite(seenAt) ? seenAt : 0,
    firstShown: get(SKY_FIRST_SHOWN_KEY) === true,
    eventShown: day(get(SKY_EVENT_SHOWN_KEY)),
    namedShown: isMonth(named) ? named : null
  }
}

export * from './random'
export * from './figures'
export * from './moon'
export * from './events'
export * from './layout'
export * from './words'
