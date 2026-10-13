// Talking to the AI service in the main process: starts a request, routes its events to
// whoever started it, and exposes that as a React hook driving the request state machine.
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type { AiEvent, AiRequest } from '@shared/ai'
import { noteAiEvent } from '@/herman/gate'
import { IDLE, reduceRun, type RunEvent, type RunState } from './machine'

type Listener = (event: AiEvent) => void

const listeners = new Map<string, Listener>()
/**
 * Events that arrived before the request's id did (the reply and the events race over ipc).
 * They are only worth keeping for a moment: an event nobody claims is of a request that was
 * cancelled before its id came back.
 */
let early: { event: AiEvent; at: number }[] = []
const MAX_EARLY = 400
const EARLY_MS = 10_000
let subscribed = false

function subscribe(): void {
  if (subscribed) return
  subscribed = true
  window.api.ai.onEvent((event) => {
    const listener = listeners.get(event.id)
    if (listener) return listener(event)
    const now = Date.now()
    early = early.filter((entry) => now - entry.at < EARLY_MS).slice(-(MAX_EARLY - 1))
    early.push({ event, at: now })
  })
}

export interface RunHandle {
  /** Stops the request. Safe to call at any time, any number of times. */
  cancel(): void
}

/**
 * Starts a request. `emit` receives the machine events for it, in order: `start`, then
 * `started` (or `rejected`), then deltas and one of `done` / `error`.
 */
export function startRun(request: AiRequest, report: (event: RunEvent) => void): RunHandle {
  // Herman, when he is on, shows what the request is doing: a small sign of life, nothing more.
  const emit = (event: RunEvent): void => {
    noteAiEvent(event.type, event.type === 'error' && event.code === 'cancelled')
    report(event)
  }
  subscribe()
  let id: string | null = null
  let cancelled = false
  let over = false
  const finish = (): void => {
    over = true
    if (id) listeners.delete(id)
  }
  const onEvent: Listener = (event) => {
    if (over) return
    if (event.type !== 'delta') finish()
    emit(event)
  }
  emit({ type: 'start' })
  window.api.ai.run(request).then(
    (reply) => {
      id = reply.id
      if (cancelled) {
        early = early.filter((entry) => entry.event.id !== reply.id)
        void window.api.ai.cancel(reply.id).catch(() => undefined)
        return
      }
      emit({ type: 'started', id: reply.id })
      listeners.set(reply.id, onEvent)
      const waiting = early.filter((entry) => entry.event.id === reply.id)
      early = early.filter((entry) => entry.event.id !== reply.id)
      for (const entry of waiting) onEvent(entry.event)
    },
    (error: unknown) => {
      if (cancelled) return
      over = true
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
      emit({ type: 'rejected', message: message || 'The request could not be started.' })
    }
  )
  return {
    cancel() {
      if (cancelled || over) return
      cancelled = true
      emit({ type: 'cancel' })
      if (id) {
        finish()
        void window.api.ai.cancel(id).catch(() => undefined)
      }
    }
  }
}

export interface RunControls {
  start(request: AiRequest): void
  /** Stops the current request, keeping what streamed. */
  cancel(): void
  /** Stops it and clears the state. */
  reset(): void
}

/** One request at a time, with its state. Leaving the component cancels whatever is running. */
export function useAiRun(): [RunState, RunControls] {
  const [state, dispatch] = useReducer(reduceRun, IDLE)
  const handle = useRef<RunHandle | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      handle.current?.cancel()
      handle.current = null
    }
  }, [])

  const start = useCallback((request: AiRequest) => {
    handle.current?.cancel()
    const emit = (event: RunEvent): void => {
      // Only the newest request speaks, and only while the component is there to listen.
      if (alive.current && handle.current === own) dispatch(event)
    }
    const own: RunHandle = { cancel: () => inner.cancel() }
    handle.current = own
    const inner = startRun(request, emit)
  }, [])

  const cancel = useCallback(() => handle.current?.cancel(), [])
  const reset = useCallback(() => {
    handle.current?.cancel()
    handle.current = null
    dispatch({ type: 'reset' })
  }, [])

  // One object for the life of the component: effects may depend on it.
  const controls = useMemo(() => ({ start, cancel, reset }), [start, cancel, reset])
  return [state, controls]
}
