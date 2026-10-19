// The calendar screen: a month, or a week hour by hour, of the connected calendars and of the
// open tasks that have a due date, with the chosen day spelled out beside it. Loaded on demand
// through Host.tsx. A day in the grid is something to pick; what can be done about an event or a task (take notes, open
// it, mark it done) is done from the day's own list. Everything shown comes from
// `briefing.agenda()`; as on the Today screen, a calendar's address is never here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX, KeyboardEvent, Ref } from 'react'
import { localDay, type BriefingCalendar, type BriefingEvent, type BriefingTask } from '@shared/briefing'
import {
  addDays,
  calendarMatrix,
  monthLabel,
  monthOf,
  monthRangeLabel,
  shiftMonth,
  weekOf,
  weekdayLabels,
  type CalendarDay,
  type MonthCursor
} from '@/database/logic/dates'
import { ChevronLeft, ChevronRight } from '@/ui/icons'
import {
  agendaByDay,
  calendarNotes,
  dayStart,
  dayTimeline,
  dueLabel,
  eventMoments,
  eventTime,
  fillsDay,
  longDate,
  nextDayStart,
  shortClock,
  tickedKey,
  updatedLabel,
  type DayAgenda,
  type EventMoment
} from './format'
import { EventRow, TaskRow, openSettings, useCompleteTask, useLive, useNow } from './parts'
import './today.css'
import './calendar.css'

/** Lines a day of the grid shows before the rest is folded into "n more". */
const DAY_LINES = 3
const NOTHING: DayAgenda = { events: [], tasks: [] }
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
const DAY_MINUTES = 1440
/** The hour the week opens at, a little before seven so that its label shows: the night is a scroll away. */
const FIRST_HOUR = 6.75

type View = 'month' | 'week'
const VIEWS: readonly { id: View; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' }
]
const VIEW_KEY = 'sel.calendar.view'

/** The view the calendar was last left in. */
function storedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'
  } catch {
    return 'month'
  }
}

function storeView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Without storage the calendar opens on the month next time.
  }
}

function firstOf(cursor: MonthCursor): string {
  return `${String(cursor.year).padStart(4, '0')}-${String(cursor.month + 1).padStart(2, '0')}-01`
}

function sameMonth(a: MonthCursor, b: MonthCursor): boolean {
  return a.year === b.year && a.month === b.month
}

type Calendars = ReadonlyMap<string, BriefingCalendar>

/** How a day is read out: its date and how much it holds. */
function dayLabel(day: string, agenda: DayAgenda): string {
  const count = [
    agenda.events.length && `${agenda.events.length} ${agenda.events.length === 1 ? 'event' : 'events'}`,
    agenda.tasks.length && `${agenda.tasks.length} ${agenda.tasks.length === 1 ? 'task' : 'tasks'}`
  ]
    .filter(Boolean)
    .join(', ')
  return count ? `${longDate(day)}: ${count}` : longDate(day)
}

/** Something that fills the day: a band in its calendar's colour. */
function Band({ event, calendars }: { event: BriefingEvent; calendars: Calendars }): JSX.Element {
  const title = event.title || 'Untitled'
  return (
    <span
      className="cal-item is-band"
      style={{ background: `var(--c-${calendars.get(event.calendarId)?.color ?? 'gray'}-bg)` }}
      title={title}
    >
      <span className="cal-item-title">{title}</span>
    </span>
  )
}

function TaskLine({ task, overdue }: { task: BriefingTask; overdue: boolean }): JSX.Element {
  return (
    <span className={overdue ? 'cal-item is-task is-overdue' : 'cal-item is-task'} title={task.title}>
      <span className="cal-ring" />
      <span className="cal-item-title">{task.title}</span>
    </span>
  )
}

