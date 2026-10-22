// How many tasks are still to refine (shared/tasks/refine.ts), for what shows it outside the Tasks
// screen: the quiet mark on the sidebar's Tasks item and the line on Today. Always loaded and
// small: the count is asked of the main process, which reads the stored rows, and asked again
// once changes to pages settle. Whether the mark shows is its own setting (Settings → Notifications).
import { create } from 'zustand'
import { REFINE_DEFAULTS, REFINE_SETTING } from '@shared/tasks/refine'

interface Refining {
  /** Open tasks to refine. */
  count: number
  /** The sidebar's mark is on. */
  mark: boolean
}

export const useRefining = create<Refining>(() => ({ count: 0, mark: REFINE_DEFAULTS.mark }))

/** Edits arrive in bursts while someone types: one count after they settle. */
const SETTLE_MS = 800

let started = false
let ticket = 0

function count(): void {
  const mine = ++ticket
  window.api.tasks.refining().then(
    (result) => {
      const count = typeof result?.count === 'number' ? result.count : 0
      if (mine === ticket && count !== useRefining.getState().count) useRefining.setState({ count })
    },
    (error: unknown) => console.error('the tasks to refine could not be counted', error)
  )
}

/** Starts counting, once per window. */
export function initRefining(): void {
  if (started) return
  started = true
  count()
  window.api.app.getSetting<unknown>(REFINE_SETTING.mark).then(
    (stored) => {
      if (typeof stored === 'boolean') useRefining.setState({ mark: stored })
    },
    () => undefined
  )
  let timer: ReturnType<typeof setTimeout> | null = null
  window.api.onChange(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(count, SETTLE_MS)
  })
}

/** Settings → Notifications turned the mark on or off. */
export function setRefineMark(mark: boolean): void {
  useRefining.setState({ mark })
}
