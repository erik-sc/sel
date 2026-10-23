// Mount point of the weekly review. The screen and its stylesheet are fetched the first time it is
// shown; until then a few skeleton lines stand in, laid out like a page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const ReviewScreen = lazy(() => import('./ReviewScreen').then((module) => ({ default: module.ReviewScreen })))

export function ReviewHost(): JSX.Element {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <ReviewScreen />
        </Suspense>
      </div>
    </div>
  )
}
