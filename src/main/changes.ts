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
  private readonly links = new Map<string, Set<string>>()
  private scheduled = false

  constructor(
    private readonly deliver: (change: ChangeEvent) => void,
    private readonly schedule: (flush: () => void) => void = setImmediate
  ) {}

  /**
   * Queues `ids` as changed by the client `origin`. Reads and failed mutations pass an empty list.
   * `reset` names the pages among them whose content was replaced by restoring a version, and
   * `links` the blocks among them whose text holds or held a link to a page.
   */
  add(origin: string, ids: readonly string[], reset: readonly string[] = [], links: readonly string[] = []): void {
    if (!ids.length && !reset.length) return
    let set = this.pending.get(origin)
    if (!set) this.pending.set(origin, (set = new Set()))
    for (const id of ids) set.add(id)
    if (reset.length) {
      let pages = this.resets.get(origin)
      if (!pages) this.resets.set(origin, (pages = new Set()))
      for (const id of reset) pages.add(id)
    }
    if (links.length) {
      let blocks = this.links.get(origin)
      if (!blocks) this.links.set(origin, (blocks = new Set()))
      for (const id of links) blocks.add(id)
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
    const links = new Map(this.links)
    this.pending.clear()
    this.resets.clear()
    this.links.clear()
    for (const [origin, ids] of batches) {
      try {
        const change: ChangeEvent = { ids: [...ids], origin }
        const reset = resets.get(origin)
        if (reset) change.reset = [...reset]
        const linked = links.get(origin)
        if (linked) change.links = [...linked]
        this.deliver(change)
      } catch (err) {
        // One window that cannot be reached must not keep the others from hearing about the change.
        console.error('[ipc] could not deliver a change event', err)
      }
    }
  }
}
