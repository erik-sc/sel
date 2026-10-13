// Settings → Today. Part of the settings window's chunk.
import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import {
  BRIEFING_LIMITS,
  CALENDAR_COLORS,
  CALENDAR_ERROR_TEXT,
  TRADITION_LABELS,
  TRADITIONS,
  type BriefingCalendar,
  type BriefingDatabase,
  type CalendarColor,
  type CalendarTestResult,
  type OpenOnLaunch,
  type OwnPhrases,
  type Tradition
} from '@shared/briefing'
import { plainText } from '@shared/richtext'
import { ConfirmButton, Segmented } from '@/appearance/controls'
import { openPage } from '@/store/tabs'
import { refreshTree } from '@/store/tree'
import { setSettingsOpen } from '@/store/ui'
import { Button } from '@/ui/Button'
import { notifyError } from '@/ui/toast'
import { updatedLabel } from './format'
import './settings.css'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]
const LAUNCH: { value: OpenOnLaunch; label: string }[] = [
  { value: 'first-launch-of-day', label: 'Once a day' },
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' }
]
const OWN: { value: OwnPhrases; label: string }[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'mostly', label: 'Mostly mine' },
  { value: 'never', label: 'Never' }
]

interface Values {
  openOnLaunch: OpenOnLaunch
  name: string
  includeNoDate: boolean
  includeTodos: boolean
  maxItems: number
  /** Null: every database that has a done signal. */
  databases: string[] | null
  /** Null: all of them. */
  traditions: Tradition[] | null
  ownPhrases: OwnPhrases
  phrasesDatabaseId: string | null
}

const DEFAULTS: Values = {
  openOnLaunch: 'first-launch-of-day',
  name: '',
  includeNoDate: false,
  includeTodos: false,
  maxItems: BRIEFING_LIMITS.maxItems.default,
  databases: null,
  traditions: null,
  ownPhrases: 'balanced',
  phrasesDatabaseId: null
}

const KEYS = Object.keys(DEFAULTS) as (keyof Values)[]

function failed(error: unknown): void {
  notifyError('The setting could not be saved.', error)
}

