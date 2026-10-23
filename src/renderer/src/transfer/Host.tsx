// Mount point for the import dialog. What it renders is fetched the first time an import starts.
import { Suspense, lazy, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useTransfer } from './gate'

const ImportDialog = lazy(() => import('./ImportDialog').then((module) => ({ default: module.ImportDialog })))

export function TransferHost(): JSX.Element | null {
  const open = useTransfer((state) => state.import.step !== 'closed')
  // Stays mounted once shown, so that closing and reopening never suspends again.
  const [wanted, setWanted] = useState(open)
  useEffect(() => {
    if (open) setWanted(true)
  }, [open])
  if (!open && !wanted) return null
  return (
    <Suspense fallback={null}>
      <ImportDialog />
    </Suspense>
  )
}
