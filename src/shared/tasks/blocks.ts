// Time blocks (0.8.0 E2): a task of the built-in Tasks database "blocked" for part of a day. No
// property of its own: the due date already holds a start and an optional end, so a block is a
// due date whose start and end are times of the same day (`{ start: 'YYYY-MM-DDTHH:mm', end:
// 'YYYY-MM-DDTHH:mm' }`). Older copies of the app read it as a task due at the start time, and
// the database's date picker edits it as any range. Nothing here is ever written to a calendar.
//
// Pure: minutes of the day in, minutes out. The Today screen's plan and the calendar's week draw
// with it; the weekly review and the day planning (E1, C2) can read the same values.

/** The grid a block snaps to, in minutes. */
export const BLOCK_STEP = 15
/** What a task dropped on the day gets when nothing says otherwise. */
export const DEFAULT_BLOCK_MINUTES = 30
/** The shortest block. */
export const MIN_BLOCK_MINUTES = 15
/** The last minute a stored time can say (`23:59`): a block ends on its own day. */
export const LAST_MINUTE = 1439

/** A block: the day, when it starts and how long it lasts (minutes). */
export interface TimeBlock {
  /** `YYYY-MM-DD`. */
  day: string
  /** Minutes since midnight. */
  start: number
  minutes: number
}

/** A stretch of a day, in minutes since midnight; `end` is past the last minute. */
export interface Span {
  start: number
  end: number
}

const DAY = /^(\d{4}-\d{2}-\d{2})$/
const MOMENT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/

