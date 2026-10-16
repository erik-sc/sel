// Settings → Notifications: the reminders of tasks, the calendar's events (and how long before
// they start), whether a meeting asks to be recorded, the chime, and whether sel keeps running
// in the notification area so that any of it rings with the window closed. The briefing's times
// and voice stay under Herman (./AlarmSettings.tsx). Written in Herman's language.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ALARM_DEFAULTS, ALARMS_SETTING, ASK_RECORD, EVENT_LEADS, readAlarmSettings, type AlarmSettings } from '@shared/alarms'
import { Segmented } from '@/appearance/controls'
import { notifyError } from '@/ui/toast'
import { alarmsCopy, type AlarmsLocale } from './copy'
import './alarms.css'

export function NotificationsSection(): JSX.Element {
  const [values, setValues] = useState<AlarmSettings>(ALARM_DEFAULTS)
  const [locale, setLocale] = useState<AlarmsLocale>('en')
  const copy = alarmsCopy(locale)

  useEffect(() => {
    let alive = true
    const keys = Object.values(ALARMS_SETTING)
    Promise.all(keys.map((key) => window.api.app.getSetting<unknown>(key).catch(() => null))).then((stored) => {
      if (!alive) return
      const byKey = new Map(keys.map((key, index) => [key, stored[index]]))
      setValues(readAlarmSettings((key) => byKey.get(key)))
    })
    window.api.herman.state().then(
      (state) => {
        if (alive) setLocale(state.locale === 'pt-BR' ? 'pt-BR' : 'en')
      },
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [])

  /** Shows the new value at once, stores it, and puts the old one back if it could not be stored. */
  const change = <K extends keyof AlarmSettings>(name: K, value: AlarmSettings[K]): void => {
    const previous = values[name]
    setValues((current) => ({ ...current, [name]: value }))
    window.api.app.setSetting(ALARMS_SETTING[name], value).catch((error: unknown) => {
      setValues((current) => ({ ...current, [name]: previous }))
      notifyError(copy.saveFailed, error)
    })
  }

  const onOff = [
    { value: 'on' as const, label: copy.on },
    { value: 'off' as const, label: copy.off }
  ]
  const toggle = (name: 'reminders' | 'events' | 'sound' | 'tray' | 'openAtLogin', label: string): JSX.Element => (
    <Segmented label={label} value={values[name] ? 'on' : 'off'} options={onOff} onChange={(value) => change(name, value === 'on')} />
  )

  return (
    <div className="settings2-scroll" lang={locale}>
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{copy.tasksGroup}</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{copy.reminders}</span>
              <span className="ap-row-help">{copy.remindersHelp}</span>
            </div>
            <div className="ap-row-control">{toggle('reminders', copy.reminders)}</div>
          </div>
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{copy.eventsGroup}</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{copy.events}</span>
              <span className="ap-row-help">{copy.eventsHelp}</span>
            </div>
            <div className="ap-row-control">{toggle('events', copy.events)}</div>
          </div>
          {values.events && (
            <>
              <div className="ap-row">
                <div className="ap-row-text">
                  <span className="ap-row-label">{copy.lead}</span>
                  <span className="ap-row-help">{copy.leadHelp}</span>
                </div>
                <div className="ap-row-control">
                  <Segmented
                    label={copy.lead}
                    value={String(values.eventLead)}
                    options={EVENT_LEADS.map((minutes) => ({ value: String(minutes), label: copy.leadOption(minutes) }))}
                    onChange={(value) => change('eventLead', Number(value) as AlarmSettings['eventLead'])}
                  />
                </div>
              </div>
              <div className="ap-row">
                <div className="ap-row-text">
                  <span className="ap-row-label">{copy.askRecord}</span>
                  <span className="ap-row-help">{copy.askRecordHelp}</span>
                </div>
                <div className="ap-row-control">
                  <Segmented
                    label={copy.askRecord}
                    value={values.askRecord}
                    options={ASK_RECORD.map((value) => ({ value, label: copy.askRecordOption[value] }))}
                    onChange={(value) => change('askRecord', value)}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{copy.soundGroup}</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{copy.sound}</span>
              <span className="ap-row-help">{copy.soundHelp}</span>
            </div>
            <div className="ap-row-control">{toggle('sound', copy.sound)}</div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{copy.tray}</span>
              <span className="ap-row-help">{copy.trayHelp}</span>
              {!values.tray && <span className="ap-row-help alarm-warning">{copy.trayOff}</span>}
            </div>
            <div className="ap-row-control">{toggle('tray', copy.tray)}</div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{copy.openAtLogin}</span>
              <span className="ap-row-help">{copy.openAtLoginHelp(values.tray)}</span>
            </div>
            <div className="ap-row-control">{toggle('openAtLogin', copy.openAtLogin)}</div>
          </div>
        </div>
        <p className="ap-note">{copy.note}</p>
      </section>
    </div>
  )
}
