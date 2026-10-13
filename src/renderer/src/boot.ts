/**
 * Start-up helpers: timing marks, the synchronous settings mirror and idle scheduling.
 *
 * Marks (read them with `performance.getEntriesByType('mark')`):
 *   boot:start       the entry module started running
 *   boot:settings    theme, sidebar geometry and appearance arrived from the main process
 *   boot:mounted     React committed the shell for the first time
 *   boot:first-page  the first page (or the empty state) has its content on screen
 */
export type BootStage = 'start' | 'settings' | 'mounted' | 'first-page'

const marked = new Set<BootStage>()

/** Records `boot:<stage>` once; later calls for the same stage are ignored. */
export function bootMark(stage: BootStage): void {
  if (marked.has(stage)) return
  marked.add(stage)
  try {
    performance.mark(`boot:${stage}`)
  } catch {
    /* timing is diagnostics only */
  }
}

/*
 * The settings live in the main process and arrive over IPC, i.e. after the first frame
 * could have been painted. A copy of the few values that decide how that frame looks
 * (theme, sidebar geometry, appearance overrides) is kept in localStorage, which is read
 * synchronously. The copy is only ever a hint: the real settings still load, win, and
 * refresh it. Readers must validate what they get exactly like the setting itself.
 */
const MIRROR_PREFIX = 'selida.boot.'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readMirror(key: string): unknown {
  try {
    const text = storage()?.getItem(MIRROR_PREFIX + key)
    return text ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

export function writeMirror(key: string, value: unknown): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(MIRROR_PREFIX + key, JSON.stringify(value))
  } catch {
    // Over quota (a large wallpaper): a stale copy would be worse than none.
    try {
      store.removeItem(MIRROR_PREFIX + key)
    } catch {
      /* nothing left to do */
    }
  }
}

type IdleWindow = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

/** Runs `task` when the main thread is idle (or after `timeout` ms at the latest). */
export function whenIdle(task: () => void, timeout = 2000): void {
  if (typeof window === 'undefined') return
  const idle = (window as unknown as IdleWindow).requestIdleCallback
  if (idle) idle.call(window, task, { timeout })
  else setTimeout(task, Math.min(timeout, 200))
}
