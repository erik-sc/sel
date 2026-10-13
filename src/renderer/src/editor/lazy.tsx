// Entry point into the page editor for the shell, which must not pull it into its own chunk.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'
import type { PageEditorProps } from './PageEditor'

const load = (): Promise<typeof import('./PageEditor')> => import('./PageEditor')
const PageEditorImpl = lazy(() => load().then((module) => ({ default: module.PageEditor })))

/** Starts fetching the editor code; call it when a page is about to be shown. */
export function preloadEditor(): void {
  void load().catch(() => undefined)
}

/** `PageEditor`, loaded on demand. */
export function PageEditor(props: PageEditorProps): JSX.Element {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PageEditorImpl {...props} />
    </Suspense>
  )
}
