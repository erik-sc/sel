// Entry point into the LaTeX screen for the shell, which must not pull it (or KaTeX) into its own chunk.
import { Suspense, lazy } from 'react'
import type { JSX } from 'react'
import { PageSkeleton } from '@/ui/Skeleton'

const load = (): Promise<typeof import('./LatexDocument')> => import('./LatexDocument')
const LatexDocumentImpl = lazy(() => load().then((module) => ({ default: module.LatexDocument })))

/** Starts fetching the screen's code; call it when a LaTeX document is about to be shown. */
export function preloadLatex(): void {
  void load().catch(() => undefined)
}

/** The LaTeX document screen, loaded on demand. */
export function LatexDocument(props: { pageId: string }): JSX.Element {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LatexDocumentImpl {...props} />
    </Suspense>
  )
}