/** One day of the grid: its number, and as many of its events and tasks as fit. */
function DayCell({
  day,
  number,
  outside,
  today,
  selected,
  agenda,
  calendars,
  onPick
}: {
  day: string
  number: number
  outside: boolean
  today: string
  selected: boolean
  agenda: DayAgenda
  calendars: Calendars
  onPick: (day: string) => void
}): JSX.Element {
  const from = dayStart(day) ?? 0
  const to = nextDayStart(from)
  const total = agenda.events.length + agenda.tasks.length
  const room = total > DAY_LINES ? DAY_LINES - 1 : total
  const events = agenda.events.slice(0, room)
  const tasks = agenda.tasks.slice(0, room - events.length)
  const classes = ['cal-day']
  if (outside) classes.push('is-outside')
  if (day === today) classes.push('is-today')
  if (selected) classes.push('is-selected')

  return (
    <div className={classes.join(' ')} onClick={() => onPick(day)}>
      {/* The day's one control: the lines below it are a preview, read out as a count. */}
      <button
        type="button"
        className="cal-day-number"
        data-day={day}
        tabIndex={selected ? 0 : -1}
        aria-pressed={selected}
        aria-label={dayLabel(day, agenda)}
      >
        {number}
      </button>
      {events.map((event) => {
        const color = calendars.get(event.calendarId)?.color ?? 'gray'
        const title = event.title || 'Untitled'
        // Something that fills the day is a band; something with an hour is a line that starts with it.
        return event.allDay || (event.start < from && event.end > to) ? (
          <Band key={event.id} event={event} calendars={calendars} />
        ) : (
          <span key={event.id} className="cal-item" title={title}>
            <span className="cal-dot" style={{ background: `var(--c-${color})` }} />
            {event.start >= from && <span className="cal-item-time">{shortClock(event.start)}</span>}
            <span className="cal-item-title">{title}</span>
          </span>
        )
      })}
      {tasks.map((task) => (
        <TaskLine key={task.id} task={task} overdue={day < today} />
      ))}
      {total > room && <span className="cal-more">{total - room} more</span>}
    </div>
  )
}

/** The top of a day of the week: its name and number, then what fills it and what is due on it. */
function WeekDayHead({
  day,
  weekday,
  today,
  selected,
  agenda,
  calendars,
  onPick
}: {
  day: string
  weekday: string
  today: string
  selected: boolean
  agenda: DayAgenda
  calendars: Calendars
  onPick: (day: string) => void
}): JSX.Element {
  const from = dayStart(day) ?? 0
  const to = nextDayStart(from)
  const bands = agenda.events.filter((event) => fillsDay(event, from, to))
  const total = bands.length + agenda.tasks.length
  const room = total > DAY_LINES ? DAY_LINES - 1 : total
  const events = bands.slice(0, room)
  const tasks = agenda.tasks.slice(0, room - events.length)
  const classes = ['cal-week-head']
  if (day === today) classes.push('is-today')
  if (selected) classes.push('is-selected')

  return (
    <div className={classes.join(' ')} onClick={() => onPick(day)}>
      <span className="cal-week-name">
        <span className="cal-week-weekday" aria-hidden="true">
          {weekday}
        </span>
        <button
          type="button"
          className="cal-day-number"
          data-day={day}
          tabIndex={selected ? 0 : -1}
          aria-pressed={selected}
          aria-label={dayLabel(day, agenda)}
        >
          {Number(day.slice(8))}
        </button>
      </span>
      {events.map((event) => (
        <Band key={event.id} event={event} calendars={calendars} />
      ))}
      {tasks.map((task) => (
        <TaskLine key={task.id} task={task} overdue={day < today} />
      ))}
      {total > room && <span className="cal-more">{total - room} more</span>}
    </div>
  )
}

