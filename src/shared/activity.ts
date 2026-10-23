/**
 * The local activity log (docs/plans/release-0.8.0.md, D1): light events of how the app is used
 * (a screen or page shown, a page edited, a task created, completed or postponed, a pomodoro, an
 * AI request), kept in the `activity` table of this computer's database for the heatmaps and
 * flows of D2–D4. Only ids, areas and times: never the text of a page.
 *
 * Local only: the table is not one sync reads (src/main/sync uploads blocks and named settings),
 * nothing of it is put in a prompt, and the setting below is not a synced one. Kept 12 months.
 * Turning it off stops it at once; "Delete history" empties it.
 *
 * Pure: no Electron, Node or React. Both sides and the tests import it.
 */
import type { CommandSpec } from './commands'
import type { InvokeChannels } from './ipc'
import type { SettingsSpec } from './settings'

/** What happened. `edit` rows are one per page per minute (`count` edits in that minute). */
export const ACTIVITY_KINDS = [
  'open',
  'edit',
  'task.created',
  'task.completed',
  'task.postponed',
  'focus.start',
  'focus.finish',
  'ai'
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/**
 * Where an `open` happened: a built-in screen, or a page (`pageId` says which). The renderer maps
 * its routes to these (renderer/src/activity); main takes no other.
 */
export const ACTIVITY_AREAS = ['today', 'calendar', 'tasks', 'meditations', 'close-day', 'week-review', 'sky', 'page'] as const
export type ActivityArea = (typeof ACTIVITY_AREAS)[number]

export function isActivityArea(value: unknown): value is ActivityArea {
  return typeof value === 'string' && (ACTIVITY_AREAS as readonly string[]).includes(value)
}

export function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(value)
}

/** One event as it is recorded. `area` holds the screen for `open` and the origin for `ai`. */
export interface ActivityEvent {
  kind: ActivityKind
  area?: string | null
  pageId?: string | null
  /** The project (a select option id of the Tasks database) of a task event. */
  project?: string | null
  /** Minutes of a finished focus phase. */
  minutes?: number | null
}

/** One stored row, as the queries read it. */
export interface ActivityRow {
  at: number
  kind: ActivityKind
  area: string | null
  pageId: string | null
  project: string | null
  /** Edits in that minute for `edit`; 1 for every other kind. */
  count: number
  minutes: number | null
}

/** How long rows are kept. */
export const ACTIVITY_RETENTION_MONTHS = 12

/** The one setting: on unless turned off. Not synced: each device decides for itself. */
export const ACTIVITY_ENABLED_KEY = 'activity.enabled'

export function activityEnabled(stored: unknown): boolean {
  return stored !== false
}

/**
 * The weekly word about your rhythm (D4): once a week at most, the persona says one short thing it
 * noticed in the log (main/activity/rhythm.ts), worked out on this computer without AI. Off unless
 * turned on; not synced.
 */
export const ACTIVITY_RHYTHM_KEY = 'activity.rhythm'

export function rhythmEnabled(stored: unknown): boolean {
  return stored === true
}

/** The week (its local Monday) and the kind of the last word about the rhythm. Only main writes it. */
export const ACTIVITY_RHYTHM_SAID_KEY = 'activity.rhythmSaid'

export const ACTIVITY_SETTINGS: SettingsSpec = {
  keys: [ACTIVITY_ENABLED_KEY, ACTIVITY_RHYTHM_KEY],
  clean: (_key, value) => (typeof value === 'boolean' ? value : undefined)
}

// ---- what the renderer reads -----------------------------------------------------

/** What a summary is asked for: a span of time, and optionally only some kinds or one project. */
export interface ActivityQuery {
  /** Inclusive start (ms since the epoch). Default: 12 months back. */
  from?: number
  /** Exclusive end. Default: just after now. */
  to?: number
  kinds?: ActivityKind[]
  project?: string
}

/** A place someone was: a screen, or a page. */
export interface ActivityPlace {
  area: string
  pageId: string | null
}

export interface ActivityTransition {
  from: ActivityPlace
  to: ActivityPlace
  count: number
}

/**
 * Aggregates of the log, never its rows: page ids and counts, no text. Days and hours are
 * local to the computer. `count` weighs each row 1: an `edit` row is a minute with edits in it.
 */
