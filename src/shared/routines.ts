/**
 * The persona's routines (docs/plans/release-0.8.0.md, épico C): at a few moments of the day the
 * AI runs in the background (main/routines) and its answer waits behind one line of the persona
 * ("I put together a plan for today, want to see it?"), which opens it in the conversation
 * balloon. Nothing it proposes changes the workspace until the user presses Apply there.
 *
 *  - morning: plan the day (C2), from the agenda, today's and late tasks, the projects' next
 *    actions, the free stretches of the day and, when turned on, the user's own MCP servers (read only);
 *  - midday: a check-in on how the day is going;
 *  - evening: a draft of the close of the day (C4), for today's line in Meditations;
 *  - weekly: on Friday or Sunday evening, the weekly review is offered (no AI is run for it);
 *  - stalled: a task postponed again and again, or untouched for long, and a way to unstick it (C3).
 *
 * All off by default, each with its time; turned on here (Settings → AI → Routines) or by the
 * onboarding (`withRoutines`). A daily limit of requests (C5) stops them until the next day.
 * Pure: no Electron, Node or React.
 */
import type { AiSent } from './aiContext'
import type { CommandSpec } from './commands'
import type { InvokeChannels } from './ipc'
import type { SettingsSpec } from './settings'
import type { UsageSummary } from './aiUsage'

export const ROUTINE_IDS = ['morning', 'midday', 'evening', 'weekly', 'stalled'] as const
export type RoutineId = (typeof ROUTINE_IDS)[number]

export function isRoutineId(value: unknown): value is RoutineId {
  return typeof value === 'string' && (ROUTINE_IDS as readonly string[]).includes(value)
}

/** The routines that run the AI. The weekly one only offers the review. */
export const AI_ROUTINES: readonly RoutineId[] = ['morning', 'midday', 'evening', 'stalled']

export interface RoutineSetting {
  on: boolean
  /** When it may start, `HH:mm`, local. */
  time: string
}

export interface RoutinesSettings {
  routines: Record<RoutineId, RoutineSetting>
  /** The day the weekly one is on: 5 Friday, 0 Sunday (Date#getDay). */
  weeklyDay: 0 | 5
  /** Requests the routines may make in one local day. */
  limit: number
}

/** One setting, written by Settings and by the onboarding. Not synced: each computer runs its own. */
export const ROUTINES_KEY = 'ai.routines'

/** The earliest and latest a routine may be set for, in minutes of the day: never at night. */
export const ROUTINE_HOURS = { from: 6 * 60, to: 21 * 60 + 30 } as const

export const ROUTINE_LIMIT = { min: 1, max: 20, default: 6 } as const

export const ROUTINE_DEFAULTS: RoutinesSettings = {
  routines: {
    morning: { on: false, time: '08:30' },
    midday: { on: false, time: '13:30' },
    evening: { on: false, time: '17:30' },
    weekly: { on: false, time: '17:00' },
    stalled: { on: false, time: '10:30' }
  },
  weeklyDay: 5,
  limit: ROUTINE_LIMIT.default
}

const TIME_RE = /^(\d{2}):(\d{2})$/

