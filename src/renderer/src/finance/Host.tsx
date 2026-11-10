// Mount point of the Finance screen. The screen and its stylesheet are fetched the first time it
// is shown; until then a few skeleton lines stand in, laid out like a page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const FinanceScreen = lazy(() => import('./FinanceScreen').then((module) => ({ default: module.FinanceScreen })))

export function FinanceHost(): JSX.Element {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <FinanceScreen />
        </Suspense>
      </div>
    </div>
  )
}
