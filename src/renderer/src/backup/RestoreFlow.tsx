import { useEffect, useId, useState } from 'react'
import type { BackupComparison, BackupEntry, BackupStatus, PageChange, PageDifference, RestoreSource } from '@shared/data'
import { backupWhen, byteSize } from '@shared/dataCopy'
import { loadTree } from '@/store/blocks'
import { openPage } from '@/store/tabs'
import { refreshTree } from '@/store/tree'
import { Button, IconButton } from '@/ui/Button'
import { IconGlyph } from '@/ui/IconGlyph'
import { Close } from '@/ui/icons'
import { Modal } from '@/ui/Modal'
import { useDataCopy } from './locale'
import { RESTORE_COPY, type RestoreCopy } from './restoreCopy'
import './restore.css'

/**
 * The guided restore of Settings → General → Data: choose a backup, see what differs from now
 * (pages deleted, changed and made since, by title), then bring back one page (with the pages
 * below it, if wanted) or everything. Restoring one page touches nothing else and happens at
 * once; restoring everything asks to confirm here, in the sheet, and restarts sel. Either way
 * the main process backs up everything as it is now first (main/data/register.ts).
 */
export function RestoreRow({ status }: { status: BackupStatus | null }) {
  const { copy, locale } = useDataCopy()
  const words = RESTORE_COPY[locale]
  const [open, setOpen] = useState(false)
  const damaged = status?.integrity === 'damaged'
  return (
    <div className="ap-row">
      <div className="ap-row-text">
        <span className="ap-row-label">{copy.restore}</span>
        <span className={damaged ? 'ap-row-help is-error' : 'ap-row-help'}>{damaged ? words.damagedHelp : copy.restoreHelp}</span>
      </div>
      <div className="ap-row-control">
        <Button variant={damaged ? 'primary' : 'default'} onClick={() => setOpen(true)}>
          {copy.chooseBackup}
        </Button>
      </div>
      <RestoreSheet open={open} onClose={() => setOpen(false)} backups={status?.backups ?? []} />
    </div>
  )
}

type View =
  | { view: 'choose'; error: string | null }
  | { view: 'comparing'; at: number }
  | { view: 'compared'; comparison: BackupComparison }

/** What is going on with the page chosen in the list. */
type PageState = { id: string; withSubpages: boolean; state: 'asking' | 'busy' } | { id: string; state: 'error'; message: string }