/** Minutes of the day of a `HH:mm`, or null. */
export function routineMinutes(time: unknown): number | null {
  const match = typeof time === 'string' ? TIME_RE.exec(time) : null
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/** A `HH:mm` within the allowed hours, or null when it is not one. */
export function cleanRoutineTime(time: unknown): string | null {
  const minutes = routineMinutes(time)
  if (minutes === null) return null
  const clamped = Math.min(ROUTINE_HOURS.to, Math.max(ROUTINE_HOURS.from, minutes))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/** What is stored, made safe: anything missing or malformed takes its default (off). */
export function readRoutines(raw: unknown): RoutinesSettings {
  const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const stored =
    value['routines'] !== null && typeof value['routines'] === 'object' && !Array.isArray(value['routines'])
      ? (value['routines'] as Record<string, unknown>)
      : {}
  const routines = {} as Record<RoutineId, RoutineSetting>
  for (const id of ROUTINE_IDS) {
    const entry = stored[id] !== null && typeof stored[id] === 'object' ? (stored[id] as Record<string, unknown>) : {}
    routines[id] = { on: entry['on'] === true, time: cleanRoutineTime(entry['time']) ?? ROUTINE_DEFAULTS.routines[id].time }
  }
  const limit = value['limit']
  return {
    routines,
    weeklyDay: value['weeklyDay'] === 0 ? 0 : 5,
    limit:
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(ROUTINE_LIMIT.max, Math.max(ROUTINE_LIMIT.min, Math.round(limit)))
        : ROUTINE_LIMIT.default
  }
}

/** What a renderer may store: an object, read as above. Anything else is refused. */
export function cleanRoutinesSetting(key: string, value: unknown): RoutinesSettings | undefined {
  if (key !== ROUTINES_KEY || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return readRoutines(value)
}

export const ROUTINES_SETTINGS: SettingsSpec = { keys: [ROUTINES_KEY], clean: cleanRoutinesSetting }

/** The settings with some routines turned on or off (for the onboarding: "turn on the morning plan"). */
export function withRoutines(settings: RoutinesSettings, ids: readonly RoutineId[], on: boolean): RoutinesSettings {
  const routines = { ...settings.routines }
  for (const id of ids) routines[id] = { ...routines[id], on }
  return { ...settings, routines }
}

/** True when any routine is on. */
export function anyRoutineOn(settings: RoutinesSettings): boolean {
  return ROUTINE_IDS.some((id) => settings.routines[id].on)
}

// ---- what reaches a window ---------------------------------------------------------

/** An answer prepared by a routine: what the balloon opens on (renderer/ai/balloonGate.ts `BalloonDelivery`). */
export interface RoutineDelivery {
  title: string
  request: string
  answer: string
  /** `routine:morning`… */
  source: string
  today?: boolean
  pageId?: string
  sent?: AiSent
}

/**
 * What the persona says for a routine: a line with a button that opens the prepared answer
 * (`balloon`), opens the weekly review (`review`), or a line alone (`note`: the daily limit was
 * reached, or nothing needed doing).
 */
export interface RoutineOffer {
  id: string
  routine: RoutineId | 'limit'
  kind: 'balloon' | 'review' | 'note'
  line: string
  /** The button. */
  label?: string
  delivery?: RoutineDelivery
}

/** What a window tells the main process when it asks whether something is ready. */
export interface RoutineSignals {
  /** Milliseconds since a key was last pressed in this window. */
  idleMs: number
  /** The balloon or a dialog is open, the window is not in front… */
  busy?: boolean
}

export interface RoutineReply {
  offer: RoutineOffer | null
  /** When it is worth asking again. */
  waitMs: number
}

export interface RoutinesApi {
  /** Something prepared, when this is a moment to say it. */
  next(signals: RoutineSignals): Promise<RoutineReply>
  /** Runs a routine now ("Run routine now" in the palette) and resolves with what it prepared. */
  run(id: RoutineId): Promise<RoutineOffer | null>
  /** Requests made today and this week, by origin (Settings → AI). */
  usage(): Promise<UsageSummary>
  /** Something was prepared: worth asking `next` soon. Returns an unsubscribe function. */
  onReady(listener: () => void): () => void
}

/** The invoke channels of `api.routines` (see `INVOKE` in ./api.ts). */
export const ROUTINES_INVOKE = {
  'routines:next': true,
  'routines:run': true,
  'routines:usage': true
} as const satisfies Record<InvokeChannels<{ routines: RoutinesApi }>, true>

/** Sent to every window when a routine has something ready. */
export const ROUTINES_READY_CHANNEL = 'routines:ready'

/** "Run routine now", one per routine, in the palette while AI is on. */
export const ROUTINES_COMMANDS = [
  {
    id: 'routine-morning',
    palette: {
      title: 'Run routine now: plan the day',
      keywords: ['routine', 'rotina', 'planejar o dia', 'plan my day', 'ai', 'priorities', 'prioridades'],
      order: 141
    }
  },
  {
    id: 'routine-midday',
    palette: { title: 'Run routine now: midday check-in', keywords: ['routine', 'rotina', 'meio do dia', 'check-in', 'ai'], order: 142 }
  },
  {
    id: 'routine-evening',
    palette: {
      title: 'Run routine now: draft the close of the day',
      keywords: ['routine', 'rotina', 'fechar o dia', 'close the day', 'ai', 'meditations', 'meditações'],
      order: 143
    }
  },
  {
    id: 'routine-weekly',
    palette: { title: 'Run routine now: weekly review', keywords: ['routine', 'rotina', 'revisão da semana', 'week'], order: 144 }
  },
  {
    id: 'routine-stalled',
    palette: {
      title: 'Run routine now: unstick a stalled task',
      keywords: ['routine', 'rotina', 'destravar', 'parada', 'stuck', 'postponed', 'adiada', 'ai'],
      order: 145
    }
  }
] as const satisfies readonly CommandSpec[]

/** The command of each routine. */
export const ROUTINE_COMMAND: Record<RoutineId, (typeof ROUTINES_COMMANDS)[number]['id']> = {
  morning: 'routine-morning',
  midday: 'routine-midday',
  evening: 'routine-evening',
  weekly: 'routine-weekly',
  stalled: 'routine-stalled'
}

// ---- words of Settings ------------------------------------------------------------------

export interface RoutinesCopy {
  title: string
  intro: string
  names: Record<RoutineId, string>
  helps: Record<RoutineId, string>
  at: string
  friday: string
  sunday: string
  on: string
  off: string
  limitLabel: string
  limitHelp: string
  perDay: string
  runNow: string
  usageTitle: string
  usageHelp: string
  today: string
  week: string
  nothing: string
  origin: (origin: string) => string
  requests: (n: number) => string
  routinesToday: (used: number, limit: number) => string
  failed: string
}

const ROUTINE_NAMES_EN: Record<RoutineId, string> = {
  morning: 'Plan the day',
  midday: 'Midday check-in',
  evening: 'Close the day',
  weekly: 'Weekly review',
  stalled: 'Unstick a stalled task'
}

const ROUTINE_NAMES_PT: Record<RoutineId, string> = {
  morning: 'Planejar o dia',
  midday: 'Meio do dia',
  evening: 'Fechar o dia',
  weekly: 'Revisão da semana',
  stalled: 'Destravar uma tarefa parada'
}

export const ROUTINES_COPY: Record<'en' | 'pt-BR', RoutinesCopy> = {
  en: {
    title: 'Routines',
    intro:
      'At a few moments of the day the assistant can prepare something in the background and say so in its corner. Nothing changes until you press Apply. Each one uses your Claude account.',
    names: ROUTINE_NAMES_EN,
    helps: {
      morning: 'Three priorities, what to postpone, and time blocks in the gaps of your agenda.',
      midday: 'A look at how the day is going, and what still fits.',
      evening: 'A draft of what was done, what is left and a plan for tomorrow, for today’s line in Meditations.',
      weekly: 'Offers the weekly review. No AI is used unless you ask for a summary.',
      stalled: 'A task postponed three times or untouched for two weeks, and a way to get it moving. One a day at most.'
    },
    at: 'at',
    friday: 'Friday',
    sunday: 'Sunday',
    on: 'On',
    off: 'Off',
    limitLabel: 'Daily limit',
    limitHelp: 'Requests the routines may make in a day. Once reached they stop until tomorrow, and say so once.',
    perDay: 'a day',
    runNow: 'Run now',
    usageTitle: 'Usage',
    usageHelp: 'Requests counted on this computer: how many, how long they took and, when Claude Code reports it, what they cost.',
    today: 'Today',
    week: 'Last 7 days',
    nothing: 'No requests.',
    origin: (origin) =>
      origin === 'you'
        ? 'You'
        : origin === 'memory'
          ? 'Memory'
          : origin.startsWith('routine:') && isRoutineId(origin.slice(8))
            ? `Routine: ${ROUTINE_NAMES_EN[origin.slice(8) as RoutineId].toLowerCase()}`
            : origin,
    requests: (n) => `${n} ${n === 1 ? 'request' : 'requests'}`,
    routinesToday: (used, limit) => `Routines today: ${used} of ${limit}.`,
    failed: 'The setting could not be saved.'
  },
  'pt-BR': {
    title: 'Rotinas',
    intro:
      'Em alguns momentos do dia o assistente pode preparar algo em segundo plano e avisar no canto dele. Nada muda até você apertar Aplicar. Cada uma usa a sua conta do Claude.',
    names: ROUTINE_NAMES_PT,
    helps: {
      morning: 'Três prioridades, o que adiar e blocos de tempo nos buracos da agenda.',
      midday: 'Uma olhada em como o dia está indo e no que ainda cabe.',
      evening: 'Um rascunho do que foi feito, do que ficou e um plano para amanhã, para a linha de hoje em Meditações.',
      weekly: 'Oferece a revisão da semana. Não usa AI, a não ser que você peça um resumo.',
      stalled: 'Uma tarefa adiada três vezes ou parada há duas semanas, e um jeito de destravar. No máximo uma por dia.'
    },
    at: 'às',
    friday: 'Sexta',
    sunday: 'Domingo',
    on: 'Ligada',
    off: 'Desligada',
    limitLabel: 'Limite diário',
    limitHelp: 'Pedidos que as rotinas podem fazer num dia. Atingido, elas param até amanhã e avisam uma vez.',
    perDay: 'por dia',
    runNow: 'Rodar agora',
    usageTitle: 'Uso',
    usageHelp: 'Pedidos contados neste computador: quantos, quanto tempo levaram e, quando o Claude Code informa, quanto custaram.',
    today: 'Hoje',
    week: 'Últimos 7 dias',
    nothing: 'Nenhum pedido.',
    origin: (origin) =>
      origin === 'you'
        ? 'Você'
        : origin === 'memory'
          ? 'Memória'
          : origin.startsWith('routine:') && isRoutineId(origin.slice(8))
            ? `Rotina: ${ROUTINE_NAMES_PT[origin.slice(8) as RoutineId].toLowerCase()}`
            : origin,
    requests: (n) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`,
    routinesToday: (used, limit) => `Rotinas hoje: ${used} de ${limit}.`,
    failed: 'Não foi possível salvar.'
  }
}