export interface ActivitySummary {
  from: number
  to: number
  total: number
  /** Days with something, oldest first, as `YYYY-MM-DD`. */
  byDay: { day: string; count: number }[]
  /** `[weekday][hour]`: weekday 0 is Sunday (Date#getDay), hours 0–23. */
  byWeekHour: number[][]
  byKind: Partial<Record<ActivityKind, number>>
  /** Task events by project; `null` for tasks with none. Most first. */
  byProject: { project: string | null; count: number }[]
  /** The most common moves from one place to the next, most first (at most 10). */
  transitions: ActivityTransition[]
  /** Time spent per area, from one `open` to the next (each visit capped, see ACTIVITY_IDLE_MS). */
  timeByArea: { area: string; ms: number }[]
  /** Time spent per area in each week of the span (weeks start on Monday, local; `week` is its Monday), oldest first. */
  byWeek: { week: string; areas: { area: string; ms: number }[] }[]
  /** Pages opened on the most days: the ones that pull you back (at most 10). */
  returning: { pageId: string; days: number; opens: number }[]
}

/** A visit counts until the next `open`, but never longer than this: away from the computer is not time spent. */
export const ACTIVITY_IDLE_MS = 30 * 60_000

export interface ActivityStatus {
  enabled: boolean
  /** Rows stored (an `edit` row is one page-minute). */
  events: number
  /** The oldest row, or null when there is none. */
  since: number | null
}

export interface ActivityApi {
  /** A screen or page is shown in this window. Ignored while the log is off. */
  open(area: ActivityArea, pageId?: string | null): Promise<void>
  status(): Promise<ActivityStatus>
  summary(query?: ActivityQuery): Promise<ActivitySummary>
  /** Deletes the whole history (and what was waiting to be written). */
  clear(): Promise<ActivityStatus>
}

/** The invoke channels of `api.activity` (see `INVOKE` in ./api.ts). */
export const ACTIVITY_INVOKE = {
  'activity:open': true,
  'activity:status': true,
  'activity:summary': true,
  'activity:clear': true
} as const satisfies Record<InvokeChannels<{ activity: ActivityApi }>, true>

/** The way to the Fluxos screen (see ./commands.ts). */
export const ACTIVITY_COMMANDS = [
  {
    id: 'open-flows',
    menu: { submenu: 'view', label: 'Flows', order: 265 },
    palette: {
      title: 'Flows',
      keywords: ['fluxos', 'heatmap', 'rhythm', 'ritmo', 'activity', 'atividade', 'where your time goes', 'para onde você vai'],
      order: 115
    }
  }
] as const satisfies readonly CommandSpec[]

// ---- words ------------------------------------------------------------------------

export interface ActivityCopy {
  label: string
  help: string
  off: string
  on: string
  count: (events: number, since: string | null) => string
  clear: string
  confirm: string
  cleared: string
  failed: string
  rhythmLabel: string
  rhythmHelp: string
}

export const ACTIVITY_COPY: Record<'en' | 'pt-BR', ActivityCopy> = {
  en: {
    label: 'Activity history',
    help: 'What you open and edit, and when, kept on this computer only for the heatmaps. Never synced, never sent to AI; 12 months at most.',
    on: 'On',
    off: 'Off',
    count: (events, since) =>
      events ? `${events} ${events === 1 ? 'entry' : 'entries'}${since ? ` since ${since}` : ''}.` : 'Nothing yet.',
    clear: 'Delete history',
    confirm: 'Delete it all?',
    cleared: 'History deleted.',
    failed: 'Something went wrong.',
    rhythmLabel: 'A word about your rhythm',
    rhythmHelp: 'Once a week at most, the assistant mentions one thing it noticed in this history. Worked out on this computer, without AI.'
  },
  'pt-BR': {
    label: 'Histórico de atividade',
    help: 'O que você abre e edita, e quando, guardado só neste computador para os heatmaps. Nunca sincroniza, nunca vai para a AI; no máximo 12 meses.',
    on: 'Ligado',
    off: 'Desligado',
    count: (events, since) =>
      events ? `${events} ${events === 1 ? 'registro' : 'registros'}${since ? ` desde ${since}` : ''}.` : 'Nada ainda.',
    clear: 'Apagar histórico',
    confirm: 'Apagar tudo?',
    cleared: 'Histórico apagado.',
    failed: 'Algo deu errado.',
    rhythmLabel: 'Um comentário sobre o seu ritmo',
    rhythmHelp:
      'No máximo uma vez por semana, o assistente comenta uma coisa que notou neste histórico. Calculado neste computador, sem AI.'
  }
}
