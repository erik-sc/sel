// Mount points of the Today screen and of the calendar screen. A screen and its stylesheet are
// fetched the first time it is shown; until then a few skeleton lines stand in, laid out like a page.
// The host is what the task panel is laid over (tasks/panel.css), outside the scrolling page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const TodayScreen = lazy(() => import('./TodayScreen').then((module) => ({ default: module.TodayScreen })))
const CalendarScreen = lazy(() => import('./CalendarScreen').then((module) => ({ default: module.CalendarScreen })))

export function CalendarHost(): JSX.Element {
  return (
    <div className="page-host task-panel-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <CalendarScreen />
        </Suspense>
      </div>
    </div>
  )
}

export function TodayHost(): JSX.Element {
  return (
    <div className="page-host task-panel-host">
      <div className="page-scroll">
        <Suspense fallback={<PageSkeleton />}>
          <TodayScreen />
        </Suspense>
      </div>
    </div>
  )
}
