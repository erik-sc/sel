// Settings → Notifications: the reminders of tasks, the four reminders to refine them (shared/tasks/refine.ts), the calendar's events (and how long before
// they start), whether a meeting asks to be recorded, the chime, and whether sel keeps running
// in the notification area so that any of it rings with the window closed. The briefing's times
// and voice stay under Herman (./AlarmSettings.tsx). Written in Herman's language.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ALARM_DEFAULTS, ALARMS_SETTING, ASK_RECORD, EVENT_LEADS, readAlarmSettings, type AlarmSettings } from '@shared/alarms'
import { REFINE_DEFAULTS, REFINE_SETTING, readRefineSettings, type RefineSettings } from '@shared/tasks/refine'
import { Segmented } from '@/appearance/controls'
import { setRefineMark } from '@/tasks/refining'
import { notifyError } from '@/ui/toast'
import { alarmsCopy, type AlarmsLocale } from './copy'
import './alarms.css'

/** Monday first, as a week is read; the stored days count from Sunday (0). */
const WEEK = [1, 2, 3, 4, 5, 6, 0]

export function NotificationsSection(): JSX.Element {
  const [values, setValues] = useState<AlarmSettings>(ALARM_DEFAULTS)
  const [refine, setRefine] = useState<RefineSettings>(REFINE_DEFAULTS)
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
    const refineKeys = Object.values(REFINE_SETTING)
    Promise.all(refineKeys.map((key) => window.api.app.getSetting<unknown>(key).catch(() => null))).then((stored) => {
      if (!alive) return
      const byKey = new Map(refineKeys.map((key, index) => [key, stored[index]]))
      setRefine(readRefineSettings((key) => byKey.get(key)))
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

  /** The same for a refine setting. The sidebar's mark follows at once. */
  const changeRefine = <K extends keyof RefineSettings>(name: K, value: RefineSettings[K]): void => {
    const previous = refine[name]
    setRefine((current) => ({ ...current, [name]: value }))
    if (name === 'mark') setRefineMark(value as boolean)
    window.api.app.setSetting(REFINE_SETTING[name], value).catch((error: unknown) => {
      setRefine((current) => ({ ...current, [name]: previous }))
      if (name === 'mark') setRefineMark(previous as boolean)
      notifyError(copy.saveFailed, error)
    })
  }
  const refineToggle = (name: 'briefing' | 'herman' | 'mark', label: string): JSX.Element => (
    <Segmented label={label} value={refine[name] ? 'on' : 'off'} options={onOff} onChange={(value) => changeRefine(name, value === 'on')} />
  )
  const refineRow = (name: 'briefing' | 'herman' | 'mark', label: string, help: string): JSX.Element => (
    <div className="ap-row">
      <div className="ap-row-text">
        <span className="ap-row-label">{label}</span>
        <span className="ap-row-help">{help}</span>
      </div>
      <div className="ap-row-control">{refineToggle(name, label)}</div>
    </div>
  )
  const time = refine.time
  const toggleDay = (day: number): void =>
    changeRefine('time', {
      ...time,
      days: time.days.includes(day) ? time.days.filter((d) => d !== day) : [...time.days, day].sort((a, b) => a - b)
    })

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
          <h3 className="ap-group-title">{copy.refineGroup}</h3>
        </div>
        <p className="ap-note">{copy.refineHelp}</p>
        <div className="ap-list">
          {refineRow('briefing', copy.refineBriefing, copy.refineBriefingHelp)}
          {refineRow('herman', copy.refineHerman, copy.refineHermanHelp)}
          <div className="ap-row alarm-times-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{copy.refineTime}</span>
              <span className="ap-row-help">{copy.refineTimeHelp}</span>
            </div>
            <div className="ap-row-control alarm-times">
              <div className={time.enabled ? 'alarm-time' : 'alarm-time is-off'}>
                <input
                  type="checkbox"
                  className="alarm-enabled"
                  aria-label={copy.refineTime}
                  checked={time.enabled}
                  onChange={(event) => changeRefine('time', { ...time, enabled: event.target.checked })}
                />
                <input
                  className="ap-field herman-time"
                  type="time"
                  aria-label={copy.time}
                  value={time.time}
                  onChange={(event) => {
                    if (/^\d{2}:\d{2}$/.test(event.target.value)) changeRefine('time', { ...time, time: event.target.value })
                  }}
                />
                <div className="alarm-days" role="group" aria-label={copy.days}>
                  {WEEK.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className={time.days.includes(day) ? 'alarm-day is-on' : 'alarm-day'}
                      aria-pressed={time.days.includes(day)}
                      aria-label={copy.dayNames[day]}
                      title={copy.dayNames[day]}
                      onClick={() => toggleDay(day)}
                    >
                      {copy.dayLetters[day]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {refineRow('mark', copy.refineMark, copy.refineMarkHelp)}
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
