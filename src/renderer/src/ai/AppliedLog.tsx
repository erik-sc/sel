// The log of what the AI applied, as a list: when, the question, what was done, the pages it
// changed, and "Undo all of this". Shown in the balloon and in Settings → AI; the proposal card
// of an answer uses the same undo button.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { AppliedEntry } from '@shared/aiHistory'
import { useHome } from '@/home/store'
import { openPage } from '@/store/tabs'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'
import { checkUndo, loadAppliedLog, undoAppliedEntry, useAppliedLog } from './appliedStore'
import { usePersona } from '@/herman/gate'
import { balloonCopy, whenText } from './balloonCopy'
import './ai.css'

/** Lines of what was done shown before "+N". */
const SHOWN_LINES = 4

/**
 * "Undo all of this" for one entry of the log. When blocks it would write were changed since,
 * the first press says so and the second ("Undo anyway") undoes.
 */
export function UndoControls({ id, onUndone }: { id: string; onUndone?: () => void }): JSX.Element {
  const copy = balloonCopy(
    useHome((state) => state.locale),
    usePersona().persona
  )
  const [changed, setChanged] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const undo = (force: boolean): void => {
    setBusy(true)
    const run = async (): Promise<void> => {
      if (!force) {
        const since = await checkUndo(id)
        if (since.length) {
          setChanged(since.length)
          return
        }
      }
      await undoAppliedEntry(id)
      toast(copy.undoneToast, { kind: 'success', duration: 1600 })
      onUndone?.()
    }
    run()
      .catch((error: unknown) => notifyError(copy.undoFailed, error))
      .finally(() => setBusy(false))
  }
  return (
    <div className="ai-undo">
      {changed !== null && (
        <p className="ai-undo-warning" role="alert">
          {copy.changedSince(changed)}
        </p>
      )}
      <div className="ai-undo-buttons">
        <Button disabled={busy} onClick={() => undo(changed !== null)}>
          {changed !== null ? copy.undoAnyway : copy.undoAll}
        </Button>
        {changed !== null && (
          <Button variant="ghost" disabled={busy} onClick={() => setChanged(null)}>
            {copy.cancel}
          </Button>
        )}
      </div>
    </div>
  )
}

function Entry({ entry, onOpenPage }: { entry: AppliedEntry; onOpenPage?: () => void }): JSX.Element {
  const locale = useHome((state) => state.locale)
  const copy = balloonCopy(locale, usePersona().persona)
  const extra = entry.done.length - SHOWN_LINES
  return (
    <li className={entry.undoneAt ? 'ai-log-entry is-undone' : 'ai-log-entry'}>
      <p className="ai-log-head">
        <span className="ai-log-request">{entry.request || copy.applied}</span>
        <span className="ai-log-when">{whenText(entry.at, Date.now(), locale)}</span>
      </p>
      <ul className="ai-log-lines">
        {entry.done.slice(0, SHOWN_LINES).map((line, index) => (
          <li key={index}>{line}</li>
        ))}
        {extra > 0 && <li className="is-more">+{extra}</li>}
      </ul>
      {entry.pages.length > 0 && (
        <p className="ai-log-pages">
          <span>{copy.logPages}: </span>
          {entry.pages.map((page, index) => (
            <span key={page.id}>
              {index > 0 && ', '}
              <button
                type="button"
                className="ai-log-page"
                onClick={() => {
                  openPage(page.id)
                  onOpenPage?.()
                }}
              >
                {page.title}
              </button>
            </span>
          ))}
        </p>
      )}
      {entry.undoneAt ? (
        <p className="ai-log-state">{copy.undone}</p>
      ) : entry.undo ? (
        <UndoControls id={entry.id} />
      ) : (
        <p className="ai-log-state">{copy.tooLargeToUndo}</p>
      )}
    </li>
  )
}

export function AppliedLog({ onOpenPage }: { onOpenPage?: () => void }): JSX.Element {
  const copy = balloonCopy(
    useHome((state) => state.locale),
    usePersona().persona
  )
  const entries = useAppliedLog((state) => state.entries)
  const loaded = useAppliedLog((state) => state.loaded)
  useEffect(() => {
    void loadAppliedLog()
  }, [])
  if (!loaded) return <p className="ai-log-empty" aria-busy="true" />
  if (!entries.length) return <p className="ai-log-empty">{copy.logEmpty}</p>
  return (
    <ul className="ai-log">
      {entries.map((entry) => (
        <Entry key={entry.id} entry={entry} onOpenPage={onOpenPage} />
      ))}
    </ul>
  )
}