/** Minutes since midnight of a `HH:mm`, or null. */
export function minutesOf(time: string | null | undefined): number | null {
  const match = typeof time === 'string' ? /^(\d{2}):(\d{2})$/.exec(time) : null
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/** The `HH:mm` of minutes since midnight (clamped to the day). */
export function clockOf(minutes: number): string {
  const value = Math.min(Math.max(Math.round(minutes), 0), LAST_MINUTE)
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function momentParts(value: unknown): { day: string; minutes: number } | null {
  const match = typeof value === 'string' ? MOMENT.exec(value) : null
  if (!match) return null
  const minutes = minutesOf(`${match[2]}:${match[3]}`)
  return minutes === null ? null : { day: match[1], minutes }
}

/** The block a stored due date is, or null when it is not one (no time, no end, or an end on another day). */
export function blockOf(value: unknown): TimeBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { start, end } = value as { start?: unknown; end?: unknown }
  const from = momentParts(start)
  const to = momentParts(end)
  if (!from || !to || from.day !== to.day || to.minutes <= from.minutes) return null
  return { day: from.day, start: from.minutes, minutes: to.minutes - from.minutes }
}

/** How long a stored due date blocks, in minutes; null when it is not a block. */
export function durationOf(value: unknown): number | null {
  return blockOf(value)?.minutes ?? null
}

/**
 * The block made to fit its day: a start on the day, at least the shortest length, and an end no
 * later than `23:59`. Null for a day that is not one.
 */
export function fitBlock(block: TimeBlock): TimeBlock | null {
  if (!DAY.test(block.day) || !Number.isFinite(block.start) || !Number.isFinite(block.minutes)) return null
  const start = Math.min(Math.max(Math.round(block.start), 0), LAST_MINUTE - MIN_BLOCK_MINUTES)
  const minutes = Math.min(Math.max(Math.round(block.minutes), MIN_BLOCK_MINUTES), LAST_MINUTE - start)
  return { day: block.day, start, minutes }
}

/** The due date that stores a block. */
export function blockValue(block: TimeBlock): { start: string; end: string } | null {
  const fit = fitBlock(block)
  if (!fit) return null
  return { start: `${fit.day}T${clockOf(fit.start)}`, end: `${fit.day}T${clockOf(fit.start + fit.minutes)}` }
}

/** Rounds down to the grid. */
export function snap(minutes: number, step = BLOCK_STEP): number {
  return Math.floor(minutes / step) * step
}

/** Rounds to the nearest line of the grid. */
export function snapNearest(minutes: number, step = BLOCK_STEP): number {
  return Math.round(minutes / step) * step
}

/** The spans merged where they touch or overlap, in order. Empty ones are dropped. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((span) => span.end > span.start).sort((a, b) => a.start - b.start)
  const out: Span[] = []
  for (const span of sorted) {
    const last = out[out.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else out.push({ ...span })
  }
  return out
}

/** The free stretches between `from` and `to` around what is busy. */
export function freeSpans(busy: readonly Span[], from: number, to: number): Span[] {
  const out: Span[] = []
  let cursor = from
  for (const span of mergeSpans(busy)) {
    if (span.end <= cursor) continue
    if (span.start >= to) break
    if (span.start > cursor) out.push({ start: cursor, end: Math.min(span.start, to) })
    cursor = Math.max(cursor, span.end)
    if (cursor >= to) break
  }
  if (cursor < to) out.push({ start: cursor, end: to })
  return out
}

/** How many minutes between `from` and `to` nothing takes. */
export function freeMinutes(busy: readonly Span[], from: number, to: number): number {
  return freeSpans(busy, from, to).reduce((sum, span) => sum + span.end - span.start, 0)
}

/**
 * The block a task dropped at minute `at` gets: it starts on the grid line before `at`, and lasts
 * `wanted` minutes, or less when something busy starts sooner (never under the shortest block).
 * Dropped on something busy it still goes where it was put: the day is the user's to plan.
 */
export function placeBlock(day: string, at: number, busy: readonly Span[], wanted = DEFAULT_BLOCK_MINUTES): TimeBlock | null {
  const start = Math.min(Math.max(snap(at), 0), LAST_MINUTE - MIN_BLOCK_MINUTES)
  const inside = busy.some((span) => span.start <= start && span.end > start)
  let minutes = wanted
  if (!inside) {
    const next = mergeSpans(busy).find((span) => span.start > start)
    if (next && next.start - start < wanted) minutes = Math.max(next.start - start, MIN_BLOCK_MINUTES)
  }
  return fitBlock({ day, start, minutes })
}

/** The block with its end dragged to minute `end` (snapped to the grid). */
export function resizeBlock(block: TimeBlock, end: number): TimeBlock {
  return fitBlock({ ...block, minutes: snapNearest(end) - block.start }) ?? block
}

/** The block moved to start at minute `start` (snapped), keeping its length. */
export function moveBlock(block: TimeBlock, start: number): TimeBlock {
  const at = Math.min(Math.max(snapNearest(start), 0), LAST_MINUTE - block.minutes)
  return fitBlock({ ...block, start: at }) ?? block
}

/** How a day's plan stands: what is free, what the tasks without a time would want, and whether it fits. */
export interface DayLoad {
  /** Minutes nothing takes, from `from` (or now, when later) to `to`. */
  free: number
  /** The tasks still without a time, at `each` minutes apiece. */
  wanted: number
  /** Tasks left without a time. */
  unplaced: number
  /** Minutes of blocks laid over events or over other blocks. */
  overlap: number
  /** True when the day holds more than fits. */
  over: boolean
}

/**
 * Whether the day holds more than fits between `from` and `to`. `events` and `blocks` are what is
 * already placed; `unplaced` counts the open tasks still without a time, each guessed at `each`
 * minutes. A plan that piles blocks onto meetings also counts as more than fits.
 */
export function dayLoad(input: {
  events: readonly Span[]
  blocks: readonly Span[]
  unplaced: number
  from: number
  to: number
  now?: number
  each?: number
}): DayLoad {
  const { events, blocks, unplaced, to } = input
  const each = input.each ?? DEFAULT_BLOCK_MINUTES
  const from = Math.max(input.from, input.now ?? input.from)
  const busy = [...events, ...blocks]
  const free = from < to ? freeMinutes(busy, from, to) : 0
  const covered = (spans: readonly Span[]): number => mergeSpans(spans).reduce((sum, span) => sum + span.end - span.start, 0)
  // Blocks on top of events or of each other; two events that clash are the calendar's business.
  const blocked = blocks.reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0)
  const overlap = Math.max(0, blocked + covered(events) - covered(busy))
  const wanted = Math.max(0, unplaced) * each
  // Once the planned hours are over, what was left undone is not news.
  const ended = from >= to
  return { free, wanted, unplaced: Math.max(0, unplaced), overlap, over: (!ended && wanted > free) || overlap >= MIN_BLOCK_MINUTES }
}