/** The hours of a day of the week: each event where it happens, as tall as it is long. */
function WeekDayHours({
  day,
  today,
  now,
  selected,
  agenda,
  calendars,
  onPick
}: {
  day: string
  today: string
  now: number
  selected: boolean
  agenda: DayAgenda
  calendars: Calendars
  onPick: (day: string) => void
}): JSX.Element {
  const from = dayStart(day) ?? 0
  const to = nextDayStart(from)
  const timed = useMemo(() => dayTimeline(agenda.events, from, to), [agenda.events, from, to])
  const clock = new Date(now)
  const classes = ['cal-week-col']
  if (day === today) classes.push('is-today')
  if (selected) classes.push('is-selected')

  return (
    <div className={classes.join(' ')} onClick={() => onPick(day)}>
      {timed.map(({ event, start, end, lane, lanes }) => {
        const title = event.title || 'Untitled'
        const color = calendars.get(event.calendarId)?.color ?? 'gray'
        const block = ['cal-block']
        if (end - start < 45) block.push('is-short')
        if (event.end > event.start ? event.end <= now : event.start < now) block.push('is-past')
        return (
          <span
            key={event.id}
            className={block.join(' ')}
            title={`${title}, ${eventTime(event, from, to)}`}
            style={
              {
                top: `${(start / DAY_MINUTES) * 100}%`,
                height: `${((end - start) / DAY_MINUTES) * 100}%`,
                left: `${(lane / lanes) * 100}%`,
                width: `${100 / lanes}%`,
                '--block': `var(--c-${color})`,
                '--block-bg': `var(--c-${color}-bg)`
              } as CSSProperties
            }
          >
            <span className="cal-block-title">{title}</span>
            {event.start >= from && <span className="cal-block-time">{shortClock(event.start)}</span>}
          </span>
        )
      })}
      {day === today && (
        <span className="cal-now" style={{ top: `${((clock.getHours() * 60 + clock.getMinutes()) / DAY_MINUTES) * 100}%` }} />
      )}
    </div>
  )
}

