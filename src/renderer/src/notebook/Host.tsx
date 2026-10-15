// Mount points of the ink notebook and of the ritual that closes the day. A screen and its
// stylesheet are fetched the first time it is shown; until then a few skeleton lines stand in,
// laid out like a page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const NotebookScreen = lazy(() => import('./NotebookScreen').then((module) => ({ default: module.NotebookScreen })))
const CloseDayScreen = lazy(() => import('./CloseDayScreen').then((module) => ({ default: module.CloseDayScreen })))

export function NotebookHost(): JSX.Element {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <NotebookScreen />
        </Suspense>
      </div>
    </div>
  )
}

export function CloseDayHost(): JSX.Element {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <CloseDayScreen />
        </Suspense>
      </div>
    </div>
  )
}
