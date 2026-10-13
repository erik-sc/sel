// The version history window itself. Loaded on demand through VersionHistory.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, ReactNode } from 'react'
import { HISTORY_DEFAULTS, MAX_VERSION_LABEL, type VersionInfo, type VersionSnapshot } from '@shared/versions'
import { useBlock } from '@/store/blocks'
import { setHistoryPage, useUi } from '@/store/ui'
import { usePageTitle } from '@/shell/linked'
import { Button, IconButton } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import { Clock, Close, Trash, Type } from '@/ui/icons'
import { notifyError, toast } from '@/ui/toast'
import '@/editor/editor.css'
import { restoreVersion, restoreVersionAsCopy } from './actions'
import { diffSnapshots, summarize, type TreeDiff } from './diff'
import { countLabel, groupByDay, kindLabel, kindTone, stampLabel, timeLabel } from './format'
import { SnapshotView } from './ReadOnlyBlocks'
import './versions.css'

/** Remembered while the app runs: someone who turned the marks off wants them off next time too. */
let showChangesPreference = true

/** How long a burst of change events is left to settle before the timeline is read again. */
const RELOAD_DELAY_MS = 250

/** The sentence an ipc rejection carries, without Electron's wrapping. */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const index = message.lastIndexOf('Error: ')
  return (index >= 0 ? message.slice(index + 'Error: '.length) : message).trim()
}

function fail(what: string, error: unknown): void {
  const why = reason(error)
  // Domain errors are sentences meant for the user; anything else is "Something went wrong".
  notifyError(why && why !== 'Something went wrong' ? `${what} ${why}` : what, error)
}

export function VersionHistoryDialog(): JSX.Element {
  const pageId = useUi((state) => state.historyPageId)
  return (
    <Modal open={!!pageId} onClose={() => setHistoryPage(null)} label="Version history" className="vh">
      {pageId && <HistoryBody key={pageId} pageId={pageId} />}
    </Modal>
  )
}

type Sheet = { kind: 'restore' } | { kind: 'delete'; version: VersionInfo } | { kind: 'save' } | null
type Shown = { id: string; snapshot: VersionSnapshot } | { id: string; error: string } | null

