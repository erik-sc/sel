import { describe, expect, it } from 'vitest'
import { CLOSE_ROUTE, NOTEBOOK_ROUTE, REVIEW_ROUTE, SKY_ROUTE, TASKS_ROUTE, TODAY_ROUTE } from '../routes'
import { createTracker, DWELL_MS, type Place, placeOf } from './tracker'

describe('placeOf', () => {
  it('names the screens and the pages, and nothing else', () => {
    expect(placeOf(TODAY_ROUTE)).toEqual({ area: 'today', pageId: null })
    expect(placeOf(TASKS_ROUTE)).toEqual({ area: 'tasks', pageId: null })
    expect(placeOf(NOTEBOOK_ROUTE)).toEqual({ area: 'meditations', pageId: null })
    expect(placeOf(CLOSE_ROUTE)).toEqual({ area: 'close-day', pageId: null })
    expect(placeOf(SKY_ROUTE)).toEqual({ area: 'sky', pageId: null })
    expect(placeOf(REVIEW_ROUTE)).toEqual({ area: 'week-review', pageId: null })
    expect(placeOf('3f1c2b9e-0000-4000-8000-000000000001')).toEqual({ area: 'page', pageId: '3f1c2b9e-0000-4000-8000-000000000001' })
    expect(placeOf(null)).toBeNull()
    expect(placeOf('_unknown')).toBeNull()
    expect(placeOf('__proto__')).toBeNull()
  })
})

function harness() {
  const sent: Place[] = []
  let now = 0
  const timers: { due: number; run: () => void; live: boolean }[] = []
  const tracker = createTracker({
    send: (place) => sent.push(place),
    setTimer: (run, ms) => {
      const timer = { due: now + ms, run, live: true }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => {
      ;(handle as { live: boolean }).live = false
    }
  })
  const advance = (ms: number): void => {
    now += ms
    for (const timer of timers) {
      if (timer.live && timer.due <= now) {
        timer.live = false
        timer.run()
      }
    }
  }
  return { tracker, sent, advance }
}

describe('the tracker', () => {
  it('sends a place once it has stayed in front for a moment', () => {
    const { tracker, sent, advance } = harness()
    tracker.show(TODAY_ROUTE)
    advance(DWELL_MS - 1)
    expect(sent).toEqual([])
    advance(1)
    expect(sent).toEqual([{ area: 'today', pageId: null }])
  })

  it('skips what is only flicked through, and does not repeat itself', () => {
    const { tracker, sent, advance } = harness()
    tracker.show(TODAY_ROUTE)
    advance(DWELL_MS)
    tracker.show(TASKS_ROUTE)
    advance(100)
    tracker.show(TODAY_ROUTE)
    advance(DWELL_MS)
    tracker.show(null)
    advance(DWELL_MS)
    expect(sent.map((p) => p.area)).toEqual(['today'])
  })

  it('sends the place again when the window comes back to the front', () => {
    const { tracker, sent, advance } = harness()
    tracker.show(SKY_ROUTE)
    advance(DWELL_MS)
    tracker.focus()
    advance(DWELL_MS)
    expect(sent.map((p) => p.area)).toEqual(['sky', 'sky'])
  })
})