/** A week, hour by hour. What fills a day and what is due on it stay in sight above the hours. */
function WeekGrid({
  ref,
  title,
  busy,
  days,
  weekdays,
  today,
  now,
  selected,
  byDay,
  calendars,
  onPick,
  onKeyDown
}: {
  ref: Ref<HTMLDivElement>
  title: string
  busy: boolean
  days: readonly CalendarDay[]
  weekdays: readonly string[]
  today: string
  now: number
  selected: string
  byDay: ReadonlyMap<string, DayAgenda>
  calendars: Calendars
  onPick: (day: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}): JSX.Element {
  const hours = useRef<HTMLDivElement>(null)
  // Opens on the morning: the first hours of the day are rarely the ones looked for.
  useEffect(() => {
    const element = hours.current
    if (element?.parentElement) element.parentElement.scrollTop = (element.offsetHeight * FIRST_HOUR) / 24
  }, [])
  const labels = useMemo(() => Array.from({ length: 23 }, (_, index) => shortClock(new Date(2023, 0, 1, index + 1).getTime())), [])

  return (
    <div className="cal-week" ref={ref} role="group" aria-label={title} aria-busy={busy} onKeyDown={onKeyDown}>
      <div className="cal-week-row is-head">
        <div className="cal-week-gutter" />
        {days.map((day, index) => (
          <WeekDayHead
            key={day.date}
            day={day.date}
            weekday={weekdays[index]}
            today={today}
            selected={day.date === selected}
            agenda={byDay.get(day.date) ?? NOTHING}
            calendars={calendars}
            onPick={onPick}
          />
        ))}
      </div>
      <div className="cal-week-row is-hours" ref={hours}>
        <div className="cal-week-gutter" aria-hidden="true">
          {labels.map((label, index) => (
            <span key={index} className="cal-hour" style={{ top: `${((index + 1) / 24) * 100}%` }}>
              {label}
            </span>
          ))}
        </div>
        {days.map((day) => (
          <WeekDayHours
            key={day.date}
            day={day.date}
            today={today}
            now={now}
            selected={day.date === selected}
            agenda={byDay.get(day.date) ?? NOTHING}
            calendars={calendars}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  )
}

/** The chosen day in full: its agenda and what is due on it. */
function DayDetail({
  day,
  today,
  now,
  agenda,
  calendars,
  loading,
  onComplete
}: {
  day: string
  today: string
  now: number
  agenda: DayAgenda
  calendars: Calendars
  loading: boolean
  onComplete: (task: BriefingTask) => void
}): JSX.Element {
  const from = dayStart(day) ?? 0
  const to = nextDayStart(from)
  const moments = useMemo<EventMoment[]>(
    () =>
      day === today
        ? eventMoments(agenda.events, now)
        : agenda.events.map((event: BriefingEvent) => (event.allDay ? 'day' : day < today ? 'past' : 'later')),
    [agenda.events, day, today, now]
  )
  const near = dueLabel(day, today)
  const connected = calendars.size > 0

  return (
    <aside className="cal-detail" aria-labelledby="cal-detail-date" aria-busy={loading}>
      {(near === 'Today' || near === 'Tomorrow' || near === 'Yesterday') && <p className="cal-detail-near">{near}</p>}
      <h2 className="cal-detail-date" id="cal-detail-date">
        {longDate(day)}
      </h2>
      <section className="cal-section" aria-labelledby="cal-detail-agenda">
        <h3 className="today-label" id="cal-detail-agenda">
          Agenda
        </h3>
        {agenda.events.length > 0 ? (
          <ul className="today-list today-agenda">
            {agenda.events.map((event, index) => (
              <EventRow
                key={event.id}
                event={event}
                calendar={calendars.get(event.calendarId)}
                moment={moments[index]}
                time={eventTime(event, from, to)}
              />
            ))}
          </ul>
        ) : connected ? (
          <p className="today-quiet">{loading ? 'Reading…' : 'Nothing scheduled.'}</p>
        ) : (
          <p className="today-quiet">
            <button type="button" className="today-link is-inline" onClick={openSettings}>
              Connect a calendar
            </button>{' '}
            to see your events here.
          </p>
        )}
      </section>
      <section className="cal-section" aria-labelledby="cal-detail-tasks">
        <h3 className="today-label" id="cal-detail-tasks">
          Due
        </h3>
        {agenda.tasks.length > 0 ? (
          <ul className="today-list">
            {agenda.tasks.map((task) => (
              <TaskRow key={task.id} task={task} day={day} onComplete={onComplete} />
            ))}
          </ul>
        ) : (
          <p className="today-quiet">{loading ? 'Reading…' : 'Nothing due.'}</p>
        )}
      </section>
    </aside>
  )
}

export function CalendarScreen(): JSX.Element {
  const now = useNow()
  const today = localDay(now)
  const [cursor, setCursor] = useState<MonthCursor>(() => monthOf(localDay()))
  const [selected, setSelected] = useState(() => localDay())
  const weekdays = useMemo(() => weekdayLabels(), [])
  const [view, setView] = useState<View>(storedView)
  const weekStart = weekOf(selected)[0]
  const days = useMemo<CalendarDay[]>(
    () =>
      view === 'week'
        ? weekOf(weekStart).map((date) => ({ date, day: Number(date.slice(8)), inMonth: true }))
        : calendarMatrix(cursor.year, cursor.month).flat(),
    [view, weekStart, cursor]
  )
  const from = days[0].date
  const to = days[days.length - 1].date

  const read = useCallback((force: boolean) => window.api.briefing.agenda(from, to, force), [from, to])
  const { data, failed, refreshing, refresh } = useLive(read, 'the calendar')
  const { done, complete } = useCompleteTask()
  // While other days are on their way, what is held belongs to the ones before: these stay empty.
  const agenda = data && data.from === from && data.to === to ? data : null
  const byDay = useMemo(
    () =>
      agendaByDay(
        days.map((day) => day.date),
        agenda?.events ?? [],
        (agenda?.tasks ?? []).filter((task) => !done.has(tickedKey(task)))
      ),
    [days, agenda, done]
  )
  const calendars = useMemo(() => new Map((data?.calendars ?? []).map((calendar) => [calendar.id, calendar])), [data])
  const enabled = [...calendars.values()].filter((calendar) => calendar.enabled)
  const failing = enabled.filter((calendar) => !calendar.ok)

  const grid = useRef<HTMLDivElement>(null)
  /** A day reached with the keyboard: its button takes the focus once it is drawn. */
  const follow = useRef<string | null>(null)
  useEffect(() => {
    if (!follow.current) return
    grid.current?.querySelector<HTMLElement>(`[data-day="${follow.current}"]`)?.focus()
    follow.current = null
  })

  /** Picks a day, turning to its month when it is one of the days around the month shown. */
  const pick = useCallback((day: string): void => {
    setSelected(day)
    const month = monthOf(day)
    setCursor((current) => (sameMonth(current, month) ? current : month))
  }, [])

  const turn = (delta: number): void => {
    if (view === 'week') return pick(addDays(selected, delta * 7))
    const next = shiftMonth(cursor, delta)
    setCursor(next)
    setSelected(sameMonth(next, monthOf(today)) ? today : firstOf(next))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key]
    if (!step || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    const next = addDays(selected, step)
    follow.current = next
    pick(next)
  }

  const show = (next: View): void => {
    setView(next)
    storeView(next)
  }

  const title = view === 'week' ? monthRangeLabel(from, to) : monthLabel(cursor.year, cursor.month)
  const busy = !agenda && !failed

  return (
    <article className="cal" aria-label="Calendar">
      <header className="cal-head">
        <h1 className="cal-title">{title}</h1>
        <div className="cal-nav">
          <div className="cal-views" role="group" aria-label="View">
            {VIEWS.map((item) => (
              <button key={item.id} type="button" className="cal-view" aria-pressed={view === item.id} onClick={() => show(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" className="cal-nav-button" aria-label={`Previous ${view}`} onClick={() => turn(-1)}>
            <ChevronLeft size={14} />
          </button>
          <button type="button" className="cal-nav-button is-text" onClick={() => pick(today)}>
            Today
          </button>
          <button type="button" className="cal-nav-button" aria-label={`Next ${view}`} onClick={() => turn(1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      </header>

      <ul className="cal-legend" aria-label="What is shown">
        {enabled.map((calendar) => (
          <li key={calendar.id}>
            <span className="cal-dot" style={{ background: `var(--c-${calendar.color})` }} />
            {calendar.label}
          </li>
        ))}
        <li>
          <span className="cal-ring" />
          Tasks with a due date
        </li>
      </ul>

      <div className="cal-body">
        <div className="cal-month">
          {view === 'week' ? (
            <WeekGrid
              ref={grid}
              title={title}
              busy={busy}
              days={days}
              weekdays={weekdays}
              today={today}
              now={now}
              selected={selected}
              byDay={byDay}
              calendars={calendars}
              onPick={pick}
              onKeyDown={onKeyDown}
            />
          ) : (
            <>
              <div className="cal-grid is-weekdays" aria-hidden="true">
                {weekdays.map((label, index) => (
                  <div key={index} className="cal-weekday">
                    {label}
                  </div>
                ))}
              </div>
              <div className="cal-grid" ref={grid} role="group" aria-label={title} aria-busy={busy} onKeyDown={onKeyDown}>
                {days.map((day) => (
                  <DayCell
                    key={day.date}
                    day={day.date}
                    number={day.day}
                    outside={!day.inMonth}
                    today={today}
                    selected={day.date === selected}
                    agenda={byDay.get(day.date) ?? NOTHING}
                    calendars={calendars}
                    onPick={pick}
                  />
                ))}
              </div>
            </>
          )}
          {failed && !agenda && (
            <p className="today-note" role="alert">
              The calendar could not be loaded.{' '}
              <button type="button" className="today-link is-inline" onClick={refresh}>
                Try again
              </button>
            </p>
          )}
          {agenda && !agenda.complete && failing.length === 0 && (
            <p className="today-note" role="status">
              Reading your calendars for these days…
            </p>
          )}
          {calendarNotes(failing, now).map((note) => (
            <p key={note} className="today-note" role="status">
              {note}
            </p>
          ))}
        </div>
        <DayDetail
          day={selected}
          today={today}
          now={now}
          agenda={byDay.get(selected) ?? NOTHING}
          calendars={calendars}
          loading={busy}
          onComplete={complete}
        />
      </div>

      <footer className="today-foot">
        <span>{data ? updatedLabel(data.updatedAt, now) : ''}</span>
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
