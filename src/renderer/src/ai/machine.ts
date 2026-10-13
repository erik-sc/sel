// The life of one AI request as the UI sees it. Pure; unit tested.
import type { AiErrorCode } from '@shared/ai'

export type RunStatus = 'idle' | 'starting' | 'streaming' | 'done' | 'error' | 'cancelled'

export interface RunError {
  code: AiErrorCode
  message: string
  detail?: string
}

export interface RunState {
  status: RunStatus
  /** The id the main process gave the request; null until it answered. */
  id: string | null
  text: string
  truncated: boolean
  error: RunError | null
  /** Counts the requests started, so a view can tell one run from the next. */
  run: number
}

export type RunEvent =
  /** The UI asked for a request (it has no id yet). */
  | { type: 'start' }
  | { type: 'started'; id: string }
  /** The request was refused before it got an id (invalid, or the bridge failed). */
  | { type: 'rejected'; message: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string; text: string; truncated: boolean }
  | { type: 'error'; id: string; code: AiErrorCode; message: string; detail?: string }
  /** The user stopped it. */
  | { type: 'cancel' }
  | { type: 'reset' }

export const IDLE: RunState = { status: 'idle', id: null, text: '', truncated: false, error: null, run: 0 }

export function isBusy(state: RunState): boolean {
  return state.status === 'starting' || state.status === 'streaming'
}

/**
 * Events of a request that is no longer the current one (it was cancelled, or another was
 * started) are ignored: nothing a late process says can change what is on screen.
 */
export function reduceRun(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'start':
      return { status: 'starting', id: null, text: '', truncated: false, error: null, run: state.run + 1 }
    case 'reset':
      return { ...IDLE, run: state.run }
    case 'started':
      return state.status === 'starting' && state.id === null ? { ...state, id: event.id } : state
    case 'rejected':
      if (state.status !== 'starting' || state.id !== null) return state
      return { ...state, status: 'error', error: { code: 'failed', message: event.message } }
    case 'cancel':
      // What already streamed stays readable; it is just not going to grow.
      return isBusy(state) ? { ...state, status: 'cancelled' } : state
    case 'delta':
      if (!isBusy(state) || state.id !== event.id || !event.text) return state
      return { ...state, status: 'streaming', text: state.text + event.text }
    case 'done':
      if (!isBusy(state) || state.id !== event.id) return state
      // The final text is the whole answer; what streamed is kept only when it is empty.
      return { ...state, status: 'done', text: event.text || state.text, truncated: event.truncated }
    case 'error': {
      if (!isBusy(state) || state.id !== event.id) return state
      if (event.code === 'cancelled') return { ...state, status: 'cancelled' }
      const error: RunError = { code: event.code, message: event.message }
      if (event.detail) error.detail = event.detail
      return { ...state, status: 'error', error }
    }
  }
}
