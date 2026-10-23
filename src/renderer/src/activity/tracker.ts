// Tells the local activity log (src/shared/activity.ts) which screen or page this window shows:
// once it has stayed on screen for a moment (flicking through tabs is not a visit), and again when
// the window comes back to the front (so that moving between windows reads as a move). The main
// process drops it while the log is off. Ids and screen names only: never what a page says.
import { type ActivityArea } from '@shared/activity'
import { CALENDAR_ROUTE, CLOSE_ROUTE, NOTEBOOK_ROUTE, REVIEW_ROUTE, SKY_ROUTE, TASKS_ROUTE, TODAY_ROUTE } from '../routes'
import { activeTab, isBlockId, tabKey, tabPage, useTabs } from '../store/tabs'

const SCREENS: Readonly<Record<string, ActivityArea>> = {
  [TODAY_ROUTE]: 'today',
  [CALENDAR_ROUTE]: 'calendar',
  [TASKS_ROUTE]: 'tasks',
  [NOTEBOOK_ROUTE]: 'meditations',
  [CLOSE_ROUTE]: 'close-day',
  [REVIEW_ROUTE]: 'week-review',
  [SKY_ROUTE]: 'sky'
}

/** How long a screen or page stays in front before it counts as visited. */
export const DWELL_MS = 1500

export interface Place {
  area: ActivityArea
  pageId: string | null
}

/** Where a tab that holds `key` (a route or a page id, see store/tabs.ts tabKey) is; null for a blank tab or a screen the log does not name. */
export function placeOf(key: string | null): Place | null {
  if (!key) return null
  const screen = Object.hasOwn(SCREENS, key) ? SCREENS[key] : undefined
  if (screen) return { area: screen, pageId: null }
  if (key.startsWith('_') || !isBlockId(key)) return null
  return { area: 'page', pageId: key }
}

export interface TrackerDeps {
  send(place: Place): void
  setTimer(run: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

/** The logic, free of the store and the window: `show` on every change of what is in front, `focus` when the window comes back. */
export function createTracker(deps: TrackerDeps) {
  let current: string | null = null
  let sent: string | null = null
  let timer: unknown = null
  const arm = (force: boolean): void => {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
    const place = placeOf(current)
    if (!place) return
    const key = current
    timer = deps.setTimer(() => {
      timer = null
      if (current !== key || (!force && sent === key)) return
      sent = key
      deps.send(place)
    }, DWELL_MS)
  }
  return {
    show(key: string | null): void {
      if (key === current) return
      current = key
      arm(false)
    },
    focus(): void {
      arm(true)
    }
  }
}

let started = false

/** Starts following this window's tabs (the activity feature's `init`). */
export function initActivity(): void {
  if (started) return
  started = true
  const tracker = createTracker({
    send: (place) => {
      window.api.activity.open(place.area, place.pageId).catch(() => undefined)
    },
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number)
  })
  const keyNow = (): string | null => {
    const page = tabPage(activeTab())
    return page ? tabKey(page) : null
  }
  tracker.show(keyNow())
  useTabs.subscribe(() => tracker.show(keyNow()))
  window.addEventListener('focus', () => tracker.focus())
}
