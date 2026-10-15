// The foot of the Tasks screen's list column: importing a Todoist export, and the system-wide
// quick-add shortcut (off unless turned on here; the keys are the main process's to register).
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { formatAccelerator } from '@shared/shortcuts'
import type { GlobalShortcutState } from '@shared/tasks/api'
import { notifyError, toast } from '@/ui/toast'

function ImportTodoist(): JSX.Element {
  const [busy, setBusy] = useState(false)
  const run = (): void => {
    setBusy(true)
    window.api.tasks
      .importTodoist()
      .then((result) => {
        if (!result.imported) return
        if (!result.tasks) toast('No tasks were found in that file. Is it a Todoist CSV export?')
        else toast(`Imported ${result.tasks} task${result.tasks === 1 ? '' : 's'} into ${result.projects.map((name) => `#${name}`).join(', ')}.`)
      })
      .catch((error: unknown) => notifyError('Could not import from Todoist.', error))
      .finally(() => setBusy(false))
  }
  return (
    <button type="button" className="tasks-nav-item" onClick={run} disabled={busy}>
      <span className="tasks-nav-name">{busy ? 'Importing…' : 'Import from Todoist…'}</span>
    </button>
  )
}

function GlobalShortcut(): JSX.Element | null {
  const [state, setState] = useState<GlobalShortcutState | null>(null)
  const [keys, setKeys] = useState('')
  useEffect(() => {
    let alive = true
    window.api.tasks
      .globalShortcut()
      .then((current) => {
        if (!alive) return
        setState(current)
        setKeys(current.accelerator)
      })
      .catch((error: unknown) => console.error('could not read the quick-add shortcut', error))
    return () => {
      alive = false
    }
  }, [])
  if (!state) return null

  const save = (enabled: boolean, accelerator: string): void => {
    window.api.tasks
      .setGlobalShortcut({ enabled, accelerator })
      .then((next) => {
        setState(next)
        setKeys(next.accelerator)
        if (next.enabled && !next.registered) toast('Another program already uses those keys. Try another combination.', { kind: 'error' })
      })
      .catch((error: unknown) => {
        setKeys(state.accelerator)
        notifyError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not change the shortcut.', error)
      })
  }

  return (
    <div className="tasks-shortcut">
      <label className="tasks-shortcut-toggle">
        <input type="checkbox" checked={state.enabled} onChange={(event) => save(event.target.checked, state.accelerator)} />
        <span>Quick add from anywhere</span>
      </label>
      <input
        className="tasks-shortcut-keys"
        value={keys}
        aria-label="Keys of the quick-add shortcut"
        spellCheck={false}
        onChange={(event) => setKeys(event.target.value)}
        onBlur={() => keys !== state.accelerator && save(state.enabled, keys)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <span className="tasks-shortcut-note">
        {state.enabled ? (state.registered ? `Press ${formatAccelerator(state.accelerator, window.api.app.platform === 'darwin')} in any program.` : 'Those keys are taken.') : 'Off. Opens a small window to add a task.'}
      </span>
    </div>
  )
}

export function TasksTools(): JSX.Element {
  return (
    <section className="tasks-nav-section tasks-tools">
      <h3 className="tasks-nav-title">Tools</h3>
      <ImportTodoist />
      <GlobalShortcut />
    </section>
  )
}
