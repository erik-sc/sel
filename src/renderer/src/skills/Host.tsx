// Mount point of the Skills screen. The screen and its stylesheet are fetched the first time it
// is shown; until then a few skeleton lines stand in, laid out like a page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const SkillsScreen = lazy(() => import('./SkillsScreen').then((module) => ({ default: module.SkillsScreen })))

export function SkillsHost(): JSX.Element {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <SkillsScreen />
        </Suspense>
      </div>
    </div>
  )
}
