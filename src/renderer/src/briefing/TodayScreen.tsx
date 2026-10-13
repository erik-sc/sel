// The Today screen: a greeting, the day's phrase, the agenda and the open tasks, in one quiet
// column. Loaded on demand through Host.tsx. Everything shown comes from `briefing.get()`; a
// calendar's address is never here (the main process keeps it), only its label and host.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { localDay, type Briefing, type BriefingEvent, type BriefingPhrase, type BriefingTask } from '@shared/briefing'
import { aiReady, useAiGate } from '@/ai/gate'
import { refreshTree } from '@/store/tree'
import { openPage } from '@/store/tabs'
import { setSettingsOpen, useUi } from '@/store/ui'
import { notifyError, toast } from '@/ui/toast'
import { calendarNotes, clock, dayStart, dueLabel, eventMoments, eventTime, longDate, phraseSource, phraseText, taskGroups, untilMidnight, updatedLabel } from './format'
import { requestTodaySettings } from './route'
import './today.css'

/** Data older than this is fetched again when the window gets the focus back. */
const STALE_MS = 10 * 60_000
/** Changes to pages arrive in bursts while someone types: one reload after they settle. */
const CHANGE_DEBOUNCE_MS = 500

interface Loaded {
  data: Briefing | null
  failed: boolean
  refreshing: boolean
}

/** Loads the briefing and keeps it current: on change events, on focus, at midnight, on request. */
function useBriefing(): Loaded & { refresh: () => void; setPhrase: (phrase: BriefingPhrase | null) => void } {
  const [state, setState] = useState<Loaded>({ data: null, failed: false, refreshing: false })
  const alive = useRef(true)
  const latest = useRef(0)
  const loadedAt = useRef(0)

  const load = useCallback((force: boolean): void => {
    const ticket = ++latest.current
    if (force) setState((current) => ({ ...current, refreshing: true }))
    window.api.briefing.get(force).then(
      (data) => {
        if (!alive.current || ticket !== latest.current) return
        loadedAt.current = Date.now()
        setState({ data, failed: false, refreshing: false })
      },
      (error: unknown) => {
        if (!alive.current || ticket !== latest.current) return
        console.error('the briefing failed to load', error)
        setState((current) => ({ data: current.data, failed: true, refreshing: false }))
      }
    )
  }, [])

  useEffect(() => {
    alive.current = true
    load(false)
    let debounce: ReturnType<typeof setTimeout> | null = null
    const soon = (): void => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => load(false), CHANGE_DEBOUNCE_MS)
    }
    const offChanged = window.api.briefing.onChanged(() => load(false))
    const offBlocks = window.api.onChange(soon)
    const onFocus = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > STALE_MS) load(false)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    // A new day: a new date, a new phrase, another agenda.
    let midnight: ReturnType<typeof setTimeout>
    const arm = (): void => {
      midnight = setTimeout(() => {
        load(false)
        arm()
      }, untilMidnight(Date.now()) + 1000)
    }
    arm()
    // Settings that change what is shown are edited in a window on top of this screen.
    const offSettings = useUi.subscribe((ui, previous) => {
      if (previous.settingsOpen && !ui.settingsOpen) load(false)
    })
    return () => {
      alive.current = false
      if (debounce) clearTimeout(debounce)
      clearTimeout(midnight)
      offChanged()
      offBlocks()
      offSettings()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load])

  const refresh = useCallback(() => load(true), [load])
  const setPhrase = useCallback((phrase: BriefingPhrase | null) => {
    setState((current) => (current.data ? { ...current, data: { ...current.data, phrase } } : current))
  }, [])
  return { ...state, refresh, setPhrase }
}

