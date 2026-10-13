// Where an inline AI session shows up in the page: after its anchor block (or first in the
// page). The slot is part of the editor chunk; what it renders is fetched when first needed.
import { Suspense, lazy, useRef } from 'react'
import type { JSX } from 'react'
import { useStore } from 'zustand'
import { useEditor } from '@/editor/context'

type InlineAiModule = typeof import('./InlineAi')

/** The preview's code once it has arrived: rendered directly from then on. */
let loaded: InlineAiModule['InlineAi'] | null = null
let loading: Promise<InlineAiModule> | null = null

function load(): Promise<InlineAiModule> {
  loading ??= import('./InlineAi').then((module) => {
    loaded = module.InlineAi
    return module
  })
  // A failed fetch is tried again by the next caller.
  loading.catch(() => (loading = null))
  return loading
}

const LazyInlineAi = lazy(() => load().then((module) => ({ default: module.InlineAi })))

/** Starts fetching the inline preview; call it when an AI entry point is about to be used. */
export function preloadInlineAi(): void {
  void load().catch(() => undefined)
}

/** Renders the session anchored at `anchorId` (null: the top of the page), when there is one. */
export function AiSlot({ anchorId }: { anchorId: string | null }): JSX.Element | null {
  const { ctrl } = useEditor()
  const session = useStore(ctrl.ui, (state) => (state.ai && state.ai.anchorId === anchorId ? state.ai : null))
  // Going through Suspense costs a visible pause even when the code is already here (React holds
  // back what follows a fallback), and the prompt bar must take the keyboard at once. Which way a
  // session is rendered is decided once: switching in the middle would start it over.
  const choice = useRef<{ key: number; component: InlineAiModule['InlineAi'] | null } | null>(null)
  if (!session) return null
  if (choice.current?.key !== session.key) choice.current = { key: session.key, component: loaded }
  const Ready = choice.current.component
  return (
    <div className="ai-slot" contentEditable={false}>
      {Ready ? (
        <Ready key={session.key} session={session} />
      ) : (
        <Suspense fallback={<div className="ai-slot-loading" aria-hidden="true" />}>
          <LazyInlineAi key={session.key} session={session} />
        </Suspense>
      )}
    </div>
  )
}
