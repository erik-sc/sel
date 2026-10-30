// The Today screen: a greeting, the day's phrase, the agenda and the open tasks, in one quiet
// column. Loaded on demand through Host.tsx. Everything shown comes from `briefing.get()`; a
// calendar's address is never here (the main process keeps it), only its label and host.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { localDay, type Briefing, type BriefingPhrase } from '@shared/briefing'
import { NOTEBOOK_ID, type NotebookLocale } from '@shared/notebook'
import { CLOSE_COPY } from '@/notebook/copy'
import { aiReady, useAiGate } from '@/ai/gate'
import { Herman64 } from '@/herman/Herman64'
import { noteAiEvent, useHerman, usePersona } from '@/herman/gate'
import { refreshTree } from '@/store/tree'
import { openPage } from '@/store/tabs'
import { notifyError, toast } from '@/ui/toast'
import {
  calendarNotes,
  clock,
  dayStart,
  eventMoments,
  eventTime,
  longDate,
  phraseSource,
  phraseText,
  taskGroups,
  tickedKey,
  updatedLabel
} from './format'
import { openFlows } from '@/flows/route'
import { useHome } from '@/home/store'
import { TASK_COPY } from '@/tasks/copy'
import { TodayWeek } from '@/review/TodayWeek'
import { startRefine } from '@/tasks/gate'
import { TaskPanel } from '@/tasks/lazy'
import { initRefining, useRefining } from '@/tasks/refining'
import { useTaskRows } from '@/tasks/TaskRow'
import { useCompleteTask } from './complete'
import { BRIEFING_COPY } from './copy'
import { BriefingTaskItem, EventRow, Lines, openSettings, useLive, useNow, useTaskViews } from './parts'
import { DayPlan, planDragSource, usePlanDrag, type PlanDrag, type PlanPatch } from './DayPlan'
import { patchTasks } from './plan'
import './today.css'

const readBriefing = (force: boolean): Promise<Briefing> => window.api.briefing.get(force)

// ---- what last night set aside -----------------------------------------------------

/**
 * The things the evening before set aside for today, when the day was closed (see
 * notebook/CloseDayScreen.tsx), until they are put away. Read from today's day of the notebook,
 * so they came along from whichever device closed the day.
 */
