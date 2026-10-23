// The lock that says a page, a database or a project is private from the AI: on its row in the
// sidebar, by its title, in the Tasks list of projects. It says why on hover and to screen readers.
import type { JSX } from 'react'
import { useHome } from '@/home/store'
import { Lock } from '@/ui/icons'
import { CONTEXT_COPY } from './contextCopy'
import { useAiPrivacy } from './privacy'

/** The lock for a page or database (and what is under one), or nothing when it is not private. */
export function PrivateLock({
  id,
  withLabel = false,
  className
}: {
  id: string
  withLabel?: boolean
  className?: string
}): JSX.Element | null {
  const privacy = useAiPrivacy(id)
  const locale = useHome((state) => state.locale)
  if (!privacy) return null
  const copy = CONTEXT_COPY[locale]
  return <LockMark why={copy.privateWhy[privacy.reason]} label={withLabel ? copy.private : null} className={className} />
}

export function LockMark({ why, label, className }: { why: string; label?: string | null; className?: string }): JSX.Element {
  return (
    <span className={className ? `ai-lock ${className}` : 'ai-lock'} title={why} role="img" aria-label={why}>
      <Lock size={12} />
      {label && <span className="ai-lock-label">{label}</span>}
    </span>
  )
}
