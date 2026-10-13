// Mount points for the AI surfaces that live in the shell. The assistant panel and the setup
// sheet are fetched the first time they are shown; nothing of them is in the start-up bundle.
import { Suspense, lazy, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { WindowControls } from '@/shell/WindowControls'
import { useAiGate } from './gate'

const loadPanel = (): Promise<typeof import('./AssistantPanel')> => import('./AssistantPanel')
const AssistantPanel = lazy(() => loadPanel().then((module) => ({ default: module.AssistantPanel })))
const SetupSheet = lazy(() => import('./SetupSheet').then((module) => ({ default: module.SetupSheet })))

/** Starts fetching the assistant panel; call it when its trigger is about to be used. */
export function preloadAssistant(): void {
  void loadPanel().catch(() => undefined)
}

/** The assistant panel: a third panel of the shell, to the right of the content sheet and as tall as the window. */
export function AssistantDock(): JSX.Element | null {
  const open = useAiGate((state) => state.enabled && state.panelOpen)
  if (!open) return null
  return (
    <Suspense
      fallback={
        <aside className="assistant glass" aria-busy="true">
          <header className="assistant-head">
            <h2 />
            <WindowControls />
          </header>
        </aside>
      }
    >
      <AssistantPanel />
    </Suspense>
  )
}

/** The sheet that explains how to install or sign in to Claude Code. */
export function AiSetup(): JSX.Element | null {
  const open = useAiGate((state) => state.setup !== null)
  // Stays mounted once shown, so that closing and reopening never suspends again.
  const [wanted, setWanted] = useState(open)
  useEffect(() => {
    if (open) setWanted(true)
  }, [open])
  if (!open && !wanted) return null
  return (
    <Suspense fallback={null}>
      <SetupSheet />
    </Suspense>
  )
}
