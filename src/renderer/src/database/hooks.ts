// Small React hooks shared by the database editors.
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Runs `commit` when the component really unmounts.
 *
 * Inputs inside popovers and windowed rows are often removed without ever
 * receiving a blur event (Escape / outside click close the popover first, a row
 * scrolls out of the window, the view switches), which used to drop the edit.
 *
 * `commit` must be idempotent and decide by itself whether there is anything to
 * save. StrictMode's simulated unmount is ignored: the effect is set up again
 * before the microtask runs.
 */
export function useCommitOnUnmount(commit: () => void): void {
  const latest = useRef(commit)
  latest.current = commit
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (!mounted.current) latest.current()
      })
    }
  }, [])
}

/**
 * True once Escape was pressed while focus was inside `ref`. Popovers close on
 * Escape from a capture listener on `document` that stops the event, so React
 * handlers never see it; listening on `window` (earlier in the capture path) lets
 * an editor tell "cancelled with Escape" from "closed by clicking elsewhere".
 */
export function useEscapePressed(ref: RefObject<HTMLElement | null>): RefObject<boolean> {
  const pressed = useRef(false)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      const el = ref.current
      if (el && event.target instanceof Node && el.contains(event.target)) pressed.current = true
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [ref])
  return pressed
}
