// Mount point of the Tasks screen. The screen and its stylesheet are fetched the first time it is
// shown; until then a few skeleton lines stand in, laid out like a page.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'
import { loadTasksScreen } from './gate'

const TasksScreen = lazy(() => loadTasksScreen().then((module) => ({ default: module.TasksScreen })))

export function TasksHost(): JSX.Element {
  return (
    <div className="page-host">
      <Suspense fallback={<PageSkeleton />}>
        <TasksScreen />
      </Suspense>
    </div>
  )
}
