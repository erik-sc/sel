// How a task ticked on Today leaves the list without hurry: it stays where it is, done, for
// `READ_MS` so what was done can be read; then it folds for `foldMs`; then it is gone. Pure: no
// React, no DOM; timers only, so a test drives it with fake ones.

/** Where a ticked task is: done and still in place, folding away, or gone from the list. */
export type Phase = 'done' | 'folding' | 'gone'

/** How long a done task stays whole before it folds. Reduced motion keeps it: it is time to read. */
export const READ_MS = 1500
/** How long the fold takes (the design's `--duration`). */
export const FOLD_MS = 300

export interface Settler {
  /** Starts the wait of a task (again from the start when it was waiting already). */
  start: (key: string) => void
  /** Stops the wait of a task: it stays whole, as it is. */
  cancel: (key: string) => void
  /** Stops them all. */
  dispose: () => void
}

/**
 * `onPhase` hears each step of a task. `foldMs` is asked when a fold begins, so a change of the
 * reduced-motion setting is respected: with no motion the fold takes no time.
 */
export function createSettler(onPhase: (key: string, phase: Phase) => void, foldMs: () => number = () => FOLD_MS): Settler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const cancel = (key: string): void => {
    const timer = timers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(key)
  }
  return {
    start(key) {
      cancel(key)
      timers.set(
        key,
        setTimeout(() => {
          onPhase(key, 'folding')
          timers.set(
            key,
            setTimeout(() => {
              timers.delete(key)
              onPhase(key, 'gone')
            }, foldMs())
          )
        }, READ_MS)
      )
    },
    cancel,
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }
}

/** The fold takes no time when the person asked for less motion. */
export function foldDuration(reduced: boolean): number {
  return reduced ? 0 : FOLD_MS
}
