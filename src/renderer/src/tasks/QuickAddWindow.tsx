// The small always-on-top window the system-wide shortcut opens: the quick-add input and nothing
// else. A task typed here goes to the Inbox (or wherever its #project says); the window closes
// once the task is stored, on Escape, and when it loses focus.
import { StrictMode, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import * as L from '@/database/logic'
import { useResolvedDatabase } from '@/database/resolved'
import { RootBoundary } from '@/failures/RootBoundary'
import { QuickAdd } from './QuickAdd'
import './tasks.css'

const close = (): void => window.api.app.window.close()

/** Waits until the main process has the row (the write is optimistic here), then closes. */
async function closeWhenStored(id: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      if (await window.api.blocks.get(id)) break
    } catch {
      // Not there yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  close()
}

function QuickAddWindow(): JSX.Element {
  const resolved = useResolvedDatabase(TASKS_DATABASE_ID, false)
  const { schema } = useMemo(() => L.normalizeResolved(resolved), [resolved])
  const [today] = useState(() => L.todayISO())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onBlur = (): void => {
      if (!saving) close()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [saving])

  return (
    <div className="qa-window">
      {resolved?.status === 'ok' ? (
        <QuickAdd
          list={{ kind: 'inbox' }}
          today={today}
          projects={L.optionsOf(L.propOf(schema, TASK_PROPS.project))}
          labels={L.optionsOf(L.propOf(schema, TASK_PROPS.labels))}
          autoFocus
          onAdded={(id) => {
            setSaving(true)
            void closeWhenStored(id)
          }}
          onCancel={close}
        />
      ) : (
        <p className="qa-window-note">
          {resolved?.status === 'loading' || !resolved ? 'Opening Tasks…' : 'The Tasks database could not be opened.'}
        </p>
      )}
    </div>
  )
}

export function mountQuickAddWindow(): void {
  document.title = 'Add a task'
  document.body.classList.add('is-quick-add')
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) close()
  })
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RootBoundary>
        <QuickAddWindow />
      </RootBoundary>
    </StrictMode>
  )
}
