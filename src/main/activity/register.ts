import { app } from 'electron'
import {
  ACTIVITY_KINDS,
  type ActivityKind,
  type ActivityQuery,
  type ActivityStatus,
  isActivityArea,
  isActivityKind
} from '../../shared/activity'
import type { ActivityLog } from '../db/activity'
import { defineFeature, type Registered } from '../feature'
import * as arg from '../validate'
import { querySpan, summarize } from './queries'

/**
 * The `activity:*` channels and the timers of the local activity log (../db/activity.ts): what
 * waits in memory is written every minute (and when the database closes), rows older than 12
 * months go at start-up and once a day. The events themselves are recorded where they happen:
 * edits and task changes by the repository, the pomodoro in ../pomodoro, AI requests in ../ai,
 * and a window's screens and pages through `activity:open`. Reads return aggregates only.
 */

/** How often what waits in memory is written. */
export const ACTIVITY_FLUSH_MS = 60_000
const DAY = 24 * 60 * 60_000

export function activityStatus(log: ActivityLog): ActivityStatus {
  log.flush()
  return { enabled: log.enabled(), events: log.count(), since: log.oldest() }
}

/** A query from a window, checked: numbers that are numbers, kinds that exist, a project id within bounds. */
export function activityQuery(value: unknown): ActivityQuery {
  if (value === undefined || value === null) return {}
  const raw = arg.plainObject(value, 'query')
  const query: ActivityQuery = {}
  const time = (v: unknown, what: string): number | undefined => {
    if (v === undefined || v === null) return undefined
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Invalid ${what}`)
    return v
  }
  const from = time(raw.from, 'from')
  const to = time(raw.to, 'to')
  if (from !== undefined) query.from = from
  if (to !== undefined) query.to = to
  if (raw.kinds !== undefined && raw.kinds !== null) {
    const kinds = arg.list(raw.kinds, 'kinds', ACTIVITY_KINDS.length)
    if (!kinds.every(isActivityKind)) throw new Error('Invalid kinds')
    query.kinds = kinds as ActivityKind[]
  }
  if (raw.project !== undefined && raw.project !== null) query.project = arg.text(raw.project, 'project', 64)
  return query
}

export function registerActivity(log: ActivityLog, now: () => number = Date.now): Registered<'activity'> & { start(): void } {
  const flush = (): void => {
    try {
      log.flush()
    } catch (err) {
      console.error('[activity] could not write the log', err)
    }
  }
  const prune = (): void => {
    try {
      log.prune(now())
    } catch (err) {
      console.error('[activity] could not prune the log', err)
    }
  }
  const timers: NodeJS.Timeout[] = []
  app.on('will-quit', () => {
    for (const timer of timers) clearInterval(timer)
  })
  return {
    handlers: {
      'activity:open': ([a, b]) => {
        if (!isActivityArea(a)) throw new Error('Invalid area')
        const pageId = arg.optionalId(b ?? undefined, 'pageId') ?? null
        if (a === 'page' && !pageId) throw new Error('A page needs its id')
        log.record({ kind: 'open', area: a, pageId: a === 'page' ? pageId : null })
      },
      'activity:status': () => activityStatus(log),
      'activity:summary': ([a]) => {
        const query = activityQuery(a)
        const at = now()
        const { from, to } = querySpan(query, at)
        return summarize(log.rows(from, to), query, at)
      },
      'activity:clear': () => {
        log.clear()
        return activityStatus(log)
      }
    },
    start() {
      prune()
      timers.push(setInterval(flush, ACTIVITY_FLUSH_MS).unref(), setInterval(prune, DAY).unref())
    }
  }
}

/** The local activity log: never synced, never sent to AI (see shared/activity.ts). */
export const activityFeature = defineFeature({
  namespace: 'activity',
  register: (ctx) => registerActivity(ctx.repo.activity)
})
