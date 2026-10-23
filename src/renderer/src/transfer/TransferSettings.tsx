import { useState } from 'react'
import { Button } from '@/ui/Button'
import { chooseImport, exportZip, useTransfer, useTransferCopy } from './gate'

/**
 * Rows of Settings → General → Data: importing from Notion or Obsidian (the dialog of Host.tsx
 * shows what comes in before it does) and exporting everything as a zip.
 */
export function TransferSettingsRows() {
  const copy = useTransferCopy()
  const importing = useTransfer((s) => s.import.step === 'reading' || s.import.step === 'importing')
  const exporting = useTransfer((s) => s.exporting)
  const [exported, setExported] = useState<
    { state: 'idle' | 'failed' } | { state: 'done'; pages: number; databases: number; images: number }
  >({
    state: 'idle'
  })

  const saveZip = (): void => {
    setExported({ state: 'idle' })
    exportZip(null).then(
      (saved) => setExported(saved ? { state: 'done', ...saved } : { state: 'idle' }),
      (error: unknown) => {
        window.api.app.log('The zip export failed', error)
        setExported({ state: 'failed' })
      }
    )
  }

  return (
    <>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.importTitle}</span>
          <span className="ap-row-help">{copy.importHelp}</span>
        </div>
        <div className="ap-row-control data-actions">
          <Button disabled={importing} onClick={() => chooseImport('notion')}>
            {copy.fromNotion}
          </Button>
          <Button disabled={importing} onClick={() => chooseImport('obsidian')}>
            {copy.fromObsidian}
          </Button>
        </div>
      </div>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.zipTitle}</span>
          <span className={exported.state === 'failed' ? 'ap-row-help is-error' : 'ap-row-help'}>
            {exported.state === 'failed'
              ? copy.failed
              : exported.state === 'done'
                ? copy.exported(exported.pages, exported.databases, exported.images)
                : copy.zipHelp}
          </span>
        </div>
        <div className="ap-row-control">
          <Button disabled={!!exporting} onClick={saveZip}>
            {exporting
              ? exporting.total
                ? `${copy.exporting} ${copy.progress(exporting.done, exporting.total)}`
                : copy.exporting
              : copy.exportZip}
          </Button>
        </div>
      </div>
    </>
  )
}
