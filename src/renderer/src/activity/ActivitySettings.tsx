// The row of Settings → General → Data for the local activity log (src/shared/activity.ts):
// on or off (off stops it at once), how much it holds, and "Delete history"; and the weekly word
// about your rhythm that the persona may say from it (off unless turned on, main/activity/rhythm.ts).
import { useEffect, useState } from 'react'
import { ACTIVITY_COPY, ACTIVITY_ENABLED_KEY, ACTIVITY_RHYTHM_KEY, type ActivityStatus, rhythmEnabled } from '@shared/activity'
import { backupWhen } from '@shared/dataCopy'
import { ConfirmButton, Segmented } from '@/appearance/controls'
import { useDataCopy } from '@/backup/locale'

export function ActivitySettingsRows() {
  const { locale } = useDataCopy()
  const copy = ACTIVITY_COPY[locale]
  const [status, setStatus] = useState<ActivityStatus | null>(null)
  const [note, setNote] = useState<'idle' | 'cleared' | 'failed'>('idle')
  const [rhythm, setRhythm] = useState(false)

  useEffect(() => {
    let live = true
    window.api.activity
      .status()
      .then((next) => live && setStatus(next))
      .catch(() => undefined)
    window.api.app
      .getSetting(ACTIVITY_RHYTHM_KEY)
      .then((stored) => live && setRhythm(rhythmEnabled(stored)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const setEnabled = (enabled: boolean): void => {
    setNote('idle')
    window.api.app
      .setSetting(ACTIVITY_ENABLED_KEY, enabled)
      .then(() => window.api.activity.status())
      .then(setStatus)
      .catch(() => setNote('failed'))
  }

  const changeRhythm = (on: boolean): void => {
    setRhythm(on)
    window.api.app.setSetting(ACTIVITY_RHYTHM_KEY, on).catch(() => {
      setRhythm(!on)
      setNote('failed')
    })
  }

  const clear = (): void => {
    window.api.activity
      .clear()
      .then((next) => {
        setStatus(next)
        setNote('cleared')
      })
      .catch(() => setNote('failed'))
  }

  const enabled = status?.enabled ?? true
  const since = status?.since != null ? backupWhen(status.since, Date.now(), locale) : null
  const line = note === 'failed' ? copy.failed : note === 'cleared' ? copy.cleared : status ? copy.count(status.events, since) : ''

  return (
    <>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.label}</span>
          <span className="ap-row-help">{copy.help}</span>
          {line && <span className={note === 'failed' ? 'ap-row-help is-error' : 'ap-row-help'}>{line}</span>}
        </div>
        <div className="ap-row-control data-actions">
          <ConfirmButton label={copy.clear} confirmLabel={copy.confirm} onConfirm={clear} />
          <Segmented
            label={copy.label}
            value={enabled ? 'on' : 'off'}
            options={[
              { value: 'on', label: copy.on },
              { value: 'off', label: copy.off }
            ]}
            onChange={(value) => setEnabled(value === 'on')}
          />
        </div>
      </div>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.rhythmLabel}</span>
          <span className="ap-row-help">{copy.rhythmHelp}</span>
        </div>
        <div className="ap-row-control">
          <Segmented
            label={copy.rhythmLabel}
            value={rhythm ? 'on' : 'off'}
            options={[
              { value: 'on', label: copy.on },
              { value: 'off', label: copy.off }
            ]}
            onChange={(value) => changeRhythm(value === 'on')}
          />
        </div>
      </div>
    </>
  )
}
