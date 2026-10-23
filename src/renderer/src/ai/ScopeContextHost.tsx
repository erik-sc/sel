// Mount point of the editor of a project's or database's own context (0.8.0 A4): fetched the
// first time it is opened; nothing of it is in the start-up bundle.
import { Suspense, lazy, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useScopeEditor } from './scopeContext'

const ScopeContextDialog = lazy(() => import('./ScopeContextDialog').then((module) => ({ default: module.ScopeContextDialog })))

export function ScopeContextHost(): JSX.Element | null {
  const open = useScopeEditor((state) => state.target !== null)
  // Stays mounted once shown, so that closing and reopening never suspends again.
  const [wanted, setWanted] = useState(open)
  useEffect(() => {
    if (open) setWanted(true)
  }, [open])
  if (!open && !wanted) return null
  return (
    <Suspense fallback={null}>
      <ScopeContextDialog />
    </Suspense>
  )
}
