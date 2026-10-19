import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface TooltipProps {
  label: ReactNode
  /** Optional keyboard shortcut shown dimmed after the label. */
  shortcut?: string
  side?: 'top' | 'bottom'
  delay?: number
  children: ReactNode
}

/**
 * Hover tooltip. Wraps its children in a layout-neutral element (`display: contents`)
 * and positions the bubble relative to the first child element.
 */
export function Tooltip({ label, shortcut, side = 'bottom', delay = 450, children }: TooltipProps) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const hide = (): void => {
    clearTimeout(timer.current)
    setRect(null)
  }

  const show = (): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const target = wrapRef.current?.firstElementChild
      if (target) setRect(target.getBoundingClientRect())
    }, delay)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  if (!label) return <>{children}</>

  const center = rect ? Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2)) : 0
  const flip = rect ? (side === 'bottom' ? rect.bottom + 40 > window.innerHeight : rect.top < 40) : false
  const below = (side === 'bottom') !== flip

  return (
    <span
      ref={wrapRef}
      className="ui-tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      // Keyboard users get the same hint; focus that follows a click does not reopen it.
      onFocus={(event) => {
        if (event.target instanceof Element && event.target.matches(':focus-visible')) show()
      }}
      onBlur={hide}
    >
      {children}
      {rect &&
        createPortal(
          <div
            className="ui-tooltip glass-thick"
            role="tooltip"
            style={below ? { left: center, top: rect.bottom + 6 } : { left: center, bottom: window.innerHeight - rect.top + 6 }}
          >
            {label}
            {shortcut && <span className="ui-tooltip-shortcut">{shortcut}</span>}
          </div>,
          document.body
        )}
    </span>
  )
}