function HistoryBody({ pageId }: { pageId: string }): JSX.Element {
  const page = useBlock(pageId)
  const title = usePageTitle(page)
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [damaged, setDamaged] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [current, setCurrent] = useState<VersionSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [shown, setShown] = useState<Shown>(null)
  const [showChanges, setShowChanges] = useState(showChangesPreference)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [busy, setBusy] = useState(false)
  const [policy, setPolicy] = useState({ enabled: HISTORY_DEFAULTS.enabled, minutes: HISTORY_DEFAULTS.sessionMinutes })
  const [now, setNow] = useState(() => Date.now())
  const listRef = useRef<HTMLDivElement>(null)
  const cache = useRef(new Map<string, VersionSnapshot>())
  const alive = useRef(true)

  const reload = useCallback(
    async (select?: string): Promise<void> => {
      try {
        const [list, stats, live] = await Promise.all([
          window.api.versions.list(pageId),
          window.api.versions.stats(pageId),
          window.api.versions.current(pageId).catch(() => null)
        ])
        if (!alive.current) return
        setNow(Date.now())
        setVersions(list)
        setDamaged(stats.damaged)
        setCurrent(live)
        setLoadFailed(false)
        setSelectedId((previous) => {
          if (select && list.some((v) => v.id === select)) return select
          return previous && list.some((v) => v.id === previous) ? previous : (list[0]?.id ?? null)
        })
      } catch (error) {
        console.error('version history failed to load', error)
        if (alive.current) setLoadFailed(true)
      }
    },
    [pageId]
  )

  useEffect(() => {
    alive.current = true
    void reload()
    Promise.all([window.api.app.getSetting<boolean>('history.enabled'), window.api.app.getSetting<number>('history.sessionMinutes')])
      .then(([enabled, minutes]) => {
        if (!alive.current) return
        setPolicy({
          enabled: typeof enabled === 'boolean' ? enabled : HISTORY_DEFAULTS.enabled,
          minutes: typeof minutes === 'number' ? minutes : HISTORY_DEFAULTS.sessionMinutes
        })
      })
      .catch(() => undefined)
    // Edits made elsewhere (another window, a write still on its way) change both sides of the comparison.
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void reload(), RELOAD_DELAY_MS)
    })
    return () => {
      alive.current = false
      off()
      if (timer) clearTimeout(timer)
    }
  }, [reload])

  // The timeline takes the keyboard as soon as there is one.
  const hasVersions = !!versions?.length
  useEffect(() => {
    if (hasVersions) listRef.current?.focus({ preventScroll: true })
  }, [hasVersions])

  useEffect(() => {
    if (!selectedId) {
      setShown(null)
      return
    }
    const cached = cache.current.get(selectedId)
    if (cached) {
      setShown({ id: selectedId, snapshot: cached })
      return
    }
    let wanted = true
    window.api.versions
      .get(selectedId)
      .then((snapshot) => {
        cache.current.set(selectedId, snapshot)
        if (wanted) setShown({ id: selectedId, snapshot })
      })
      .catch((error) => {
        console.error('version failed to load', error)
        if (wanted) setShown({ id: selectedId, error: reason(error) || 'This version could not be read' })
      })
    return () => {
      wanted = false
    }
  }, [selectedId])

  useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector(`[data-version="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const selected = versions?.find((v) => v.id === selectedId) ?? null
  const snapshot = shown && shown.id === selectedId && 'snapshot' in shown ? shown.snapshot : null
  const error = shown && shown.id === selectedId && 'error' in shown ? shown.error : null
  const diff = useMemo<TreeDiff | null>(() => (snapshot && current ? diffSnapshots(current, snapshot) : null), [snapshot, current])
  const groups = useMemo(() => groupByDay(versions ?? [], now), [versions, now])
  const isDatabase = snapshot?.blocks[0].type === 'database'
  const summary = diff ? (diff.identical ? 'Same as the current page' : summarize(diff.counts, isDatabase ? 'row' : 'block')) : null
  const canRestore = !!selected && !!snapshot && !busy
  const canReplace = canRestore && !diff?.identical

  const move = (delta: number | 'first' | 'last'): void => {
    if (!versions?.length) return
    const index = versions.findIndex((v) => v.id === selectedId)
    const next = delta === 'first' ? 0 : delta === 'last' ? versions.length - 1 : Math.max(0, Math.min(versions.length - 1, (index < 0 ? 0 : index) + delta))
    setSelectedId(versions[next].id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // A sheet on top (a portal, but a React child) handles its own keys.
    if (sheet || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'Home') move('first')
    else if (event.key === 'End') move('last')
    else if (event.key === 'Enter' && !target.closest('button, a')) {
      if (canReplace) setSheet({ kind: 'restore' })
    } else return
    event.preventDefault()
  }

  const toggleChanges = (): void => {
    showChangesPreference = !showChanges
    setShowChanges(!showChanges)
  }

  const run = async (what: string, task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await task()
    } catch (err) {
      fail(what, err)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const doRestore = (): Promise<void> =>
    run('Could not restore the version.', async () => {
      if (!selected) return
      setSheet(null)
      await restoreVersion(selected)
      setHistoryPage(null)
    })

  const doCopy = (): Promise<void> =>
    run('Could not restore the version as a copy.', async () => {
      if (!selected) return
      await restoreVersionAsCopy(selected)
      setHistoryPage(null)
    })

  const doSave = (label: string): Promise<void> =>
    run('Could not save a version.', async () => {
      setSheet(null)
      const saved = await window.api.versions.save(pageId, label.trim() || null)
      cache.current.delete(saved.id)
      await reload(saved.id)
      toast('Version saved.', { kind: 'success' })
    })

  const doDelete = (version: VersionInfo): Promise<void> =>
    run('Could not delete the version.', async () => {
      setSheet(null)
      await window.api.versions.delete(version.id)
      cache.current.delete(version.id)
      await reload()
    })

  const doRename = (version: VersionInfo, label: string): void => {
    setRenamingId(null)
    listRef.current?.focus({ preventScroll: true })
    const next = label.trim() || null
    if (next === version.label) return
    void run('Could not rename the version.', async () => {
      await window.api.versions.rename(version.id, next)
      await reload()
    })
  }

  const emptyText = policy.enabled
    ? `sel saves a version on its own: when you start editing this page after a pause of ${countLabel(policy.minutes, 'minute')} or more, before a large deletion, before a restore, and when you quit. You can also save one yourself at any time.`
    : 'Automatic versions are turned off in Settings, under History. You can still save a version yourself.'

  return (
    <div className="vh-frame" onKeyDown={onKeyDown}>
      <header className="vh-header">
        <span className="vh-header-icon">
          <Clock />
        </span>
        <div className="vh-header-text">
          <h2>Version history</h2>
          <span className="vh-header-page">{title}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showChanges}
          className="vh-switch"
          disabled={!hasVersions}
          onClick={toggleChanges}
        >
          <span className="vh-switch-track" aria-hidden="true">
            <span className="vh-switch-thumb" />
          </span>
          Show changes
        </button>
        <IconButton label="Close" tooltip={false} onClick={() => setHistoryPage(null)}>
          <Close />
        </IconButton>
      </header>

      <div className="vh-main">
        <aside className="vh-side">
          {versions === null ? (
            <p className="vh-side-note">{loadFailed ? 'The versions of this page could not be loaded.' : 'Loading…'}</p>
          ) : versions.length === 0 ? (
            <div className="vh-empty-side">
              <h3>No versions yet</h3>
              <p>{emptyText}</p>
            </div>
          ) : (
            <div
              ref={listRef}
              className="vh-list"
              role="listbox"
              tabIndex={0}
              aria-label="Versions"
              aria-activedescendant={selectedId ? `vh-${selectedId}` : undefined}
            >
              {groups.map((group) => (
                <div key={group.key} role="group" aria-label={group.label}>
                  <div className="vh-day">{group.label}</div>
                  {group.items.map((version) => (
                    <TimelineItem
                      key={version.id}
                      version={version}
                      selected={version.id === selectedId}
                      renaming={version.id === renamingId}
                      rows={page?.type === 'database'}
                      onSelect={() => setSelectedId(version.id)}
                      onRename={() => {
                        setSelectedId(version.id)
                        setRenamingId(version.id)
                      }}
                      onRenamed={(label) => doRename(version, label)}
                      onCancelRename={() => {
                        setRenamingId(null)
                        listRef.current?.focus({ preventScroll: true })
                      }}
                      onDelete={() => setSheet({ kind: 'delete', version })}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          {damaged > 0 && (
            <p className="vh-side-note is-warning">
              {damaged === 1 ? '1 version is damaged and is not listed.' : `${damaged} versions are damaged and are not listed.`}
            </p>
          )}
        </aside>

        <section className="vh-preview" aria-label="Preview">
          {selected && (
            <div className="vh-preview-bar">
              <span className="vh-preview-when">{stampLabel(selected.createdAt, now)}</span>
              {selected.label && <span className="vh-preview-name">{selected.label}</span>}
              <span className="vh-preview-summary">{showChanges && summary}</span>
              {showChanges && diff && !diff.identical && (
                <span className="vh-legend" aria-hidden="true">
                  <span className="vh-legend-item is-added">Added</span>
                  <span className="vh-legend-item is-removed">Removed</span>
                  <span className="vh-legend-item is-changed">Changed</span>
                  {diff.counts.moved > 0 && <span className="vh-legend-item is-moved">Moved</span>}
                </span>
              )}
            </div>
          )}
          {error ? (
            <div className="vh-preview-empty">
              <h3>This version cannot be shown</h3>
              <p>{error}. It will no longer be offered in the list.</p>
            </div>
          ) : snapshot ? (
            <SnapshotView key={snapshot.info?.id} version={snapshot} current={current} diff={showChanges ? diff : null} />
          ) : versions && versions.length === 0 ? (
            <div className="vh-preview-empty">
              <h3>Nothing to compare yet</h3>
              <p>When this page has versions, pick one on the left to see the page as it was, compare it with the page as it is now, and restore it.</p>
            </div>
          ) : (
            <div className="vh-preview-empty" aria-busy="true" />
          )}
        </section>
      </div>

      <footer className="vh-footer">
        <Button disabled={busy} onClick={() => setSheet({ kind: 'save' })}>
          Save current version…
        </Button>
        <span className="vh-footer-hint">{hasVersions ? '↑ ↓ to browse, Enter to restore, Esc to close' : ''}</span>
        <Button disabled={!canRestore} onClick={() => void doCopy()}>
          Restore as a copy
        </Button>
        <Button variant="primary" disabled={!canReplace} onClick={() => setSheet({ kind: 'restore' })}>
          Restore this version
        </Button>
      </footer>

      {sheet?.kind === 'restore' && selected && (
        <ConfirmSheet
          title="Restore this version?"
          confirm="Restore"
          onCancel={() => setSheet(null)}
          onConfirm={() => void doRestore()}
        >
          <p>
            The page goes back to how it was on {stampLabel(selected.createdAt, now)}
            {selected.label ? ` (${selected.label})` : ''}.
          </p>
          {summary && <p className="vh-sheet-summary">{summary}.</p>}
          <p>The page as it is now is saved as a version first, so you can undo this. Sub-pages are never deleted by a restore.</p>
        </ConfirmSheet>
      )}
      {sheet?.kind === 'delete' && (
        <ConfirmSheet
          title="Delete this version?"
          confirm="Delete"
          danger
          onCancel={() => setSheet(null)}
          onConfirm={() => void doDelete(sheet.version)}
        >
          <p>
            The version from {stampLabel(sheet.version.createdAt, now)}
            {sheet.version.label ? ` (${sheet.version.label})` : ''} is removed from the history. The page itself does not change.
          </p>
        </ConfirmSheet>
      )}
      {sheet?.kind === 'save' && <SaveSheet onCancel={() => setSheet(null)} onSave={(label) => void doSave(label)} />}
    </div>
  )
}

function TimelineItem({
  version,
  selected,
  renaming,
  rows,
  onSelect,
  onRename,
  onRenamed,
  onCancelRename,
  onDelete
}: {
  version: VersionInfo
  selected: boolean
  renaming: boolean
  rows: boolean | undefined
  onSelect: () => void
  onRename: () => void
  onRenamed: (label: string) => void
  onCancelRename: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div
      id={`vh-${version.id}`}
      data-version={version.id}
      role="option"
      aria-selected={selected}
      className={selected ? 'vh-item is-selected' : 'vh-item'}
      onClick={onSelect}
    >
      <div className="vh-item-top">
        <span className="vh-item-time">{timeLabel(version.createdAt)}</span>
        <span className={`vh-badge is-${kindTone(version.kind)}`}>{kindLabel(version.kind)}</span>
        <span className="vh-item-actions">
          <IconButton
            size="small"
            label="Rename"
            onClick={(event) => {
              event.stopPropagation()
              onRename()
            }}
          >
            <Type size={14} />
          </IconButton>
          <IconButton
            size="small"
            label="Delete"
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
          >
            <Trash size={14} />
          </IconButton>
        </span>
      </div>
      {renaming ? (
        <RenameField initial={version.label ?? ''} onCommit={onRenamed} onCancel={onCancelRename} />
      ) : (
        version.label && <div className="vh-item-name">{version.label}</div>
      )}
      <div className="vh-item-meta">{countLabel(version.blockCount, rows ? 'row' : 'block')}</div>
    </div>
  )
}

/** Inline name editor: Enter or leaving the field keeps the name, Escape gives it up. */
function RenameField({ initial, onCommit, onCancel }: { initial: string; onCommit: (label: string) => void; onCancel: () => void }): JSX.Element {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const cancel = useRef(onCancel)
  cancel.current = onCancel

  // Escape belongs to the field while it is open: caught before the dialog (which listens on
  // the document) would take it as "close".
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopImmediatePropagation()
      done.current = true
      cancel.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const commit = (): void => {
    if (done.current) return
    done.current = true
    onCommit(value)
  }

  return (
    <input
      className="ui-input vh-rename"
      value={value}
      maxLength={MAX_VERSION_LABEL}
      placeholder="Name this version"
      aria-label="Version name"
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}

function ConfirmSheet({
  title,
  confirm,
  danger,
  onCancel,
  onConfirm,
  children
}: {
  title: string
  confirm: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
  children: ReactNode
}): JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)
  // After the sheet has become the top layer (its own effect ran first): only then does
  // the window underneath stop pulling the focus back to itself.
  useEffect(() => confirmRef.current?.focus({ preventScroll: true }), [])
  return (
    <Modal open onClose={onCancel} label={title} className="vh-sheet">
      <h3>{title}</h3>
      <div className="vh-sheet-body">{children}</div>
      <div className="vh-sheet-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirm}
        </Button>
      </div>
    </Modal>
  )
}

function SaveSheet({ onCancel, onSave }: { onCancel: () => void; onSave: (label: string) => void }): JSX.Element {
  const [label, setLabel] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus({ preventScroll: true }), [])
  return (
    <Modal open onClose={onCancel} label="Save current version" className="vh-sheet">
      <h3>Save current version</h3>
      <div className="vh-sheet-body">
        <p>The page as it is now is kept as a version that is never cleaned up automatically.</p>
        <input
          ref={inputRef}
          className="ui-input"
          value={label}
          maxLength={MAX_VERSION_LABEL}
          placeholder="Name (optional)"
          aria-label="Version name"
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              onSave(label)
            }
          }}
        />
      </div>
      <div className="vh-sheet-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(label)}>
          Save version
        </Button>
      </div>
    </Modal>
  )
}