/** The current time, refreshed every half minute: what is "now" and "next" follows the clock. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function Lines({ count = 3 }: { count?: number }): JSX.Element {
  return (
    <div className="today-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} />
      ))}
    </div>
  )
}

function openSettings(): void {
  requestTodaySettings()
  setSettingsOpen(true)
}

// ---- the phrase ---------------------------------------------------------------

function Phrase({ phrase, hasPhrases, onChange }: { phrase: BriefingPhrase | null; hasPhrases: boolean; onChange: (phrase: BriefingPhrase | null) => void }): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const another = (): void => {
    setBusy(true)
    window.api.briefing
      .anotherPhrase()
      .then(onChange, (error: unknown) => notifyError('Could not choose another phrase.', error))
      .finally(() => setBusy(false))
  }

  const copy = (): void => {
    if (!phrase) return
    navigator.clipboard.writeText(phraseText(phrase)).then(
      () => setCopied(true),
      (error: unknown) => notifyError('Could not copy the phrase.', error)
    )
  }

  const keep = (): void => {
    if (!phrase) return
    window.api.briefing.addPhrase(phrase.id).then(
      ({ id }) => {
        void refreshTree().catch(() => undefined)
        toast('Added to your phrases.', { action: { label: 'Open', run: () => openPage(id) } })
      },
      (error: unknown) => notifyError('Could not add the phrase.', error)
    )
  }

  const startOwn = (): void => {
    window.api.briefing.ensurePhrasesDatabase().then(
      ({ id }) => {
        void refreshTree().catch(() => undefined)
        openPage(id)
      },
      (error: unknown) => notifyError('Could not create the phrases database.', error)
    )
  }

  if (!phrase) {
    return (
      <section className="today-section today-phrase" aria-label="Phrase of the day">
        <p className="today-quiet">No phrase to show. Turn a tradition on in the settings, or add phrases of your own.</p>
        <div className="today-actions">
          <button type="button" className="today-link" onClick={openSettings}>
            Open the settings
          </button>
        </div>
      </section>
    )
  }

  const source = phraseSource(phrase)
  const classes = ['today-phrase-text']
  if (phrase.text.length <= 140) classes.push('is-short')
  if (phrase.text.includes('\n')) classes.push('is-verse')

  return (
    <section className="today-section today-phrase" aria-label="Phrase of the day">
      <figure className="today-figure">
        <blockquote className={classes.join(' ')} aria-live="polite">
          {phrase.text}
        </blockquote>
        {(source.author || source.work) && (
          <figcaption className="today-phrase-source">
            {source.author && <span className="today-phrase-author">{source.author}</span>}
            {source.work && <cite>{source.work}</cite>}
            {source.translator && <span className="today-phrase-translator">{source.translator}</span>}
          </figcaption>
        )}
      </figure>
      <div className="today-actions">
        <button type="button" className="today-link" disabled={busy} onClick={another}>
          Another
        </button>
        <button type="button" className="today-link" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {phrase.own && phrase.rowId ? (
          <button type="button" className="today-link" onClick={() => phrase.rowId && openPage(phrase.rowId)}>
            Open
          </button>
        ) : (
          <button type="button" className="today-link" onClick={keep}>
            Add to my phrases
          </button>
        )}
        {!hasPhrases && (
          <button type="button" className="today-link is-apart" onClick={startOwn}>
            Add your own phrases
          </button>
        )}
      </div>
    </section>
  )
}

// ---- the agenda ---------------------------------------------------------------

function Agenda({ briefing, now }: { briefing: Briefing; now: number }): JSX.Element {
  const { today, tomorrowFirst, calendars } = briefing.events
  const from = dayStart(briefing.date) ?? 0
  const to = useMemo(() => {
    const next = new Date(from)
    next.setDate(next.getDate() + 1)
    return next.getTime()
  }, [from])
  const moments = useMemo(() => eventMoments(today, now), [today, now])
  const colors = useMemo(() => new Map(calendars.map((calendar) => [calendar.id, calendar])), [calendars])
  const enabled = calendars.filter((calendar) => calendar.enabled)
  const failing = enabled.filter((calendar) => !calendar.ok)

  if (calendars.length === 0) {
    return (
      <section className="today-section" aria-labelledby="today-agenda">
        <h2 className="today-label" id="today-agenda">
          Agenda
        </h2>
        <p className="today-quiet">
          <button type="button" className="today-link is-inline" onClick={openSettings}>
            Connect a calendar
          </button>{' '}
          to see your day here.
        </p>
      </section>
    )
  }

  const row = (event: BriefingEvent, moment: string, time: string): JSX.Element => {
    const calendar = colors.get(event.calendarId)
    return (
      <li key={event.id} className={`today-event is-${moment}`}>
        <span className="today-event-time">{time}</span>
        <span className="today-dot" style={{ background: `var(--c-${calendar?.color ?? 'gray'})` }} role="img" aria-label={calendar?.label ?? 'Calendar'} title={calendar?.label} />
        <span className="today-event-body">
          <span className="today-event-title">
            {event.title || 'Untitled'}
            {(moment === 'now' || moment === 'next') && <span className="today-event-mark">{moment === 'now' ? 'Now' : 'Next'}</span>}
          </span>
          {event.location && <span className="today-event-meta">{event.location}</span>}
        </span>
      </li>
    )
  }

  return (
    <section className="today-section" aria-labelledby="today-agenda">
      <h2 className="today-label" id="today-agenda">
        Agenda
      </h2>
      {today.length === 0 ? (
        <p className="today-quiet">{enabled.length === 0 ? 'Your calendars are turned off.' : 'Nothing scheduled today.'}</p>
      ) : (
        <ul className="today-list today-agenda">{today.map((event, index) => row(event, moments[index], eventTime(event, from, to)))}</ul>
      )}
      {tomorrowFirst && (
        <p className="today-tomorrow">
          Tomorrow: {tomorrowFirst.allDay ? '' : `${clock(tomorrowFirst.start)} `}
          {tomorrowFirst.title || 'Untitled'}
        </p>
      )}
      {calendarNotes(failing, now).map((note) => (
        <p key={note} className="today-note" role="status">
          {note}
        </p>
      ))}
    </section>
  )
}

// ---- the tasks ----------------------------------------------------------------

function Tasks({ briefing }: { briefing: Briefing }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  /** Tasks ticked here, hidden at once; the next briefing no longer has them. */
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set())
  const { groups, hidden } = useMemo(() => taskGroups(briefing.tasks, expanded, done), [briefing.tasks, expanded, done])

  const complete = (task: BriefingTask): void => {
    setDone((current) => new Set(current).add(task.id))
    const restore = (): void =>
      setDone((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
    window.api.briefing.completeTask(task.id).then(
      ({ token }) => {
        toast('Marked as done.', {
          action: {
            label: 'Undo',
            run: () => {
              window.api.briefing.undoCompleteTask(token).then(restore, (error: unknown) => notifyError('Could not undo that.', error))
            }
          }
        })
      },
      (error: unknown) => {
        restore()
        notifyError('Could not mark the task as done.', error)
      }
    )
  }

  return (
    <section className="today-section" aria-labelledby="today-tasks">
      <h2 className="today-label" id="today-tasks">
        Open tasks
      </h2>
      {groups.length === 0 && hidden === 0 ? (
        <p className="today-quiet">Nothing open for today.</p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className={`today-group is-${group.key}`} role="group" aria-label={group.label}>
            {(groups.length > 1 || group.key !== 'today') && <h3 className="today-group-label">{group.label}</h3>}
            <ul className="today-list">
              {group.tasks.map((task) => (
                <li key={task.id} className="today-task">
                  <button type="button" className="today-check" aria-label={`Mark "${task.title}" as done`} onClick={() => complete(task)} />
                  <button type="button" className="today-task-open" onClick={(event) => openPage(task.pageId, { newTab: event.ctrlKey || event.metaKey })}>
                    <span className="today-task-title">{task.title}</span>
                    <span className="today-task-meta">
                      {[task.source, task.due && task.due !== briefing.date ? dueLabel(task.due, briefing.date) : '', task.priority?.name]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {hidden > 0 && (
        <button type="button" className="today-link today-more" onClick={() => setExpanded(true)}>
          and {hidden} more…
        </button>
      )}
    </section>
  )
}

// ---- "Brief me" ---------------------------------------------------------------

type BriefState = { phase: 'idle' } | { phase: 'running' | 'done'; id: string; text: string } | { phase: 'failed'; message: string }

/** The optional spoken-style paragraph. It runs when asked for, and never by itself. */
function BriefMe(): JSX.Element | null {
  const enabled = useAiGate((state) => state.enabled)
  const [state, setState] = useState<BriefState>({ phase: 'idle' })
  const current = useRef<string | null>(null)

  useEffect(() => {
    const off = window.api.ai.onEvent((event) => {
      if (event.id !== current.current) return
      if (event.type === 'delta') setState((previous) => (previous.phase === 'running' ? { ...previous, text: previous.text + event.text } : previous))
      else if (event.type === 'done') {
        current.current = null
        setState({ phase: 'done', id: event.id, text: event.text.trim() })
      } else {
        current.current = null
        setState(event.code === 'cancelled' ? { phase: 'idle' } : { phase: 'failed', message: event.message })
      }
    })
    return () => {
      off()
      // Leaving the screen stops a paragraph nobody will read.
      if (current.current) void window.api.ai.cancel(current.current).catch(() => undefined)
    }
  }, [])

  if (!enabled) return null

  const run = (): void => {
    void aiReady().then((ready) => {
      if (!ready) return
      window.api.briefing.brief().then(
        ({ id }) => {
          current.current = id
          setState({ phase: 'running', id, text: '' })
        },
        (error: unknown) => {
          console.error('the briefing paragraph could not start', error)
          setState({ phase: 'failed', message: 'The summary could not be written.' })
        }
      )
    })
  }

  const stop = (): void => {
    if (current.current) void window.api.ai.cancel(current.current).catch(() => undefined)
  }

  return (
    <section className="today-section today-brief" aria-label="Summary of the day">
      {state.phase === 'idle' && (
        <button type="button" className="today-link" onClick={run}>
          Brief me
        </button>
      )}
      {(state.phase === 'running' || state.phase === 'done') && (
        <>
          {state.text ? (
            <p className="today-brief-text" aria-live="polite" aria-busy={state.phase === 'running'}>
              {state.text}
            </p>
          ) : (
            <Lines count={3} />
          )}
          <div className="today-actions">
            {state.phase === 'running' ? (
              <button type="button" className="today-link" onClick={stop}>
                Stop
              </button>
            ) : (
              <button type="button" className="today-link" onClick={run}>
                Again
              </button>
            )}
          </div>
        </>
      )}
      {state.phase === 'failed' && (
        <>
          <p className="today-note" role="status">
            {state.message}
          </p>
          <div className="today-actions">
            <button type="button" className="today-link" onClick={run}>
              Try again
            </button>
          </div>
        </>
      )}
    </section>
  )
}

// ---- the screen ---------------------------------------------------------------

export function TodayScreen(): JSX.Element {
  const { data, failed, refreshing, refresh, setPhrase } = useBriefing()
  const now = useNow()

  if (!data) {
    return (
      <article className="today" aria-label="Today" aria-busy={!failed}>
        {failed ? (
          <>
            <header className="today-head">
              <h1 className="today-date">{longDate(localDay())}</h1>
            </header>
            <p className="today-note" role="alert">
              Today could not be loaded.
            </p>
            <div className="today-actions">
              <button type="button" className="today-link" onClick={refresh}>
                Try again
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="today-lines is-head" aria-hidden="true">
              <div />
              <div />
            </div>
            <Lines count={4} />
            <Lines count={3} />
          </>
        )}
      </article>
    )
  }

  return (
    <article className="today" aria-label="Today">
      <header className="today-head">
        <p className="today-greeting">{data.greeting}</p>
        <h1 className="today-date">{longDate(data.date)}</h1>
      </header>
      <Phrase phrase={data.phrase} hasPhrases={data.hasPhrases} onChange={setPhrase} />
      <Agenda briefing={data} now={now} />
      <Tasks briefing={data} />
      <BriefMe />
      <footer className="today-foot">
        <span>{updatedLabel(data.updatedAt, now)}</span>
        <button type="button" className="today-link" disabled={refreshing} onClick={refresh}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button type="button" className="today-link" onClick={openSettings}>
          Settings
        </button>
      </footer>
    </article>
  )
}
