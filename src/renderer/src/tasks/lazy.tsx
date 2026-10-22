// The task panel and the field editors, loaded the first time a list needs them: Today and the
// calendar draw task rows without paying for the pickers until one is opened.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import type { TaskFieldPopoverProps } from './TaskEditors'
import type { TaskPanelProps } from './TaskPanel'

const loadEditors = (): Promise<typeof import('./TaskEditors')> => import('./TaskEditors')
const loadPanel = (): Promise<typeof import('./TaskPanel')> => import('./TaskPanel')
const FieldPopover = lazy(() => loadEditors().then((module) => ({ default: module.TaskFieldPopover })))
const Panel = lazy(() => loadPanel().then((module) => ({ default: module.TaskPanel })))

export function TaskFieldPopover(props: TaskFieldPopoverProps): JSX.Element {
  return (
    <Suspense fallback={null}>
      <FieldPopover {...props} />
    </Suspense>
  )
}

export function TaskPanel(props: TaskPanelProps): JSX.Element {
  return (
    <Suspense fallback={<aside className={props.overlay ? 'task-panel is-overlay' : 'task-panel'} aria-busy="true" />}>
      <Panel {...props} />
    </Suspense>
  )
}

/** Starts fetching the editors, when a row is about to need them. */
export function preloadTaskEditors(): void {
  void loadEditors().catch(() => undefined)
}
