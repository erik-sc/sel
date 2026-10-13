// Mount point of the Today screen. The screen and its stylesheet are fetched the first time it
// is shown; until then a few skeleton lines stand in, laid out like a page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const TodayScreen = lazy(() => import('./TodayScreen').then((module) => ({ default: module.TodayScreen })))

export function TodayHost(): JSX.Element {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <TodayScreen />
        </Suspense>
      </div>
    </div>
  )
}
