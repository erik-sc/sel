import type { ChangeEvent } from '../shared/types'

/**
 * Collects the ids changed by ipc calls and delivers them as ChangeEvents, one
 * per origin and per turn of the event loop. A burst of mutations handled in
 * the same turn (several calls already queued, or one handler that commits more
 * than once) reaches every window as a single event carrying each id once,
 * instead of one event - and one refetch in every window - per call.
 *
 * Events are delivered after the calls that caused them have been answered.
 * Free of Electron imports so it can be unit-tested.
 */
export class ChangeFeed {
  private readonly pending = new Map<string, Set<string>>()
  private readonly resets = new Map<string, Set<string>>()
  private scheduled = false

  constructor(
    private readonly deliver: (change: ChangeEvent) => void,
    private readonly schedule: (flush: () => void) => void = setImmediate
  ) {}

  /**
   * Queues `ids` as changed by the client `origin`. Reads and failed mutations pass an empty list.
   * `reset` names the pages among them whose content was replaced by restoring a version.
   */
  add(origin: string, ids: readonly string[], reset: readonly string[] = []): void {
    if (!ids.length && !reset.length) return
    let set = this.pending.get(origin)
    if (!set) this.pending.set(origin, (set = new Set()))
    for (const id of ids) set.add(id)
    if (reset.length) {
      let pages = this.resets.get(origin)
      if (!pages) this.resets.set(origin, (pages = new Set()))
      for (const id of reset) pages.add(id)
    }
    if (this.scheduled) return
    this.scheduled = true
    this.schedule(() => this.flush())
  }

  /** Delivers everything queued so far. */
  flush(): void {
    this.scheduled = false
    const batches = [...this.pending]
    const resets = new Map(this.resets)
    this.pending.clear()
    this.resets.clear()
    for (const [origin, ids] of batches) {
      try {
        const reset = resets.get(origin)
        this.deliver(reset ? { ids: [...ids], origin, reset: [...reset] } : { ids: [...ids], origin })
      } catch (err) {
        // One window that cannot be reached must not keep the others from hearing about the change.
        console.error('[ipc] could not deliver a change event', err)
      }
    }
  }
}
