/**
 * Herman: the face and the voice of sel's assistant. A small figure at the edge of the
 * window who listens, answers briefly and otherwise leaves you alone. These are the shapes
 * shared by the main process (which holds his voice, composes his counsel from what the app
 * already knows and decides when he may speak) and the renderer (which draws him).
 *
 * He wraps the AI service and changes none of its rules: the same program, no tools, the
 * prompt built in the main process, nothing in a page without the user's say-so. What he says
 * unasked ("nudges") is written here in advance and chosen locally: no model is ever called
 * for it.
 */

/** How the assistant speaks. `plain` is the assistant without Herman's voice. */
export const HERMAN_VOICES = ['plain', 'herman', 'brief'] as const
export type HermanVoice = (typeof HERMAN_VOICES)[number]

export const HERMAN_VOICE_LABELS: Record<HermanVoice, string> = {
  plain: 'Plain',
  herman: 'Herman',
  brief: 'Herman, fewer words'
}

export const HERMAN_FREQUENCIES = ['rare', 'sometimes', 'often'] as const
export type HermanFrequency = (typeof HERMAN_FREQUENCIES)[number]

export const HERMAN_SIZES = ['small', 'medium'] as const
export type HermanSize = (typeof HERMAN_SIZES)[number]

export const HERMAN_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const
export type HermanCorner = (typeof HERMAN_CORNERS)[number]

/** The hours he keeps silent, as minutes of the local day. They may span midnight; equal ends mean none. */
export interface HermanQuietHours {
  from: number
  to: number
}

export interface HermanSettings {
  enabled: boolean
  voice: HermanVoice
  nudges: boolean
  frequency: HermanFrequency
  quietHours: HermanQuietHours
  size: HermanSize
  corner: HermanCorner
}

export const HERMAN_DEFAULTS: HermanSettings = {
  enabled: true,
  voice: 'herman',
  nudges: true,
  frequency: 'sometimes',
  quietHours: { from: 21 * 60, to: 8 * 60 },
  size: 'small',
  corner: 'bottom-right'
}

/** The languages his own lines are written in. */
export type HermanLocale = 'en' | 'pt-BR'

// ---- nudges -------------------------------------------------------------------

/** The kinds of thing he may remark on, the most timely first: when several apply, that order decides. */
export const HERMAN_NUDGE_KINDS = ['event-soon', 'streak', 'long-session', 'reopened', 'morning', 'evening', 'free-block', 'overdue', 'today'] as const
export type HermanNudgeKind = (typeof HERMAN_NUDGE_KINDS)[number]

/** What a nudge can offer to do: each is something the app already does when asked. */
export type HermanCommand =
  | { type: 'open-today' }
  | { type: 'open-page'; pageId: string }
  /** A meeting page for a calendar event that is about to start. */
  | { type: 'new-meeting'; event: { title: string; start: number; end: number } }
  /** Opens the conversation with a question written into the field. It is not sent. */
  | { type: 'ask'; question: string }

export interface HermanNudge {
  id: string
  kind: HermanNudgeKind
  text: string
  action?: { label: string; command: HermanCommand }
}

export type HermanFeedback = 'not-now' | 'fewer'

/** What the window tells the main process when it asks whether Herman has something to say. */
export interface HermanSignals {
  /** Milliseconds since a key was last pressed in this window. */
  idleMs: number
  /** A dialog is open, something is being presented or played full screen, or the window is not in front. */
  busy?: boolean
  /** The page in the active tab. */
  pageId?: string
  /** How long that page has been edited without a real pause, in milliseconds. */
  editingMs?: number
  /** Set once after a page is opened: how many days it had gone without a change. */
  untouchedDays?: number
}

export const HERMAN_SIGNAL_LIMITS = { idleMs: 7 * 86_400_000, editingMs: 86_400_000, untouchedDays: 36_500 } as const

export interface HermanNudgeReply {
  nudge: HermanNudge | null
  /** Asking again sooner than this is pointless. */
  waitMs: number
}

