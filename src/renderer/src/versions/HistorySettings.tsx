// Settings → History. Part of the settings window's chunk, not of the history window's.
import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { HISTORY_DEFAULTS, HISTORY_LIMITS, type HistorySettings, type VersionStats } from '@shared/versions'
import { ConfirmButton, Segmented } from '@/appearance/controls'
import { notifyError, toast } from '@/ui/toast'
import { countLabel, formatBytes } from './format'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

type NumberKey = keyof typeof HISTORY_LIMITS

function NumberRow({
  label,
  help,
  unit,
  name,
  value,
  onCommit
}: {
  label: string
  help: string
  unit: string
  name: NumberKey
  value: number
  onCommit: (name: NumberKey, value: number) => void
}): JSX.Element {
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setText(String(value))
  }
  const { min, max } = HISTORY_LIMITS[name]
  const commit = (): void => {
    const parsed = Number.parseInt(text, 10)
    if (!Number.isFinite(parsed)) {
      setText(String(value))
      return
    }
    const next = Math.min(max, Math.max(min, parsed))
    setText(String(next))
    if (next !== value) onCommit(name, next)
  }
  return (
    <div className="ap-row">
      <div className="ap-row-text">
        <span className="ap-row-label">{label}</span>
        <span className="ap-row-help">{help}</span>
      </div>
      <div className="ap-row-control">
        <input
          className="ap-field is-number"
          inputMode="numeric"
          aria-label={label}
          value={text}
          onChange={(event) => setText(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
        <span className="ap-unit">{unit}</span>
      </div>
    </div>
  )
}

export function HistorySection(): JSX.Element {
  const [settings, setSettings] = useState<HistorySettings>(HISTORY_DEFAULTS)
  const [stats, setStats] = useState<VersionStats | null>(null)

  const loadStats = useCallback((): void => {
    window.api.versions
      .stats()
      .then(setStats)
      .catch((error) => console.error('history stats failed', error))
  }, [])

  useEffect(() => {
    let alive = true
    const keys = ['enabled', 'sessionMinutes', 'maxPerPage', 'budgetMb'] as const
    Promise.all(keys.map((key) => window.api.app.getSetting<unknown>(`history.${key}`)))
      .then((values) => {
        if (!alive) return
        const next: HistorySettings = { ...HISTORY_DEFAULTS }
        if (typeof values[0] === 'boolean') next.enabled = values[0]
        if (typeof values[1] === 'number') next.sessionMinutes = values[1]
        if (typeof values[2] === 'number') next.maxPerPage = values[2]
        if (typeof values[3] === 'number') next.budgetMb = values[3]
        setSettings(next)
      })
      .catch((error) => console.error('history settings failed to load', error))
    loadStats()
    return () => {
      alive = false
    }
  }, [loadStats])

  const save = <K extends keyof HistorySettings>(key: K, value: HistorySettings[K]): void => {
    const previous = settings
    setSettings({ ...settings, [key]: value })
    window.api.app.setSetting(`history.${key}`, value).catch((error) => {
      setSettings(previous)
      notifyError('The setting could not be saved.', error)
    })
  }

  const clearAll = (): void => {
    window.api.versions
      .clear()
      .then(() => {
        toast('All version history was deleted.', { kind: 'success' })
        loadStats()
      })
      .catch((error) => notifyError('Could not delete the history.', error))
  }

  const used = stats ? `${formatBytes(stats.bytes)} in ${countLabel(stats.count, 'version')}` : 'Calculating…'

  return (
    <div className="settings2-scroll">
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Version history</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Save versions automatically</span>
              <span className="ap-row-help">Every page keeps a timeline of earlier states that you can browse, compare and restore.</span>
            </div>
            <div className="ap-row-control">
              <Segmented
                label="Save versions automatically"
                value={settings.enabled ? 'on' : 'off'}
                options={ON_OFF}
                onChange={(value) => save('enabled', value === 'on')}
              />
            </div>
          </div>
          <NumberRow
            label="New version after a pause of"
            help="The first edit after this long without editing a page saves the page as it was."
            unit="min"
            name="sessionMinutes"
            value={settings.sessionMinutes}
            onCommit={save}
          />
        </div>
        <p className="ap-note">Open a page's history from its ⋯ menu. Versions you save or name yourself are never cleaned up.</p>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Storage</h3>
        </div>
        <div className="ap-list">
          <NumberRow
            label="Versions kept per page"
            help="Above this, the oldest automatic versions of the page are removed."
            unit=""
            name="maxPerPage"
            value={settings.maxPerPage}
            onCommit={save}
          />
          <NumberRow
            label="Space for all history"
            help="Above this, the oldest automatic versions of any page are removed."
            unit="MB"
            name="budgetMb"
            value={settings.budgetMb}
            onCommit={save}
          />
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Storage used</span>
              <span className="ap-row-help">
                {used}
                {stats && stats.damaged > 0 ? `, plus ${countLabel(stats.damaged, 'damaged version')}` : ''}
              </span>
            </div>
            <div className="ap-row-control">
              <ConfirmButton label="Delete all history…" confirmLabel="Click again to delete all" onConfirm={clearAll} />
            </div>
          </div>
        </div>
        <p className="ap-note">
          Older automatic versions are thinned out over time: one per hour after a day, one per day after a week, one per week after 90
          days.
        </p>
      </section>
    </div>
  )
}
