/**
 * Transient notifications. `toast()` can be called from anywhere (stores, event handlers,
 * promise callbacks); <Toaster /> (mounted once by the shell) renders whatever is queued.
 */
import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

/** One thing the user can do about a notification ("Undo"). Running it dismisses the toast. */
export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastOptions {
  kind?: ToastKind
  /** Milliseconds on screen; 0 keeps the toast until it is dismissed. */
  duration?: number
  action?: ToastAction
  /** Several things to do about it (an alarm: open it, snooze it). Shown after `action`. */
  actions?: ToastAction[]
}

export interface ToastItem {
  id: string
  kind: ToastKind
  message: string
  action?: ToastAction
  actions?: ToastAction[]
}

const DEFAULT_DURATION = 4000
/** A toast that offers an action stays long enough to be read and reached. */
const ACTION_DURATION = 10_000
const ERROR_DURATION = 7000
const MAX_TOASTS = 4
const MAX_MESSAGE_LENGTH = 300

export const useToasts = create<{ toasts: ToastItem[] }>(() => ({ toasts: [] }))

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let nextId = 0

function clearTimer(id: string): void {
  const timer = timers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  timers.delete(id)
}

export function dismissToast(id: string): void {
  clearTimer(id)
  useToasts.setState((state) =>
    state.toasts.some((item) => item.id === id) ? { toasts: state.toasts.filter((item) => item.id !== id) } : state
  )
}

/**
 * Shows a notification and returns its id. A message that is already on screen is not
 * stacked a second time: its timer restarts and the existing id is returned.
 */
export function toast(message: string, options: ToastOptions = {}): string {
  const kind = options.kind ?? 'info'
  const text = message.slice(0, MAX_MESSAGE_LENGTH)
  const { toasts } = useToasts.getState()
  let item = toasts.find((entry) => entry.kind === kind && entry.message === text)
  if (!item) {
    item = { id: `toast-${++nextId}`, kind, message: text }
    if (options.action) item.action = options.action
    if (options.actions?.length) item.actions = options.actions
    const next = [...toasts, item]
    for (const dropped of next.splice(0, Math.max(0, next.length - MAX_TOASTS))) clearTimer(dropped.id)
    useToasts.setState({ toasts: next })
  } else if (options.action && item.action !== options.action) {
    // The same words again, with a newer action: the action on screen is the one that still applies.
    const shown = item
    const updated: ToastItem = { ...shown, action: options.action }
    useToasts.setState({ toasts: toasts.map((entry) => (entry === shown ? updated : entry)) })
  }
  const { id } = item
  clearTimer(id)
  const duration = options.duration ?? (kind === 'error' ? ERROR_DURATION : options.action || options.actions?.length ? ACTION_DURATION : DEFAULT_DURATION)
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), duration)
    )
  }
  return id
}

/** Logs `error` to the console (the detail is for developers) and tells the user `message`. */
export function notifyError(message: string, error?: unknown): void {
  console.error(message, error)
  toast(message, { kind: 'error' })
}
