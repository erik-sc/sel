// Mount point of Herman's corner. The figure, his lines and their stylesheet are fetched after
// start-up, when he is on; nothing of them is in the start-up bundle.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { useHerman } from './gate'

const loadDock = (): Promise<typeof import('./Dock')> => import('./Dock')
const Dock = lazy(() => loadDock().then((module) => ({ default: module.Dock })))

/** Starts fetching the figure; called when the app is idle after start-up. */
export function preloadHerman(): void {
  if (useHerman.getState().on) void loadDock().catch(() => undefined)
}

/** Herman, docked at the edge of the page area. Renders nothing while he is off. */
export function HermanHost(): JSX.Element | null {
  const on = useHerman((state) => state.on)
  if (!on) return null
  return (
    <Suspense fallback={null}>
      <Dock />
    </Suspense>
  )
}
