/**
 * When sel looks for a new version by itself: only when the user turned it on, at most once a
 * day (every half hour on a computer that takes test builds), never in the first minutes after start (the app is busy opening), and never while a
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
  recordingRetryMs: 15 * 60_000,
  /** With test builds on: soon after start, and often, so that a push is on this computer within the hour. */
  previewStartDelayMs: 60_000,
  previewIntervalMs: 30 * 60_000
} as const

export interface ScheduleInput {
  /** `updates.check`, as stored. Anything but `true` is off. */
  enabled: unknown
  /** `updates.preview`, as stored: this computer takes test builds, which is a check of its own. */
  preview?: unknown
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
  const preview = input.preview === true
  if ((input.enabled !== true && !preview) || !input.supported) return { kind: 'off' }
  const { now } = input
  const interval = preview ? UPDATE_TIMING.previewIntervalMs : UPDATE_TIMING.intervalMs
  if (input.pending) return { kind: 'wait', ms: interval }
  let due = input.startedAt + (preview ? UPDATE_TIMING.previewStartDelayMs : UPDATE_TIMING.startDelayMs)
  const last = lastCheckTime(input.lastCheck, now)
  if (last !== null) due = Math.max(due, last + interval)
  if (due > now) return { kind: 'wait', ms: due - now }
  if (input.recording) return { kind: 'wait', ms: UPDATE_TIMING.recordingRetryMs }
  return { kind: 'now' }
}
