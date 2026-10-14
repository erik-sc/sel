/**
 * When sel looks for a new version by itself: only when the user turned it on, at most once a
 * day, never in the first minutes after start (the app is busy opening), and never while a
 * meeting is being recorded. Check now is the user asking and does not go through here.
 *
 * Pure: no Electron, no clock of its own. Unit-tested.
 */

export const UPDATE_TIMING = {
  /** Nothing is asked before the app has been open this long. */
  startDelayMs: 5 * 60_000,
  /** At most one question to GitHub in this much time, whoever asked. */
  intervalMs: 24 * 60 * 60_000,
  /** A check that fell during a recording is tried again after this. */
  recordingRetryMs: 15 * 60_000
} as const

export interface ScheduleInput {
  /** `updates.check`, as stored. Anything but `true` is off. */
  enabled: unknown
  /** This build can be updated (installed app, or a development feed). */
  supported: boolean
  /** A meeting is being recorded in some window. */
  recording: boolean
  /** A version is being downloaded or waits to be installed: there is nothing to ask. */
  pending: boolean
  now: number
  /** When the main process started. */
  startedAt: number
  /** `updates.lastCheck`, as stored: when GitHub was last asked. */
  lastCheck: unknown
}

/** `off`: no timer at all. `wait`: decide again in `ms`. `now`: ask GitHub. */
export type ScheduleDecision = { kind: 'off' } | { kind: 'wait'; ms: number } | { kind: 'now' }

/**
 * The time of the last check, or null when there is none to go by. A time in the future means
 * the clock was set back; it is not trusted, or a clock set back a year would stop the checks
 * for a year.
 */
export function lastCheckTime(value: unknown, now: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now ? value : null
}

export function nextCheck(input: ScheduleInput): ScheduleDecision {
  if (input.enabled !== true || !input.supported) return { kind: 'off' }
  const { now } = input
  if (input.pending) return { kind: 'wait', ms: UPDATE_TIMING.intervalMs }
  let due = input.startedAt + UPDATE_TIMING.startDelayMs
  const last = lastCheckTime(input.lastCheck, now)
  if (last !== null) due = Math.max(due, last + UPDATE_TIMING.intervalMs)
  if (due > now) return { kind: 'wait', ms: due - now }
  if (input.recording) return { kind: 'wait', ms: UPDATE_TIMING.recordingRetryMs }
  return { kind: 'now' }
}