function Plans({ date }: { date: string }): JSX.Element | null {
  const [plans, setPlans] = useState<{ items: string[]; locale: NotebookLocale } | null>(null)

  useEffect(() => {
    let alive = true
    const read = (): void => {
      window.api.notebook.get().then(
        (view) => {
          if (!alive) return
          const entry = view.todayEntry
          setPlans(
            entry && entry.day === date && !entry.plansDismissed && entry.plans.length ? { items: entry.plans, locale: view.locale } : null
          )
        },
        (error: unknown) => console.error('the plans for today failed to load', error)
      )
    }
    read()
    const off = window.api.onChange((event) => {
      if (event.origin !== window.api.clientId && event.ids.some((id) => id.startsWith(NOTEBOOK_ID))) read()
    })
    return () => {
      alive = false
      off()
    }
  }, [date])

  if (!plans) return null
  const copy = CLOSE_COPY[plans.locale]
  const dismiss = (): void => {
    setPlans(null)
    window.api.notebook.dismissPlans(date).catch((error: unknown) => notifyError('Could not put them away.', error))
  }
  return (
    <section className="today-section today-plans" aria-labelledby="today-plans" lang={plans.locale}>
      <h2 className="today-label" id="today-plans">
        {copy.plansLabel}
      </h2>
      <ol className="today-plans-list">
        {plans.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ol>
      <div className="today-actions">
        <button type="button" className="today-link" onClick={dismiss}>
          {copy.plansDismiss}
        </button>
      </div>
    </section>
  )
}

// ---- the phrase ---------------------------------------------------------------

function Phrase({
  phrase,
  hasPhrases,
  onChange
}: {
  phrase: BriefingPhrase | null
  hasPhrases: boolean
  onChange: (phrase: BriefingPhrase | null) => void
}): JSX.Element | null {
  const herman = useHerman((state) => state.on)
  const { name } = usePersona()
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
      {/* With Herman on, the phrase is something he hands over. Presentation only: the phrase is chosen as before. */}
      {herman && (
        <div className="today-herman">
          <Herman64 pose="resting" />
          <span>For today, from {name}</span>
        </div>
      )}
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

  return (
    <section className="today-section" aria-labelledby="today-agenda">
      <h2 className="today-label" id="today-agenda">
        Agenda
      </h2>
      {today.length === 0 ? (
        <p className="today-quiet">{enabled.length === 0 ? 'Your calendars are turned off.' : 'Nothing scheduled today.'}</p>
      ) : (
        <ul className="today-list today-agenda">
          {today.map((event, index) => (
            <EventRow
              key={event.id}
              event={event}
              calendar={colors.get(event.calendarId)}
              moment={moments[index]}
              time={eventTime(event, from, to)}
            />
          ))}
        </ul>
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

/**
 * The open tasks. Those of the built-in Tasks database are edited where they are (chips, the
 * row's menu and keys) and open in the task panel, over the right side of the screen.
 */
function Tasks({
  briefing,
  today,
  drag,
  panel,
  setPanel
}: {
  briefing: Briefing
  today: string
  drag: PlanDrag
  panel: string | null
  setPanel: (id: string | null) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { done, settling, complete, reopen } = useCompleteTask({ calm: true })
  const words = BRIEFING_COPY[useHome((state) => state.locale)]
  const { groups, hidden } = useMemo(() => taskGroups(briefing.tasks, expanded, done), [briefing.tasks, expanded, done])
  const shown = useMemo(() => groups.flatMap((group) => group.tasks), [groups])
  const views = useTaskViews(shown)
  const rows = useTaskRows(useMemo(() => shown.filter((task) => views.get(task.id)).map((task) => task.id), [shown, views]))
  const byId = useMemo(() => new Map(shown.map((task) => [task.id, task])), [shown])

  return (
    <section className="today-section" aria-labelledby="today-tasks" {...rows.listProps}>
      <h2 className="today-label" id="today-tasks">
        {words.openTasks}
      </h2>
      {groups.length === 0 && hidden === 0 ? (
        <p className="today-quiet">{words.nothingOpen}</p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className={`today-group is-${group.key}`} role="group" aria-label={words.groups[group.key]}>
            {(groups.length > 1 || group.key !== 'today') && <h3 className="today-group-label">{words.groups[group.key]}</h3>}
            <ul className="today-list">
              {group.tasks.map((task) => (
                <BriefingTaskItem
                  key={task.id}
                  task={task}
                  view={views.get(task.id)}
                  day={briefing.date}
                  today={today}
                  rows={rows}
                  panel={panel}
                  onComplete={complete}
                  onReopen={reopen}
                  settling={settling.get(tickedKey(task))}
                  onOpen={setPanel}
                  drag={planDragSource(drag, task)}
                />
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
      <RefineLine />
      <TodayWeek today={today} onOpenTask={setPanel} />
      {panel && (
        <TaskPanel
          overlay
          taskId={panel}
          today={today}
          onClose={() => setPanel(null)}
          onToggle={(item) => {
            const listed = byId.get(item.id)
            complete(listed ?? { id: item.id, kind: 'row', title: item.title, pageId: item.id, source: '' })
          }}
          onSelect={setPanel}
        />
      )}
    </section>
  )
}

/**
 * One quiet line under the tasks while some wait to be refined: "4 to refine · Refine", which
 * starts the refine mode. Nothing at all otherwise.
 */
function RefineLine(): JSX.Element | null {
  const count = useRefining((state) => state.count)
  const words = TASK_COPY[useHome((state) => state.locale)]
  useEffect(() => initRefining(), [])
  if (count <= 0) return null
  return (
    <p className="today-refine">
      <span>{words.todayLine(count)}</span>
      <span aria-hidden="true"> · </span>
      <button type="button" className="today-link is-inline" onClick={() => startRefine('refine')}>
        {words.refine}
      </button>
    </p>
  )
}

// ---- "Brief me" ---------------------------------------------------------------

type BriefState = { phase: 'idle' } | { phase: 'running' | 'done'; id: string; text: string } | { phase: 'failed'; message: string }

/** The optional spoken-style paragraph. It runs when asked for, and never by itself. */
function BriefMe(): JSX.Element | null {
  const enabled = useAiGate((state) => state.enabled)
  const herman = useHerman((state) => state.on)
  const { name } = usePersona()
  const [state, setState] = useState<BriefState>({ phase: 'idle' })
  const current = useRef<string | null>(null)

  useEffect(() => {
    const off = window.api.ai.onEvent((event) => {
      if (event.id !== current.current) return
      noteAiEvent(event.type, event.type === 'error' && event.code === 'cancelled')
      if (event.type === 'delta')
        setState((previous) => (previous.phase === 'running' ? { ...previous, text: previous.text + event.text } : previous))
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
      noteAiEvent('start')
      window.api.briefing.brief().then(
        ({ id }) => {
          current.current = id
          setState({ phase: 'running', id, text: '' })
        },
        (error: unknown) => {
          console.error('the briefing paragraph could not start', error)
          noteAiEvent('rejected')
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
          {herman ? `Ask ${name} about today` : 'Brief me'}
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
  const { data, failed, refreshing, refresh, update } = useLive(readBriefing, 'the briefing')
  const setPhrase = useCallback((phrase: BriefingPhrase | null) => update((current) => ({ ...current, phrase })), [update])
  const now = useNow()
  const drag = usePlanDrag()
  // The task panel: opened from the open tasks and from the plan's blocks.
  const [panel, setPanel] = useState<string | null>(null)
  const patch = useCallback<PlanPatch>(
    (id, change) => update((current) => ({ ...current, tasks: patchTasks(current.tasks, id, change, current.date) })),
    [update]
  )

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
      <Plans date={data.date} />
      <Phrase phrase={data.phrase} hasPhrases={data.hasPhrases} onChange={setPhrase} />
      <Agenda briefing={data} now={now} />
      <DayPlan briefing={data} now={now} drag={drag} onPatch={patch} onOpen={setPanel} />
      <Tasks briefing={data} today={localDay(now)} drag={drag} panel={panel} setPanel={setPanel} />
      <BriefMe />
      <footer className="today-foot">
        <span>{updatedLabel(data.updatedAt, now)}</span>
        <button type="button" className="today-link" disabled={refreshing} onClick={refresh}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button type="button" className="today-link" onClick={openFlows}>
          Flows
        </button>
        <button type="button" className="today-link" onClick={openSettings}>
          Settings
        </button>
      </footer>
    </article>
  )
}
