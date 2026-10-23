// Mount points for the AI surfaces that live in the shell. The conversation balloon and the setup
// sheet are fetched the first time they are shown; nothing of them is in the start-up bundle.
import { Suspense, lazy, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useAiGate } from './gate'

const loadBalloon = (): Promise<typeof import('./Balloon')> => import('./Balloon')
const Balloon = lazy(() => loadBalloon().then((module) => ({ default: module.Balloon })))
const SetupSheet = lazy(() => import('./SetupSheet').then((module) => ({ default: module.SetupSheet })))
const Onboarding = lazy(() => import('./Onboarding').then((module) => ({ default: module.Onboarding })))

/** Starts fetching the balloon; call it when its trigger is about to be used. */
export function preloadAssistant(): void {
  void loadBalloon().catch(() => undefined)
}

/** The conversation balloon, over the page area by the persona's corner. Renders nothing while closed. */
export function BalloonHost(): JSX.Element | null {
  const open = useAiGate((state) => state.enabled && state.balloonOpen)
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <Balloon />
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

/** The persona's introduction (0.8.0 A1): fetched the first time it opens. */
export function OnboardingHost(): JSX.Element | null {
  const open = useAiGate((state) => state.enabled && state.onboarding !== null)
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <Onboarding />
    </Suspense>
  )
}