// ---- state --------------------------------------------------------------------

export interface HermanState extends HermanSettings {
  locale: HermanLocale
  /** His two sentences of introduction, the first time he is on; null once he has said them. */
  greeting: string | null
  /** True during the quiet hours: he sleeps. */
  quiet: boolean
  /** Lines of his that the window shows by itself, in his language. */
  lines: { aiOff: string; notNow: string; fewer: string }
}

export interface HermanApi {
  state(): Promise<HermanState>
  nudge: {
    /** Asks whether he has something to say now. The main process decides; most of the time the answer is no. */
    next(signals: HermanSignals): Promise<HermanNudgeReply>
    /** The nudge was put away: by itself (no feedback), with "Not now", or with "Fewer like this". */
    dismiss(id: string, feedback?: HermanFeedback): Promise<void>
  }
  /** He has introduced himself; he will not do it again. */
  met(): Promise<void>
  /** Forgets what he learned: which kinds of nudge were unwelcome and what he said recently. */
  reset(): Promise<void>
  /** `herman:nudge`: something he says without having been asked just now. Returns an unsubscribe function. */
  onNudge(listener: (nudge: HermanNudge) => void): () => void
}

export const HERMAN_NUDGE_CHANNEL = 'herman:nudge'

// ---- settings -----------------------------------------------------------------

/** Preferences: how he behaves. */
export const HERMAN_PREFERENCE_KEYS = ['herman.enabled', 'herman.voice', 'herman.nudges', 'herman.frequency', 'herman.quietHours', 'herman.size'] as const
/** Device-local state: where he sits in this window. */
export const HERMAN_DEVICE_KEYS = ['herman.corner'] as const
/**
 * The keys a renderer may write. Everything else under `herman.` (what he remembers) belongs
 * to the main process. None of them is synced: sync carries pages and the appearance, nothing else.
 */
export const HERMAN_KEYS = [...HERMAN_PREFERENCE_KEYS, ...HERMAN_DEVICE_KEYS] as const
export type HermanKey = (typeof HERMAN_KEYS)[number]

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined => (typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : undefined)

function minuteOfDay(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440 ? value : undefined
}

/** The value a Herman setting accepts from a renderer, or undefined when it does not. */
export function cleanHermanSetting(key: string, value: unknown): unknown {
  switch (key) {
    case 'herman.enabled':
    case 'herman.nudges':
      return typeof value === 'boolean' ? value : undefined
    case 'herman.voice':
      return oneOf(HERMAN_VOICES, value)
    case 'herman.frequency':
      return oneOf(HERMAN_FREQUENCIES, value)
    case 'herman.size':
      return oneOf(HERMAN_SIZES, value)
    case 'herman.corner':
      return oneOf(HERMAN_CORNERS, value)
    case 'herman.quietHours': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
      const raw = value as Record<string, unknown>
      if (Object.keys(raw).some((name) => name !== 'from' && name !== 'to')) return undefined
      const from = minuteOfDay(raw['from'])
      const to = minuteOfDay(raw['to'])
      return from === undefined || to === undefined ? undefined : { from, to }
    }
    default:
      return undefined
  }
}

/** A stored setting, or its default when nothing valid is stored. */
export function hermanSetting<K extends keyof HermanSettings>(name: K, stored: unknown): HermanSettings[K] {
  const clean = stored === null || stored === undefined ? undefined : cleanHermanSetting(`herman.${name}`, stored)
  return (clean === undefined ? HERMAN_DEFAULTS[name] : clean) as HermanSettings[K]
}

/** The voice requests are answered in: none when Herman is off or set to plain. */
export function activeVoice(enabled: unknown, voice: unknown): Exclude<HermanVoice, 'plain'> | null {
  if (!hermanSetting('enabled', enabled)) return null
  const chosen = hermanSetting('voice', voice)
  return chosen === 'plain' ? null : chosen
}
