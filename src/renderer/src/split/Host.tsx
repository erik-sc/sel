// Mount point of the household screen ("Divisão de contas"). The screen and its stylesheet are fetched the first time it
// is shown; until then a few skeleton lines stand in, laid out like a page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const SplitScreen = lazy(() => import('./SplitScreen').then((module) => ({ default: module.SplitScreen })))

export function SplitHost(): JSX.Element {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <SplitScreen />
        </Suspense>
      </div>
    </div>
  )
}
