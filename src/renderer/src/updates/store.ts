// The state of updates as this window knows it: the notice and Settings → General read it.
// Everything happens in the main process; this only holds its answers and passes on choices.
import { create } from 'zustand'
import type { UpdateStatus } from '@shared/updates'
import { notifyError } from '@/ui/toast'
import type { UpdateAction } from './labels'

export const useUpdates = create<{ status: UpdateStatus | null }>(() => ({ status: null }))

const accept = (status: UpdateStatus): void => useUpdates.setState({ status })

let started = false

/** Subscribes to the status. Reading it asks nothing of the network. */
export function initUpdates(): void {
  if (started) return
  started = true
  window.api.updates.onStatus(accept)
  window.api.updates
    .status()
    .then(accept)
    .catch((error) => console.error('could not read the update status', error))
}

/** Runs what the user chose in the notice or in Settings. */
export function runUpdateAction(action: UpdateAction): void {
  const api = window.api.updates
  const call =
    action === 'check'
      ? api.check().then(accept)
      : action === 'download'
        ? api.download()
        : action === 'restart'
          ? api.restart()
          : api.dismiss()
  call.catch((error: unknown) =>
    notifyError(
      error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong.',
      error
    )
  )
}
