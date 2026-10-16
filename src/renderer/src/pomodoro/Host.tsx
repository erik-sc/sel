// Mount point of the pomodoro widget, in the lower right corner of the content. The widget and
// its stylesheet are fetched the first time a pomodoro is on; until then this renders nothing.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { usePomodoro } from './gate'

const Widget = lazy(() => import('./Widget').then((module) => ({ default: module.Widget })))

export function PomodoroHost(): JSX.Element | null {
  const on = usePomodoro((state) => !!state.snapshot?.timer)
  if (!on) return null
  return (
    <Suspense fallback={null}>
      <Widget />
    </Suspense>
  )
}
