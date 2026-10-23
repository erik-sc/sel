// The import dialog: what an import will make (before anything is written), how far it is while
// it is made, and, once made, opening it or undoing it. Loaded on demand through Host.tsx.
import type { JSX } from 'react'
import { openPage } from '@/store/tabs'
import { Button } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import { closeImport, confirmImport, undoLastImport, useTransfer, useTransferCopy } from './gate'
import './transfer.css'

const TITLE_ID = 'transfer-import-title'

export function ImportDialog(): JSX.Element {
  const state = useTransfer((s) => s.import)
  const copy = useTransferCopy()
  const busy = state.step === 'reading' || state.step === 'importing'

  let title = ''
  let body: JSX.Element | null = null
  let actions: JSX.Element | null = null
  switch (state.step) {
    case 'closed':
      break
    case 'reading':
      title = copy.previewTitle(state.format)
      body = (
        <p className="tr-lead" role="status">
          {copy.reading}
        </p>
      )
      break
    case 'preview':
      title = copy.previewTitle(state.preview.format)
      body = (
        <>
          <p className="tr-lead">{copy.previewLead(state.preview.source)}</p>
          <ul className="tr-counts">
            {copy.counts(state.preview.counts).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="tr-note">{copy.previewNote}</p>
        </>
      )
      actions = (
        <>
          <Button variant="ghost" onClick={closeImport}>
            {copy.cancel}
          </Button>
          <Button variant="primary" onClick={confirmImport}>
            {copy.importNow}
          </Button>
        </>
      )
      break
    case 'importing':
      title = copy.previewTitle(state.preview.format)
      body = (
        <>
          <p className="tr-lead" role="status">
            {copy.importing} {state.total > 0 ? copy.progress(state.done, state.total) : ''}
          </p>
          <progress className="tr-progress" max={state.total || 1} value={state.done} aria-label={copy.importing} />
        </>
      )
      break
    case 'done':
      title = copy.doneTitle
      body = (
        <>
          <p className="tr-lead" role="status">
            {state.undone ? copy.undone : copy.doneLead(state.result.counts)}
          </p>
          {!state.undone && (
            <ul className="tr-counts">
              {copy.counts(state.result.counts).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </>
      )
      actions = state.undone ? (
        <Button variant="primary" onClick={closeImport}>
          {copy.close}
        </Button>
      ) : (
        <>
          <Button variant="ghost" onClick={undoLastImport}>
            {copy.undo}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              openPage(state.result.pageId)
              closeImport()
            }}
          >
            {copy.openPage}
          </Button>
        </>
      )
      break
    case 'error':
      title = copy.previewTitle(state.format)
      body = (
        <p className="tr-lead is-error" role="alert">
          {state.message}
        </p>
      )
      actions = (
        <Button variant="primary" onClick={closeImport}>
          {copy.close}
        </Button>
      )
      break
  }

  return (
    <Modal open={state.step !== 'closed'} onClose={busy ? () => undefined : closeImport} labelledBy={TITLE_ID} className="tr-dialog">
      <h2 id={TITLE_ID} className="tr-title">
        {title}
      </h2>
      {body}
      {actions && <div className="tr-actions">{actions}</div>}
    </Modal>
  )
}
