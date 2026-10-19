// Settings → Pomodoro: the length of each phase, how often the long break comes, and whether
// starting a pomodoro enters focus mode. Read from the timer's own snapshot, which the main
// process sends again whenever one of these is written.
import type { JSX } from 'react'
import { POMODORO_DEFAULTS, POMODORO_SETTING, type PomodoroSettings } from '@shared/pomodoro'
import { acceleratorOf, formatAccelerator } from '@shared/shortcuts'
import { Segmented } from '@/appearance/controls'
import { IS_MAC } from '@/ui/platform'
import { notifyError } from '@/ui/toast'
import { usePomodoro } from './gate'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

type Minutes = 'focus' | 'short' | 'long' | 'longEvery'

const CHOICES: Record<Minutes, number[]> = {
  focus: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90],
  short: [1, 2, 3, 4, 5, 7, 10, 15],
  long: [10, 15, 20, 25, 30, 45, 60],
  longEvery: [2, 3, 4, 5, 6, 8]
}

function save(key: keyof PomodoroSettings, value: number | boolean): void {
  window.api.app.setSetting(POMODORO_SETTING[key], value).catch((error: unknown) => notifyError('The setting could not be saved.', error))
}

function Row({ label, help, children }: { label: string; help?: string; children: JSX.Element }): JSX.Element {
  return (
    <div className="ap-row">
      <div className="ap-row-text">
        <span className="ap-row-label">{label}</span>
        {help && <span className="ap-row-help">{help}</span>}
      </div>
      <div className="ap-row-control">{children}</div>
    </div>
  )
}

function Choose({ name, label, value, unit }: { name: Minutes; label: string; value: number; unit: (n: number) => string }): JSX.Element {
  // A value stored outside the usual choices (a later version, another device's) still shows.
  const options = CHOICES[name].includes(value) ? CHOICES[name] : [...CHOICES[name], value].sort((a, b) => a - b)
  return (
    <select className="ap-field ai-select" aria-label={label} value={value} onChange={(event) => save(name, Number(event.target.value))}>
      {options.map((option) => (
        <option key={option} value={option}>
          {unit(option)}
          {option === POMODORO_DEFAULTS[name] ? ' (default)' : ''}
        </option>
      ))}
    </select>
  )
}

const minutes = (n: number): string => `${n} min`
const SHORTCUT = formatAccelerator(acceleratorOf('start-pomodoro', IS_MAC) ?? '', IS_MAC)

export function PomodoroSection(): JSX.Element {
  const settings = usePomodoro((state) => state.snapshot?.settings) ?? POMODORO_DEFAULTS
  return (
    <div className="settings2-scroll">
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Timer</h3>
        </div>
        <div className="ap-list">
          <Row label="Focus" help="One focus phase.">
            <Choose name="focus" label="Focus" value={settings.focus} unit={minutes} />
          </Row>
          <Row label="Short break" help="The break after each focus phase.">
            <Choose name="short" label="Short break" value={settings.short} unit={minutes} />
          </Row>
          <Row label="Long break" help="The break that ends a set.">
            <Choose name="long" label="Long break" value={settings.long} unit={minutes} />
          </Row>
          <Row label="Long break every" help="Focus phases in a set.">
            <Choose name="longEvery" label="Long break every" value={settings.longEvery} unit={(n) => `${n} focus phases`} />
          </Row>
        </div>
        <p className="ap-note">A new length applies from the next phase. A phase never starts by itself: at its end, sel asks.</p>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Starting</h3>
        </div>
        <div className="ap-list">
          <Row label="Enter focus mode" help="Starting a pomodoro hides everything but the page.">
            <Segmented
              label="Enter focus mode"
              value={settings.focusMode ? 'on' : 'off'}
              options={ON_OFF}
              onChange={(value) => save('focusMode', value === 'on')}
            />
          </Row>
        </div>
        <p className="ap-note">
          Start one from the View menu, the command palette or {SHORTCUT}. Nothing rings while a meeting is being recorded.
        </p>
      </section>
    </div>
  )
}
