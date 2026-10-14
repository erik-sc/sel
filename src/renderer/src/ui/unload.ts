// Last saves when the page goes away (window closed, app quit, reload).
// The registry itself is free of React, the store and the DOM; only `flushOnUnload`
// touches `window`, and only when first used.

export type Flusher = () => void

export interface FlusherRegistry {
  /** Adds a flusher; the returned function removes it again (safe to call twice). */
  add(flush: Flusher): () => void
  /** Runs every flusher once, in the order they were added. One that throws does not stop the rest. */
  run(): void
  readonly size: number
}

export function createFlusherRegistry(onError: (error: unknown) => void): FlusherRegistry {
  const flushers = new Set<{ flush: Flusher }>()
  return {
    add(flush) {
      // Wrapped so the same function can be added twice and removed independently.
      const entry = { flush }
      flushers.add(entry)
      return () => {
        flushers.delete(entry)
      }
    },
    run() {
      // A flusher may remove itself (or others) while running: walk a snapshot.
      for (const entry of [...flushers]) {
        if (!flushers.has(entry)) continue
        try {
          entry.flush()
        } catch (error) {
          onError(error)
        }
      }
    },
    get size() {
      return flushers.size
    }
  }
}

let registry: FlusherRegistry | null = null

/**
 * Runs `flush` when the page is about to unload, so that an edit still waiting for a
 * debounce or a blur is written first. The write it starts is sent to the main process
 * before the window goes, which commits it before the database closes on quit (checked
 * on screen for the close button, Alt+F4 and quitting). Returns the unsubscribe function.
 *
 * `beforeunload` rather than `pagehide`: it is the earlier of the two, and the one the
 * editor has always relied on. A flusher must be idempotent: decide by itself whether
 * there is anything left to save.
 */
export function flushOnUnload(flush: Flusher): () => void {
  if (!registry) {
    const created = createFlusherRegistry((error) => console.error('[unload] a last save failed', error))
    window.addEventListener('beforeunload', () => created.run())
    registry = created
  }
  return registry.add(flush)
}
