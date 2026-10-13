// Entry points into the database feature for code that must not pull it into its own
// chunk (the shell, the page editor). Nothing here imports the feature statically.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { BoxSkeleton, PageSkeleton } from '@/ui/Skeleton'
import type { SourcePickerProps } from './linkedPanels'

const loadDatabaseView = (): Promise<typeof import('./DatabaseView')> => import('./DatabaseView')
const loadRowProperties = (): Promise<typeof import('./RowProperties')> => import('./RowProperties')

const loadLinkedPanels = (): Promise<typeof import('./linkedPanels')> => import('./linkedPanels')

const SourcePickerImpl = lazy(() => loadLinkedPanels().then((module) => ({ default: module.SourcePicker })))
const DatabaseViewImpl = lazy(() => loadDatabaseView().then((module) => ({ default: module.DatabaseView })))
const RowPropertiesImpl = lazy(() => loadRowProperties().then((module) => ({ default: module.RowProperties })))

/** Starts fetching the database code; call it when a database is about to be shown. */
export function preloadDatabase(): void {
  void loadDatabaseView().catch(() => undefined)
}

export interface DatabaseViewProps {
  databaseId: string
  inline?: boolean
  onOpenPage: (id: string, opts?: { newTab?: boolean }) => void
}

/** `DatabaseView`, loaded on demand. */
export function DatabaseView(props: DatabaseViewProps): JSX.Element {
  return (
    <Suspense fallback={props.inline ? <BoxSkeleton /> : <PageSkeleton />}>
      <DatabaseViewImpl {...props} />
    </Suspense>
  )
}

/** `RowProperties`, loaded on demand. Renders nothing until then (as it does for ordinary pages). */
export function RowProperties(props: { pageId: string }): JSX.Element {
  return (
    <Suspense fallback={null}>
      <RowPropertiesImpl {...props} />
    </Suspense>
  )
}

/** Starts fetching the picker of source databases; call it when the slash menu offers a linked view. */
export function preloadSourcePicker(): void {
  void loadLinkedPanels().catch(() => undefined)
}

/** The picker of source databases for a new linked view, loaded on demand. */
export function SourcePicker(props: SourcePickerProps): JSX.Element {
  return (
    <Suspense fallback={<BoxSkeleton />}>
      <SourcePickerImpl {...props} />
    </Suspense>
  )
}
