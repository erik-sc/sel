/**
 * Test-only helpers any side's tests can use. Not imported by the app bundle.
 */

export interface UntilOptions {
  /** Milliseconds before giving up. */
  timeout?: number
  /** Milliseconds between two checks. */
  interval?: number
  /** Says what was awaited when it never came. */
  what?: string
}

/**
 * Checks `probe` until it gives something truthy and returns that, instead of sleeping a fixed
 * time and hoping the work is done by then. Throws when `timeout` passes first.
 */
export async function until<T>(
  probe: () => T | Promise<T>,
  options: UntilOptions = {}
): Promise<Exclude<T, false | null | undefined | 0 | ''>> {
  const { timeout = 5000, interval = 20, what = 'the condition' } = options
  const end = Date.now() + timeout
  for (;;) {
    const value = await probe()
    if (value) return value as Exclude<T, false | null | undefined | 0 | ''>
    if (Date.now() >= end) throw new Error(`Timed out after ${timeout} ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}
