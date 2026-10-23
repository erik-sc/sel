/**
 * How much AI was used, counted on this computer (docs/plans/release-0.8.0.md, C5): requests per
 * local day and per origin, how long they took and, when Claude Code says so in its result event
 * (`total_cost_usd`), what they cost. Kept in one setting only the main process writes
 * (`ai.usage`), for the last two weeks; never synced and never sent anywhere.
 *
 * An origin says who asked: `you` (anything asked in a window), `routine:<id>` (a routine of the
 * persona, ./routines.ts), `memory` (what the persona keeps from a conversation), or another
 * short name a later feature passes to the AI service. Unknown origins are counted as they come.
 *
 * Pure: no Electron, Node or React.
 */

/** The setting the counts are kept in. Only the main process writes it. */
export const AI_USAGE_KEY = 'ai.usage'

/** Local days kept: today and the thirteen before it, enough for "this week". */
export const USAGE_DAYS = 14

/** What anything a window asked for counts as. */
export const USAGE_YOU = 'you'

/** The prefix of a routine's origin: `routine:morning`. */
export const ROUTINE_ORIGIN_PREFIX = 'routine:'

const ORIGIN_RE = /^[a-z][a-z0-9:_-]{0,39}$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** A short lower-case name: `you`, `routine:morning`, `memory`. */
export function isUsageOrigin(value: unknown): value is string {
  return typeof value === 'string' && ORIGIN_RE.test(value)
}

/** The counts of one origin on one day. */
export interface UsageTotals {
  /** Requests that reached Claude Code. */
  requests: number
  /** Their time, start to end, in milliseconds. */
  ms: number
  /** What they cost in US dollars, summed over the requests whose cost was reported. */
  costUsd: number
  /** How many of the requests reported a cost. */
  costed: number
}

/** Day → origin → counts. */
export type UsageStore = Record<string, Record<string, UsageTotals>>

/** One finished request, as the AI service reports it. */
export interface UsageEntry {
  /** Its local day, `YYYY-MM-DD`. */
  day: string
  origin: string
  ms: number
  /** Null when the program did not say. */
  costUsd: number | null
}

const EMPTY: UsageTotals = Object.freeze({ requests: 0, ms: 0, costUsd: 0, costed: 0 }) as UsageTotals

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

/** What is stored, made safe: malformed days, origins and numbers are dropped; only the newest days are kept. */
export function readUsage(raw: unknown): UsageStore {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: UsageStore = {}
  const days = Object.keys(raw as Record<string, unknown>)
    .filter((day) => DAY_RE.test(day))
    .sort()
    .slice(-USAGE_DAYS)
  for (const day of days) {
    const origins = (raw as Record<string, unknown>)[day]
    if (origins === null || typeof origins !== 'object' || Array.isArray(origins)) continue
    const clean: Record<string, UsageTotals> = {}
    for (const [origin, value] of Object.entries(origins as Record<string, unknown>).slice(0, 40)) {
      if (!isUsageOrigin(origin) || value === null || typeof value !== 'object') continue
      const totals = value as Record<string, unknown>
      clean[origin] = {
        requests: Math.floor(count(totals['requests'])),
        ms: Math.round(count(totals['ms'])),
        costUsd: count(totals['costUsd']),
        costed: Math.floor(count(totals['costed']))
      }
    }
    out[day] = clean
  }
  return out
}

/** The store with one more request counted. Days beyond the last `USAGE_DAYS` go. */
export function addUsage(stored: UsageStore, entry: UsageEntry): UsageStore {
  if (!DAY_RE.test(entry.day)) return stored
  const origin = isUsageOrigin(entry.origin) ? entry.origin : 'other'
  const day = stored[entry.day] ?? {}
  const before = day[origin] ?? EMPTY
  const cost = entry.costUsd !== null && Number.isFinite(entry.costUsd) && entry.costUsd >= 0 ? entry.costUsd : null
  const next: UsageStore = {
    ...stored,
    [entry.day]: {
      ...day,
      [origin]: {
        requests: before.requests + 1,
        ms: before.ms + Math.max(0, Math.round(entry.ms)),
        costUsd: before.costUsd + (cost ?? 0),
        costed: before.costed + (cost === null ? 0 : 1)
      }
    }
  }
  const keep = Object.keys(next).sort().slice(-USAGE_DAYS)
  return Object.fromEntries(keep.map((key) => [key, next[key]]))
}

/** The counts of several days added up, by origin. */
export function usageOver(stored: UsageStore, days: readonly string[]): Record<string, UsageTotals> {
  const out: Record<string, UsageTotals> = {}
  for (const day of days) {
    for (const [origin, totals] of Object.entries(stored[day] ?? {})) {
      const sum = out[origin] ?? { ...EMPTY }
      out[origin] = {
        requests: sum.requests + totals.requests,
        ms: sum.ms + totals.ms,
        costUsd: sum.costUsd + totals.costUsd,
        costed: sum.costed + totals.costed
      }
    }
  }
  return out
}

/** Requests the routines made on `day`: what their daily limit counts. */
export function routineRequests(stored: UsageStore, day: string): number {
  let total = 0
  for (const [origin, totals] of Object.entries(stored[day] ?? {})) if (origin.startsWith(ROUTINE_ORIGIN_PREFIX)) total += totals.requests
  return total
}

/** All the origins of a summary added up. */
export function usageTotal(byOrigin: Record<string, UsageTotals>): UsageTotals {
  const sum: UsageTotals = { ...EMPTY }
  for (const totals of Object.values(byOrigin)) {
    sum.requests += totals.requests
    sum.ms += totals.ms
    sum.costUsd += totals.costUsd
    sum.costed += totals.costed
  }
  return sum
}

/** `day` and the six days before it, oldest first (local calendar days, `YYYY-MM-DD`). */
export function lastSevenDays(day: string): string[] {
  const [year, month, date] = day.split('-').map(Number)
  const out: string[] = []
  for (let back = 6; back >= 0; back--) out.push(new Date(Date.UTC(year, month - 1, date - back)).toISOString().slice(0, 10))
  return out
}

/** What Settings → AI shows: today and the last seven days, by origin, and where the routines stand. */
export interface UsageSummary {
  today: Record<string, UsageTotals>
  week: Record<string, UsageTotals>
  /** Requests the routines made today, and how many they may make. */
  routinesToday: number
  routineLimit: number
}

/** The summary of what is stored, as of the local day `today`. */
export function usageSummary(stored: UsageStore, today: string, routineLimit: number): UsageSummary {
  return {
    today: usageOver(stored, [today]),
    week: usageOver(stored, lastSevenDays(today)),
    routinesToday: routineRequests(stored, today),
    routineLimit
  }
}
