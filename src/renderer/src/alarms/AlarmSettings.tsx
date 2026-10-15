// Settings → Herman → Briefing and reminders: the times he briefs you, the chime and the voice,
// the reminders of tasks, and whether sel keeps running in the notification area for them.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ALARM_DEFAULTS, ALARMS_SETTING, MAX_ALARM_TIMES, readAlarmSettings, type AlarmSettings, type AlarmTime } from '@shared/alarms'
import { Segmented } from '@/appearance/controls'
import { Button } from '@/ui/Button'
import { notifyError } from '@/ui/toast'
import './alarms.css'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]
/** Monday first, as a week is read; the stored days count from Sunday (0). */
const WEEK = [1, 2, 3, 4, 5, 6, 0]
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

export function AlarmSettings(): JSX.Element {
  const [values, setValues] = useState<AlarmSettings>(ALARM_DEFAULTS)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let alive = true
    const keys = Object.values(ALARMS_SETTING)
    Promise.all(keys.map((key) => window.api.app.getSetting<unknown>(key).catch(() => null))).then((stored) => {
      if (!alive) return
      const byKey = new Map(keys.map((key, index) => [key, stored[index]]))
      setValues(readAlarmSettings((key) => byKey.get(key)))
    })
    void import('./play').then(({ voices: list }) => list()).then((list) => {
      if (alive) setVoices(list)
    })
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
      notifyError('The setting could not be saved.', error)
    })
  }

  const setTime = (id: string, patch: Partial<AlarmTime>): void =>
    change(
      'times',
      values.times.map((time) => (time.id === id ? { ...time, ...patch } : time))
    )
  const addTime = (): void => change('times', [...values.times, { id: newId(), time: '08:30', days: [1, 2, 3, 4, 5], enabled: true }])
  const removeTime = (id: string): void => change('times', values.times.filter((time) => time.id !== id))
  const toggleDay = (time: AlarmTime, day: number): void =>
    setTime(time.id, { days: time.days.includes(day) ? time.days.filter((d) => d !== day) : [...time.days, day].sort((a, b) => a - b) })

  const test = (): void => {
    setTesting(true)
    window.api.alarms
      .test()
      .catch((error: unknown) => notifyError('The briefing could not be given.', error))
      .finally(() => setTesting(false))
  }

  const ownVoices = voices.filter((voice) => /^(pt|en)\b/i.test(voice.lang))

  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">Briefing and reminders</h3>
      </div>
      <div className="ap-list">
        <div className="ap-row alarm-times-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Brief me at</span>
            <span className="ap-row-help">At these times a chime sounds and Herman tells you about your day: the calendar, what is due and what is overdue.</span>
          </div>
          <div className="ap-row-control alarm-times">
            {values.times.map((time) => (
              <div key={time.id} className={time.enabled ? 'alarm-time' : 'alarm-time is-off'}>
                <input
                  type="checkbox"
                  className="alarm-enabled"
                  aria-label={`Briefing at ${time.time}`}
                  checked={time.enabled}
                  onChange={(event) => setTime(time.id, { enabled: event.target.checked })}
                />
                <input
                  className="ap-field herman-time"
                  type="time"
                  aria-label="Time"
                  value={time.time}
                  onChange={(event) => {
                    if (/^\d{2}:\d{2}$/.test(event.target.value)) setTime(time.id, { time: event.target.value })
                  }}
                />
                <div className="alarm-days" role="group" aria-label="Days">
                  {WEEK.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className={time.days.includes(day) ? 'alarm-day is-on' : 'alarm-day'}
                      aria-pressed={time.days.includes(day)}
                      aria-label={DAY_NAMES[day]}
                      title={DAY_NAMES[day]}
                      onClick={() => toggleDay(time, day)}
                    >
                      {DAY_LETTERS[day]}
                    </button>
                  ))}
                </div>
                <Button className="alarm-remove" aria-label="Remove this time" onClick={() => removeTime(time.id)}>
                  Remove
                </Button>
              </div>
            ))}
            <div className="alarm-actions">
              <Button disabled={values.times.length >= MAX_ALARM_TIMES} onClick={addTime}>
                Add a time
              </Button>
              <Button disabled={testing} onClick={test}>
                {testing ? 'Briefing…' : 'Try it now'}
              </Button>
            </div>
          </div>
        </div>
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Chime</span>
          </div>
          <div className="ap-row-control">
            <Segmented label="Chime" value={values.sound ? 'on' : 'off'} options={ON_OFF} onChange={(value) => change('sound', value === 'on')} />
          </div>
        </div>
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Read aloud</span>
            <span className="ap-row-help">He speaks with a voice of this computer, in the language of his lines.</span>
          </div>
          <div className="ap-row-control">
            <Segmented label="Read aloud" value={values.voice ? 'on' : 'off'} options={ON_OFF} onChange={(value) => change('voice', value === 'on')} />
          </div>
        </div>
        {values.voice && ownVoices.length > 0 && (
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Voice</span>
            </div>
            <div className="ap-row-control">
              <select
                className="ap-field ai-select"
                aria-label="Voice"
                value={values.voiceName ?? ''}
                onChange={(event) => {
                  const name = event.target.value || null
                  setValues((current) => ({ ...current, voiceName: name }))
                  window.api.app.setSetting(ALARMS_SETTING.voiceName, name).catch((error: unknown) => notifyError('The setting could not be saved.', error))
                }}
              >
                <option value="">Any of the language</option>
                {ownVoices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Written by the AI</span>
            <span className="ap-row-help">Herman writes the briefing with the AI a few minutes before its time. Otherwise, and whenever the AI cannot answer, it is in his own few words.</span>
          </div>
          <div className="ap-row-control">
            <Segmented label="Written by the AI" value={values.ai ? 'on' : 'off'} options={ON_OFF} onChange={(value) => change('ai', value === 'on')} />
          </div>
        </div>
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Reminders of tasks</span>
            <span className="ap-row-help">A task with a reminder, or due at a time of day, is announced when it comes.</span>
          </div>
          <div className="ap-row-control">
            <Segmented label="Reminders of tasks" value={values.reminders ? 'on' : 'off'} options={ON_OFF} onChange={(value) => change('reminders', value === 'on')} />
          </div>
        </div>
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Keep running in the notification area</span>
            <span className="ap-row-help">Closing the last window leaves sel running there, so briefings and reminders still come. Quit from its icon.</span>
          </div>
          <div className="ap-row-control">
            <Segmented label="Keep running in the notification area" value={values.tray ? 'on' : 'off'} options={ON_OFF} onChange={(value) => change('tray', value === 'on')} />
          </div>
        </div>
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Start with the computer</span>
            <span className="ap-row-help">{values.tray ? 'sel starts in the notification area when you sign in.' : 'sel opens when you sign in.'} Only in the installed app.</span>
          </div>
          <div className="ap-row-control">
            <Segmented label="Start with the computer" value={values.openAtLogin ? 'on' : 'off'} options={ON_OFF} onChange={(value) => change('openAtLogin', value === 'on')} />
          </div>
        </div>
      </div>
      <p className="ap-note">The times and reminders are kept by sel on this computer and stay on this device. Nothing is sent anywhere unless the AI writes the briefing.</p>
    </section>
  )
}
