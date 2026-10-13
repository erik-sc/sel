import type { JSX } from 'react'

const LINE_WIDTHS = ['72%', '94%', '58%', '81%']

/** Shimmering placeholder lines for text that is still loading. */
export function SkeletonLines(): JSX.Element {
  return (
    <div className="pe-skeleton" aria-hidden="true">
      {LINE_WIDTHS.map((width) => (
        <div key={width} style={{ width }} />
      ))}
    </div>
  )
}

/**
 * Placeholder for a whole page (title and a few lines), laid out like the editor's own
 * loading state so that nothing moves when the real page replaces it.
 */
export function PageSkeleton(): JSX.Element {
  return (
    <div className="ui-page-skeleton" aria-busy="true">
      <div className="pe-skeleton-title" aria-hidden="true" />
      <SkeletonLines />
    </div>
  )
}

/** Placeholder for a block-sized area (an inline database, a view) whose code is still loading. */
export function BoxSkeleton({ className }: { className?: string }): JSX.Element {
  return (
    <div className={className ? `ui-box-skeleton ${className}` : 'ui-box-skeleton'} aria-busy="true">
      <SkeletonLines />
    </div>
  )
}
