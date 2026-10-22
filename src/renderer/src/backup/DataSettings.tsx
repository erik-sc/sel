import { useEffect, useState } from 'react'
import type { BackupStatus } from '@shared/data'
import { Button } from '@/ui/Button'
import { describeBackups } from './describe'
import { useDataCopy } from './locale'
import './data.css'

type Busy = 'idle' | 'busy' | 'failed'

/**
 * Rows of Settings → General → Data: the backups sel keeps on this computer, restoring one, and
 * the whole workspace as Markdown, and the folder of the local log. The main process does all of it, with native dialogs.
 */
export function DataSettingsRows() {
  const { copy, locale } = useDataCopy()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [backing, setBacking] = useState<Busy>('idle')
  const [logs, setLogs] = useState<'idle' | 'failed'>('idle')
  const [restore, setRestore] = useState<{ state: 'idle' | 'busy' | 'restarting' } | { state: 'error'; message: string }>({ state: 'idle' })
  const [exported, setExported] = useState<{ state: 'idle' | 'busy' | 'failed' } | { state: 'done'; pages: number; images: number }>({
    state: 'idle'
  })

  useEffect(() => {
    let live = true
    window.api.data
      .status()
      .then((next) => live && setStatus(next))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const backUp = (): void => {
    setBacking('busy')
    window.api.data
      .backUp()
      .then((next) => {
        setStatus(next)
        setBacking('idle')
      })
      .catch(() => setBacking('failed'))
  }

  const chooseBackup = (): void => {
    setRestore({ state: 'busy' })
    window.api.data
      .restore()
      .then((result) => {
        if (result.outcome === 'restarting') setRestore({ state: 'restarting' })
        else if (result.outcome === 'invalid') setRestore({ state: 'error', message: copy.fileProblem[result.problem] })
        else setRestore({ state: 'idle' })
      })
      .catch(() => setRestore({ state: 'error', message: copy.somethingWrong }))
  }

  const exportAll = (): void => {
    setExported({ state: 'busy' })
    window.api.data
      .exportMarkdown()
      .then((result) =>
        setExported(result.saved ? { state: 'done', pages: result.pages ?? 0, images: result.images ?? 0 } : { state: 'idle' })
      )
      .catch(() => setExported({ state: 'failed' }))
  }

  const openLogs = (): void => {
    setLogs('idle')
    window.api.data.openLogs().catch(() => setLogs('failed'))
  }

  const line = status ? describeBackups(status, Date.now(), locale) : null
  const backupProblem = backing === 'failed' ? copy.somethingWrong : (line?.problem ?? null)

  return (
    <>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.backups}</span>
          <span className="ap-row-help">{line?.help ?? ''}</span>
          {backupProblem && <span className="ap-row-help is-error">{backupProblem}</span>}
        </div>
        <div className="ap-row-control data-actions">
          <Button variant="ghost" onClick={() => void window.api.data.showBackups().catch(() => undefined)}>
            {copy.showFolder}
          </Button>
          <Button disabled={backing === 'busy'} onClick={backUp}>
            {backing === 'busy' ? copy.backingUp : copy.backUpNow}
          </Button>
        </div>
      </div>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.restore}</span>
          <span className={restore.state === 'error' ? 'ap-row-help is-error' : 'ap-row-help'}>
            {restore.state === 'error' ? restore.message : copy.restoreHelp}
          </span>
        </div>
        <div className="ap-row-control">
          <Button disabled={restore.state === 'busy' || restore.state === 'restarting'} onClick={chooseBackup}>
            {restore.state === 'restarting' ? copy.restarting : copy.chooseBackup}
          </Button>
        </div>
      </div>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.exportAll}</span>
          <span className={exported.state === 'failed' ? 'ap-row-help is-error' : 'ap-row-help'}>
            {exported.state === 'failed'
              ? copy.somethingWrong
              : exported.state === 'done'
                ? copy.exported(exported.pages, exported.images)
                : copy.exportHelp}
          </span>
        </div>
        <div className="ap-row-control">
          <Button disabled={exported.state === 'busy'} onClick={exportAll}>
            {exported.state === 'busy' ? copy.exporting : copy.chooseFolder}
          </Button>
        </div>
      </div>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.logs}</span>
          <span className={logs === 'failed' ? 'ap-row-help is-error' : 'ap-row-help'}>
            {logs === 'failed' ? copy.somethingWrong : copy.logsHelp}
          </span>
        </div>
        <div className="ap-row-control">
          <Button variant="ghost" onClick={openLogs}>
            {copy.openLogs}
          </Button>
        </div>
      </div>
    </>
  )
}
