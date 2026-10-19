import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isTopLayer, isWithinLayer, pushLayer } from './layers'

export type PopoverAnchor = HTMLElement | DOMRect | { x: number; y: number } | null
export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'right-start' | 'top-start'

export interface PopoverProps {
  anchor: PopoverAnchor
  open: boolean
  onClose: () => void
  placement?: PopoverPlacement
  children: ReactNode
  className?: string
}

const GAP = 4
const MARGIN = 8

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function anchorBox(anchor: PopoverAnchor): Box | null {
  if (!anchor) return null
  if (anchor instanceof HTMLElement) {
    if (!anchor.isConnected) return null
    const r = anchor.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }
  if ('width' in anchor) {
    return { left: anchor.left, top: anchor.top, right: anchor.right, bottom: anchor.bottom }
  }
  return { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y }
}

function place(a: Box, width: number, height: number, placement: PopoverPlacement) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left: number
  let top: number
  if (placement === 'right-start') {
    left = a.right + GAP
    top = a.top
    if (left + width > vw - MARGIN && a.left - GAP - width >= MARGIN) left = a.left - GAP - width
  } else {
    left = placement === 'bottom-end' ? a.right - width : a.left
    const below = a.bottom + GAP
    const above = a.top - GAP - height
    if (placement === 'top-start') top = above < MARGIN && below + height <= vh - MARGIN ? below : above
    else top = below + height > vh - MARGIN && above >= MARGIN ? above : below
  }
  left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN))
  top = Math.max(MARGIN, Math.min(top, vh - height - MARGIN))
  return { left: Math.round(left), top: Math.round(top) }
}

export function Popover(props: PopoverProps) {
  if (!props.open || !props.anchor) return null
  return <PopoverLayer {...props} />
}

function PopoverLayer({ anchor, onClose, placement = 'bottom-start', children, className }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Read while rendering: by the time effects run, the content may already have taken the focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (): void => {
      const box = anchorBox(anchor)
      if (!box) return
      const next = place(box, el.offsetWidth, el.offsetHeight, placement)
      setPos((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [anchor, placement])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const release = pushLayer(el)
    const onMouseDown = (event: MouseEvent): void => {
      if (isWithinLayer(el, event.target)) return
      // A click on the anchor is left to the anchor's own toggle handler.
      if (anchor instanceof HTMLElement && event.target instanceof Node && anchor.contains(event.target)) {
        return
      }
      closeRef.current()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      // Escape that ends an IME composition belongs to the composition.
      if (event.key !== 'Escape' || event.isComposing || !isTopLayer(el)) return
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      release()
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchor])

  // A popover that took the focus (a menu, a search field) gives it back when it closes, so
  // the keyboard is not dropped on <body>. One that never held the focus leaves it alone.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const previous = opener
    let held = el.contains(document.activeElement)
    const onFocusIn = (): void => {
      held = true
    }
    const onFocusOut = (event: FocusEvent): void => {
      // relatedTarget is null when the focused node is being removed with the popover.
      if (event.relatedTarget instanceof Node && !el.contains(event.relatedTarget)) held = false
    }
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('focusout', onFocusOut)
    return () => {
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('focusout', onFocusOut)
      const active = document.activeElement
      const lost = !active || active === document.body || el.contains(active)
      if (held && lost && previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [opener])

  const style: CSSProperties = pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }

  return createPortal(
    <div
      ref={ref}
      className={className ? `ui-popover glass-thick ${className}` : 'ui-popover glass-thick'}
      style={style}
      data-placement={placement}
      data-popover=""
      role="dialog"
    >
      {children}
    </div>,
    document.body
  )
}