function ColorDots({ value, label, onChange }: { value: CalendarColor; label: string; onChange: (color: CalendarColor) => void }): JSX.Element {
  return (
    <div className="ts-colors" role="radiogroup" aria-label={label}>
      {CALENDAR_COLORS.map((color) => (
        <button
          type="button"
          key={color}
          role="radio"
          aria-checked={color === value}
          aria-label={color}
          title={color}
          className={color === value ? 'ts-color is-selected' : 'ts-color'}
          style={{ color: `var(--c-${color})` }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

function Row({ label, help, error, children }: { label: string; help?: string; error?: boolean; children?: JSX.Element | JSX.Element[] | false | null }): JSX.Element {
  return (
    <div className="ap-row">
      <div className="ap-row-text">
        <span className="ap-row-label">{label}</span>
        {help && <span className={error ? 'ap-row-help is-error' : 'ap-row-help'}>{help}</span>}
      </div>
      {children && <div className="ap-row-control">{children}</div>}
    </div>
  )
}

// ---- calendars ----------------------------------------------------------------

function Calendars(): JSX.Element {
  const [calendars, setCalendars] = useState<BriefingCalendar[]>([])
  const [tests, setTests] = useState<Record<string, CalendarTestResult | 'running'>>({})
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [color, setColor] = useState<CalendarColor>('blue')
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState('')

  const reload = useCallback((): void => {
    window.api.briefing.calendars.list().then(setCalendars, (error: unknown) => console.error('calendars failed to load', error))
  }, [])

  useEffect(() => {
    reload()
    return window.api.briefing.onChanged(reload)
  }, [reload])

  const add = (): void => {
    const url = address.trim()
    if (!url || adding) return
    setAdding(true)
    setProblem('')
    window.api.briefing.calendars
      .add({ label: label.trim(), url, color })
      .then(
        () => {
          // The address is gone from this window as soon as it was handed over.
          setAddress('')
          setLabel('')
          setColor(CALENDAR_COLORS[(CALENDAR_COLORS.indexOf(color) + 1) % CALENDAR_COLORS.length])
          reload()
        },
        (error: unknown) => setProblem(error instanceof Error && error.message ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The calendar could not be added.')
      )
      .finally(() => setAdding(false))
  }

  const update = (id: string, patch: { label?: string; color?: CalendarColor; enabled?: boolean }): void => {
    setCalendars((current) => current.map((calendar) => (calendar.id === id ? { ...calendar, ...patch } : calendar)))
    window.api.briefing.calendars.update(id, patch).then(reload, (error: unknown) => {
      reload()
      failed(error)
    })
  }

  const remove = (id: string): void => {
    window.api.briefing.calendars.remove(id).then(reload, (error: unknown) => notifyError('The calendar could not be removed.', error))
  }

  const test = (id: string): void => {
    setTests((current) => ({ ...current, [id]: 'running' }))
    window.api.briefing.calendars.test(id).then(
      (result) => {
        setTests((current) => ({ ...current, [id]: result }))
        reload()
      },
      () => setTests((current) => ({ ...current, [id]: { ok: false, error: 'failed' } }))
    )
  }

  const status = (calendar: BriefingCalendar): { text: string; error: boolean } => {
    const tested = tests[calendar.id]
    if (tested === 'running') return { text: 'Reading the calendar…', error: false }
    if (tested && tested.ok) return { text: `It works: ${count(tested.today, 'event')} today, ${tested.week} in the next seven days.`, error: false }
    if (tested && !tested.ok) return { text: CALENDAR_ERROR_TEXT[tested.error], error: true }
    if (!calendar.enabled) return { text: `${calendar.host} · turned off`, error: false }
    if (!calendar.ok) return { text: `${calendar.host} · ${CALENDAR_ERROR_TEXT[calendar.error ?? 'failed']}`, error: true }
    return { text: calendar.updatedAt ? `${calendar.host} · ${updatedLabel(calendar.updatedAt, Date.now()).replace(/^U/, 'u')}` : calendar.host, error: false }
  }

  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">Calendars</h3>
      </div>
      {calendars.length > 0 && (
        <div className="ap-list ts-calendars">
          {calendars.map((calendar) => {
            const state = status(calendar)
            return (
              <div className="ap-row is-stacked" key={calendar.id}>
                <div className="ap-row-text">
                  <span className="ap-row-label ts-calendar-name">
                    <span className="ts-dot" style={{ background: `var(--c-${calendar.color})` }} aria-hidden="true" />
                    <input
                      className="ts-inline-input"
                      aria-label="Calendar name"
                      defaultValue={calendar.label}
                      key={calendar.label}
                      maxLength={BRIEFING_LIMITS.label}
                      onBlur={(event) => {
                        const next = event.target.value.trim()
                        if (next && next !== calendar.label) update(calendar.id, { label: next })
                        else event.target.value = calendar.label
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                  </span>
                  <span className={state.error ? 'ap-row-help is-error' : 'ap-row-help'} role="status">
                    {state.text}
                  </span>
                </div>
                <div className="ap-row-control ts-calendar-controls">
                  <ColorDots label={`Colour of ${calendar.label}`} value={calendar.color} onChange={(next) => update(calendar.id, { color: next })} />
                  <span className="ts-spacer" />
                  <Segmented label={`Show ${calendar.label}`} value={calendar.enabled ? 'on' : 'off'} options={ON_OFF} onChange={(value) => update(calendar.id, { enabled: value === 'on' })} />
                  <Button disabled={tests[calendar.id] === 'running'} onClick={() => test(calendar.id)}>
                    Test
                  </Button>
                  <ConfirmButton label="Remove" confirmLabel="Remove?" onConfirm={() => remove(calendar.id)} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {calendars.length < BRIEFING_LIMITS.calendars && (
        <form
          className="ap-list ts-add"
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <div className="ap-row is-stacked">
            <div className="ap-row-text">
              <span className="ap-row-label">{calendars.length ? 'Add another calendar' : 'Connect a calendar'}</span>
              <span className={problem ? 'ap-row-help is-error' : 'ap-row-help'} role={problem ? 'alert' : undefined}>
                {problem || 'Paste the secret iCal address of a calendar. It works with Google Calendar, Outlook, iCloud, Fastmail and anything else that publishes an .ics address.'}
              </span>
            </div>
            <div className="ap-row-control ts-add-fields">
              <input className="ap-field ts-add-name" aria-label="Name" placeholder="Name" value={label} maxLength={BRIEFING_LIMITS.label} onChange={(event) => setLabel(event.target.value)} />
              <input
                className="ap-field ts-add-address"
                aria-label="Secret address in iCal format"
                placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                value={address}
                maxLength={BRIEFING_LIMITS.url}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setAddress(event.target.value)
                  setProblem('')
                }}
              />
              <ColorDots label="Colour" value={color} onChange={setColor} />
              <span className="ts-spacer" />
              <Button variant="primary" type="submit" disabled={!address.trim() || adding}>
                {adding ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </div>
        </form>
      )}

      <details className="ts-help">
        <summary>Where do I find this?</summary>
        <ol>
          <li>Open Google Calendar in a browser and choose the gear, then Settings.</li>
          <li>Under “Settings for my calendars” on the left, choose the calendar.</li>
          <li>Scroll to “Integrate calendar” and find “Secret address in iCal format”.</li>
          <li>Copy that address and paste it above.</li>
        </ol>
        <p>
          Outlook calls it “Publish a calendar” (the ICS link); iCloud, “Public Calendar”. Anyone who has the address can read the calendar, so sel keeps it
          encrypted on this computer and never shows it again. To take access away, reset the secret address in your calendar’s settings.
        </p>
      </details>
      <p className="ap-note">
        Connecting a calendar is the one thing that makes sel go online by itself: it reads the address above every 15 minutes or so, over https, and sends
        nothing else. With no calendar connected, it makes no request at all.
      </p>
    </section>
  )
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ---- the section --------------------------------------------------------------

export function TodaySection(): JSX.Element {
  const [values, setValues] = useState<Values>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState('')
  const [maxItems, setMaxItems] = useState(String(DEFAULTS.maxItems))
  const [databases, setDatabases] = useState<BriefingDatabase[]>([])
  /** Every database, for choosing the one that holds the phrases. */
  const [all, setAll] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    let alive = true
    Promise.all(KEYS.map((key) => window.api.app.getSetting<unknown>(`briefing.${key}`)))
      .then((stored) => {
        if (!alive) return
        const next = { ...DEFAULTS } as Record<keyof Values, unknown>
        KEYS.forEach((key, index) => {
          if (stored[index] !== null && stored[index] !== undefined) next[key] = stored[index]
        })
        const read = next as unknown as Values
        setValues(read)
        setName(read.name)
        setMaxItems(String(read.maxItems))
        setLoaded(true)
      })
      .catch((error: unknown) => console.error('today settings failed to load', error))
    window.api.briefing.databases().then(
      (list) => alive && setDatabases(list),
      (error: unknown) => console.error('databases failed to load', error)
    )
    window.api.databases.list().then(
      (list) => alive && setAll(list.map((database) => ({ id: database.id, name: plainText(database.props.title) || 'Untitled' }))),
      (error: unknown) => console.error('databases failed to load', error)
    )
    return () => {
      alive = false
    }
  }, [])

  const set = <K extends keyof Values>(key: K, value: Values[K]): void => {
    const previous = values[key]
    setValues((current) => ({ ...current, [key]: value }))
    window.api.app.setSetting(`briefing.${key}`, value).catch((error: unknown) => {
      setValues((current) => ({ ...current, [key]: previous }))
      failed(error)
    })
  }

  const commitName = (): void => {
    const next = name.trim().slice(0, BRIEFING_LIMITS.name)
    setName(next)
    if (next !== values.name) set('name', next)
  }

  const commitMaxItems = (): void => {
    const parsed = Number.parseInt(maxItems, 10)
    const next = Number.isFinite(parsed) ? Math.min(BRIEFING_LIMITS.maxItems.max, Math.max(BRIEFING_LIMITS.maxItems.min, parsed)) : values.maxItems
    setMaxItems(String(next))
    if (next !== values.maxItems) set('maxItems', next)
  }

  const detected = databases.filter((database) => database.detected)
  const chosen = values.databases
  const isChosen = (database: BriefingDatabase): boolean => (chosen ? chosen.includes(database.id) : database.detected)
  const toggleDatabase = (database: BriefingDatabase): void => {
    const current = chosen ?? detected.map((entry) => entry.id)
    const next = current.includes(database.id) ? current.filter((id) => id !== database.id) : [...current, database.id]
    set('databases', next)
  }

  const traditions = values.traditions && values.traditions.length ? values.traditions : [...TRADITIONS]
  const toggleTradition = (tradition: Tradition): void => {
    const next = traditions.includes(tradition) ? traditions.filter((entry) => entry !== tradition) : [...traditions, tradition]
    // Turning the last one off would leave nothing to show: all come back on instead.
    set('traditions', next.length === 0 || next.length === TRADITIONS.length ? null : TRADITIONS.filter((entry) => next.includes(entry)))
  }

  const openPhrases = (): void => {
    window.api.briefing.ensurePhrasesDatabase().then(
      ({ id }) => {
        void refreshTree().catch(() => undefined)
        setSettingsOpen(false)
        openPage(id)
      },
      (error: unknown) => notifyError('Could not open the phrases database.', error)
    )
  }

  return (
    <div className="settings2-scroll" aria-busy={!loaded}>
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Today</h3>
        </div>
        <div className="ap-list">
          <Row label="Open at start-up" help="Once a day shows Today the first time you open sel each day.">
            <Segmented label="Open at start-up" value={values.openOnLaunch} options={LAUNCH} onChange={(value) => set('openOnLaunch', value)} />
          </Row>
          <Row label="Your name" help="For the greeting. Leave empty for none.">
            <input
              className="ap-field"
              aria-label="Your name"
              value={name}
              maxLength={BRIEFING_LIMITS.name}
              placeholder="None"
              onChange={(event) => setName(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitName()
                }
              }}
            />
          </Row>
        </div>
      </section>

      <Calendars />

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Open tasks</h3>
        </div>
        <div className="ap-list">
          <Row label="Tasks without a date" help="Also list open tasks that have no due date, under “No date”.">
            <Segmented label="Tasks without a date" value={values.includeNoDate ? 'on' : 'off'} options={ON_OFF} onChange={(value) => set('includeNoDate', value === 'on')} />
          </Row>
          <Row label="To-dos from pages" help="Also list unchecked to-dos from pages edited in the last seven days.">
            <Segmented label="To-dos from pages" value={values.includeTodos ? 'on' : 'off'} options={ON_OFF} onChange={(value) => set('includeTodos', value === 'on')} />
          </Row>
          <Row label="Show at most" help="The rest folds behind “and more…”.">
            <input
              className="ap-field is-number"
              inputMode="numeric"
              aria-label="Show at most, in tasks"
              value={maxItems}
              onChange={(event) => setMaxItems(event.target.value.replace(/[^\d]/g, '').slice(0, 2))}
              onBlur={commitMaxItems}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitMaxItems()
                }
              }}
            />
            <span className="ap-unit">tasks</span>
          </Row>
        </div>
        <div className="ap-list ts-checks" role="group" aria-label="Databases to draw tasks from">
          {databases.length === 0 && <Row label="Databases" help="No database yet. A database becomes a task list when it has a Status with a “Done” option, or a “Done” checkbox." />}
          {databases.map((database) => (
            <label className="ap-row ts-check" key={database.id}>
              <input type="checkbox" checked={isChosen(database)} disabled={!database.detected} onChange={() => toggleDatabase(database)} />
              <span className="ap-row-text">
                <span className="ap-row-label">
                  {database.icon ? `${database.icon} ` : ''}
                  {database.name}
                </span>
                {!database.detected && <span className="ap-row-help">No Status with a “Done” option and no “Done” checkbox, so its rows cannot be told open from done.</span>}
              </span>
            </label>
          ))}
        </div>
        <p className="ap-note">
          A row is open until its Status says done (or cancelled) or its Done checkbox is ticked. It is overdue when its date is before today, and for today when
          its date is today or its Status is one like “In progress”.
        </p>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Phrase of the day</h3>
        </div>
        <div className="ap-list ts-checks" role="group" aria-label="Traditions to draw phrases from">
          {TRADITIONS.map((tradition) => (
            <label className="ap-row ts-check" key={tradition}>
              <input type="checkbox" checked={traditions.includes(tradition)} onChange={() => toggleTradition(tradition)} />
              <span className="ap-row-text">
                <span className="ap-row-label">{TRADITION_LABELS[tradition]}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="ap-list ts-own">
          <Row label="Your own phrases" help="A database with one row per phrase: its author, its source and a Favourite checkbox. Favourites come up more often. Create one called Phrases, or choose a database you already have.">
            <select
              className="ap-field ts-select"
              aria-label="Database that holds your phrases"
              value={values.phrasesDatabaseId && all.some((database) => database.id === values.phrasesDatabaseId) ? values.phrasesDatabaseId : ''}
              onChange={(event) => set('phrasesDatabaseId', event.target.value || null)}
            >
              <option value="">{all.some((database) => database.id === values.phrasesDatabaseId) ? 'None' : 'Not created yet'}</option>
              {all.map((database) => (
                <option key={database.id} value={database.id}>
                  {database.name}
                </option>
              ))}
            </select>
            <Button onClick={openPhrases}>{values.phrasesDatabaseId && all.some((database) => database.id === values.phrasesDatabaseId) ? 'Open' : 'Create'}</Button>
          </Row>
          <Row label="Use your own" help="Balanced: half of the days, once you have ten of your own. Mostly mine: four days in five.">
            <Segmented label="Use your own phrases" value={values.ownPhrases} options={OWN} onChange={(value) => set('ownPhrases', value)} />
          </Row>
        </div>
        <p className="ap-note">
          The phrases that come with sel are passages from texts in the public domain — Marcus Aurelius, Epictetus, Seneca, the Dhammapada, the Tao Te Ching,
          Thoreau, Tagore and others — and the same one stays all day. Writers still in copyright, Hermann Hesse among them, cannot be bundled: add the passages
          you love to your own phrases, where they are yours alone.
        </p>
      </section>
    </div>
  )
}
