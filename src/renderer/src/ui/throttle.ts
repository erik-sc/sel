/**
 * A gate that lets one event through per interval, for notices that could otherwise
 * repeat in a burst (a run of failed writes while typing). Pure: no store, no timers,
 * no DOM; the caller passes the clock.
 */
export type Throttle = (now: number) => boolean

/**
 * Returns a function that answers true for the first call and then false until
 * `intervalMs` has passed since the last call that answered true.
 */
export function createThrottle(intervalMs: number): Throttle {
  let last = -Infinity
  return (now) => {
    if (now - last < intervalMs) return false
    last = now
    return true
  }
}
