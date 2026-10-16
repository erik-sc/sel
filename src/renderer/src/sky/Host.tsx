// Mount point of the Sky. The screen and its stylesheet are fetched the first time it is shown;
// until then a few skeleton lines stand in, laid out like a page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const SkyScreen = lazy(() => import('./SkyScreen').then((module) => ({ default: module.SkyScreen })))

export function SkyHost(): JSX.Element {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <SkyScreen />
        </Suspense>
      </div>
    </div>
  )
}
