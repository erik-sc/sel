// Mount point of the Fluxos screen. The screen and its stylesheet are fetched the first time it
// is shown; until then a few skeleton lines stand in, laid out like a page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const FlowsScreen = lazy(() => import('./FlowsScreen').then((module) => ({ default: module.FlowsScreen })))

export function FlowsHost(): JSX.Element {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <FlowsScreen />
        </Suspense>
      </div>
    </div>
  )
}