export function RestoreSheet({ open, onClose, backups }: { open: boolean; onClose: () => void; backups: readonly BackupEntry[] }) {
  const titleId = useId()
  const { copy, locale } = useDataCopy()
  const words = RESTORE_COPY[locale]
  const [view, setView] = useState<View>({ view: 'choose', error: null })
  const [page, setPage] = useState<PageState | null>(null)
  /** The last page brought back: said above the list, which is compared again without it. */
  const [done, setDone] = useState<{ pageId: string; message: string; notes: string[] } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [all, setAll] = useState<{ state: 'idle' | 'busy' | 'restarting' } | { state: 'error'; message: string }>({ state: 'idle' })
  const [synced, setSynced] = useState(false)

  useEffect(() => {
    if (!open) return
    setView({ view: 'choose', error: null })
    setPage(null)
    setDone(null)
    setConfirming(false)
    setAll({ state: 'idle' })
    window.api.app
      .getSetting<unknown>('sync.remoteUrl')
      .then((url) => setSynced(typeof url === 'string' && url.length > 0))
      .catch(() => setSynced(false))
  }, [open])

  const when = (at: number): string => backupWhen(at, Date.now(), locale)

  const compare = (source: RestoreSource, at: number): void => {
    setView({ view: 'comparing', at })
    setPage(null)
    setDone(null)
    setConfirming(false)
    window.api.data
      .compare(source)
      .then((result) => {
        if (result.outcome === 'compared') setView({ view: 'compared', comparison: result.comparison })
        else setView({ view: 'choose', error: copy.fileProblem[result.problem] })
      })
      .catch(() => setView({ view: 'choose', error: copy.somethingWrong }))
  }

  const pickFile = (): void => {
    window.api.data
      .pickFile()
      .then((result) => {
        if (result.outcome === 'picked') compare(result.source, result.at)
        else if (result.outcome === 'invalid') setView({ view: 'choose', error: copy.fileProblem[result.problem] })
      })
      .catch(() => setView({ view: 'choose', error: copy.somethingWrong }))
  }

  const restorePage = (comparison: BackupComparison, item: PageDifference, withSubpages: boolean): void => {
    setPage({ id: item.id, withSubpages, state: 'busy' })
    window.api.data
      .restorePage(comparison.source, item.id, withSubpages)
      .then(async (result) => {
        if (result.outcome === 'restored') {
          await loadTree(result.pageId).catch(() => undefined)
          await refreshTree().catch(() => undefined)
          setPage(null)
          setDone({
            pageId: result.pageId,
            message: words.restored(result.title || words.untitled, result.pages),
            notes: result.notes.slice(0, 2)
          })
          // What differs now, so that "Restore everything" says what it would still change.
          const again = await window.api.data.compare(comparison.source).catch(() => null)
          if (again?.outcome === 'compared') setView({ view: 'compared', comparison: again.comparison })
        } else {
          const message = result.outcome === 'refused' ? words.refusal[result.problem] : copy.fileProblem[result.problem]
          setPage({ id: item.id, state: 'error', message })
        }
      })
      .catch(() => setPage({ id: item.id, state: 'error', message: copy.somethingWrong }))
  }

  const restoreAll = (comparison: BackupComparison): void => {
    setAll({ state: 'busy' })
    window.api.data
      .restoreAll(comparison.source)
      .then((result) => {
        if (result.outcome === 'restarting') setAll({ state: 'restarting' })
        else if (result.outcome === 'refused') setAll({ state: 'error', message: words.refusal[result.problem] })
        else setAll({ state: 'error', message: copy.fileProblem[result.problem] })
      })
      .catch(() => setAll({ state: 'error', message: copy.somethingWrong }))
  }

  const busy = all.state === 'busy' || all.state === 'restarting' || page?.state === 'busy'

  return (
    <Modal open={open} onClose={() => (busy ? undefined : onClose())} labelledBy={titleId} className="restore-sheet">
      <header className="restore-head">
        <h2 id={titleId}>{words.title}</h2>
        <IconButton label={words.close} tooltip={false} disabled={busy} onClick={onClose}>
          <Close />
        </IconButton>
      </header>
      {view.view === 'choose' && (
        <div className="restore-body">
          <p className="restore-intro">{backups.length ? words.chooseIntro : words.noBackups}</p>
          {view.error && (
            <p className="restore-error" role="alert">
              {view.error}
            </p>
          )}
          {backups.length > 0 && (
            <ul className="restore-backups">
              {backups.map((backup) => (
                <li key={backup.name}>
                  <button type="button" className="restore-backup" onClick={() => compare(backup.name, backup.at)}>
                    <span className="restore-backup-when">{when(backup.at)}</span>
                    <span className="restore-backup-meta">
                      {words.kind[backup.kind]} · {byteSize(backup.size, locale)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="restore-actions">
            <Button variant="ghost" onClick={pickFile}>
              {words.anotherFile}
            </Button>
          </div>
        </div>
      )}
      {view.view === 'comparing' && (
        <div className="restore-body">
          <p className="restore-intro" role="status">
            {words.comparing}
          </p>
        </div>
      )}
      {view.view === 'compared' && (
        <Compared
          comparison={view.comparison}
          words={words}
          when={when(view.comparison.at)}
          page={page}
          setPage={setPage}
          done={done}
          busy={busy}
          onBack={() => setView({ view: 'choose', error: null })}
          onRestorePage={(item, withSubpages) => restorePage(view.comparison, item, withSubpages)}
          onOpenPage={(pageId) => {
            openPage(pageId)
            onClose()
          }}
          confirming={confirming}
          setConfirming={setConfirming}
          synced={synced}
          all={all}
          onRestoreAll={() => restoreAll(view.comparison)}
        />
      )}
    </Modal>
  )
}

const GROUPS: readonly PageChange[] = ['only-backup', 'changed', 'only-now']

function Compared({
  comparison,
  words,
  when,
  page,
  setPage,
  done,
  busy,
  onBack,
  onRestorePage,
  onOpenPage,
  confirming,
  setConfirming,
  synced,
  all,
  onRestoreAll
}: {
  comparison: BackupComparison
  words: RestoreCopy
  when: string
  page: PageState | null
  setPage: (page: PageState | null) => void
  done: { pageId: string; message: string; notes: string[] } | null
  busy: boolean
  onBack: () => void
  onRestorePage: (item: PageDifference, withSubpages: boolean) => void
  onOpenPage: (pageId: string) => void
  confirming: boolean
  setConfirming: (on: boolean) => void
  synced: boolean
  all: { state: 'idle' | 'busy' | 'restarting' } | { state: 'error'; message: string }
  onRestoreAll: () => void
}) {
  const { counts } = comparison
  const differs = counts['only-backup'] + counts.changed + counts['only-now'] > 0
  return (
    <div className="restore-body">
      <div className="restore-summary">
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          ← {words.back}
        </Button>
        <span className="restore-summary-text">{words.backupOf(when, comparison.pages)}</span>
      </div>
      {done && (
        <div className="restore-done" role="status">
          <p>{done.message}</p>
          {done.notes.map((note) => (
            <p key={note} className="restore-group-help">
              {note}
            </p>
          ))}
          <div className="restore-actions">
            <Button onClick={() => onOpenPage(done.pageId)}>{words.openPage}</Button>
          </div>
        </div>
      )}
      {!differs && <p className="restore-intro">{words.nothingDiffers}</p>}
      {GROUPS.map((change) => {
        const items = comparison.differences.filter((d) => d.change === change)
        if (!counts[change]) return null
        return (
          <section key={change} className="restore-group" aria-label={words.group[change](counts[change])}>
            <h3 className="restore-group-title">{words.group[change](counts[change])}</h3>
            <p className="restore-group-help">{words.groupHelp[change]}</p>
            <ul className="restore-pages">
              {items.map((item) => (
                <PageItem
                  key={item.id}
                  item={item}
                  words={words}
                  page={page?.id === item.id ? page : null}
                  setPage={setPage}
                  busy={busy}
                  onRestore={onRestorePage}
                />
              ))}
            </ul>
            {counts[change] > items.length && <p className="restore-group-help">{words.more(counts[change] - items.length)}</p>}
          </section>
        )
      })}
      {differs && (
        <div className="restore-all">
          {!confirming ? (
            <div className="restore-all-row">
              <span className="restore-group-help">{words.restoreAllHelp}</span>
              <Button disabled={busy} onClick={() => setConfirming(true)}>
                {words.restoreAll}
              </Button>
            </div>
          ) : (
            <div className="restore-confirm" role="group" aria-label={words.confirmTitle(when)}>
              <p className="restore-confirm-title">{words.confirmTitle(when)}</p>
              <p>{words.confirmBody({ back: counts['only-backup'], changed: counts.changed, gone: counts['only-now'] })}</p>
              <p>{words.confirmSafety}</p>
              {synced && <p>{words.syncNote}</p>}
              {all.state === 'error' && (
                <p className="restore-error" role="alert">
                  {all.message}
                </p>
              )}
              <div className="restore-actions">
                <Button disabled={all.state === 'busy' || all.state === 'restarting'} onClick={() => setConfirming(false)}>
                  {words.cancel}
                </Button>
                <Button variant="danger" disabled={busy} onClick={onRestoreAll}>
                  {all.state === 'restarting' || all.state === 'busy' ? words.restarting : words.confirmAll}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PageItem({
  item,
  words,
  page,
  setPage,
  busy,
  onRestore
}: {
  item: PageDifference
  words: RestoreCopy
  page: PageState | null
  setPage: (page: PageState | null) => void
  busy: boolean
  onRestore: (item: PageDifference, withSubpages: boolean) => void
}) {
  const title = item.title || words.untitled
  const restorable = item.change !== 'only-now'
  const asking = page && (page.state === 'asking' || page.state === 'busy') ? page : null
  return (
    <li className="restore-page">
      <div className="restore-page-row">
        <span className="restore-page-icon" aria-hidden="true">
          {item.icon ? <IconGlyph icon={item.icon} /> : null}
        </span>
        <span className="restore-page-text">
          <span className="restore-page-title">{title}</span>
          {item.path.length > 0 && <span className="restore-page-path">{item.path.map((p) => p || words.untitled).join(' / ')}</span>}
        </span>
        {restorable && !asking && (
          <Button variant="ghost" disabled={busy} onClick={() => setPage({ id: item.id, withSubpages: false, state: 'asking' })}>
            {words.restoreThis}
          </Button>
        )}
      </div>
      {asking && (
        <div className="restore-page-ask">
          <p className="restore-group-help">{words.onePageNote}</p>
          {item.subpages > 0 && (
            <label className="restore-check">
              <input
                type="checkbox"
                checked={asking.withSubpages}
                disabled={asking.state === 'busy'}
                onChange={(event) => setPage({ ...asking, withSubpages: event.target.checked })}
              />
              {words.withSubpages(item.subpages)}
            </label>
          )}
          <div className="restore-actions">
            <Button disabled={asking.state === 'busy'} onClick={() => setPage(null)}>
              {words.cancel}
            </Button>
            <Button variant="primary" disabled={asking.state === 'busy'} onClick={() => onRestore(item, asking.withSubpages)}>
              {asking.state === 'busy' ? words.restoringPage : words.restorePage}
            </Button>
          </div>
        </div>
      )}
      {page?.state === 'error' && (
        <p className="restore-error" role="alert">
          {page.message}
        </p>
      )}
    </li>
  )
}
