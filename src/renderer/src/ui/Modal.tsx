import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isTopLayer, pushLayer } from './layers'

export interface ModalProps {
  open: boolean
  onClose: () => void
  label: string
  /** 'top' anchors the dialog near the top (command palettes); 'center' centres it. */
  align?: 'top' | 'center'
  className?: string
  children: ReactNode
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[inert]') && el.getClientRects().length > 0
  )
}

export function Modal(props: ModalProps) {
  if (!props.open) return null
  return <ModalLayer {...props} />
}

function ModalLayer({ onClose, label, align = 'center', className, children }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Read while rendering: by the time effects run, a child may already have taken the focus.
  const [previous] = useState(() => document.activeElement as HTMLElement | null)

  useEffect(() => {
    const el = overlayRef.current
    const dialog = dialogRef.current
    if (!el || !dialog) return
    const release = pushLayer(el)
    // Children that focus something themselves (a search field) ran first; otherwise the
    // dialog takes the focus, so that the keyboard is not left in the page behind it.
    if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isTopLayer(el)) return
      if (event.key === 'Escape') {
        // Escape that ends an IME composition belongs to the composition.
        if (event.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      // Keep Tab inside the dialog.
      const items = focusableIn(dialog)
      const active = document.activeElement
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const outside = !dialog.contains(active) || active === dialog
      if (event.shiftKey ? outside || active === first : outside || active === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus({ preventScroll: true })
      }
    }
    // Focus that escapes some other way (a click on the page chrome) is brought back.
    const onFocusIn = (event: FocusEvent): void => {
      if (!isTopLayer(el) || !(event.target instanceof Node) || el.contains(event.target)) return
      dialog.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      release()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [previous])

  return createPortal(
    <div
      ref={overlayRef}
      className={`ui-modal-overlay is-${align}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={className ? `ui-modal glass-thick ${className}` : 'ui-modal glass-thick'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
