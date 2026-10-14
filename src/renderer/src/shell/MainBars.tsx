import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useUi } from '@/store/ui'
import { revealAfterMove } from './focusMode'

/**
 * The tab strip and the top bar. In focus mode they are hidden, and come back while the pointer
 * is at the top edge of the window (see focusMode.ts) or the keyboard is in them (shell.css).
 */
export function MainBars({ children }: { children: ReactNode }) {
  const focus = useUi((state) => state.focusMode)
  const ref = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    setRevealed(false)
    if (!focus) return
    let shown = false
    // Over the window's drag area the page gets no pointer events: the bars then stay as they are.
    const onMove = (event: PointerEvent): void => {
      const bottom = ref.current?.getBoundingClientRect().bottom ?? 0
      const next = revealAfterMove(shown, event.clientY, bottom)
      if (next === shown) return
      shown = next
      setRevealed(next)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [focus])

  return (
    <div ref={ref} className={revealed ? 'main-bars is-revealed' : 'main-bars'}>
      {children}
    </div>
  )
}
