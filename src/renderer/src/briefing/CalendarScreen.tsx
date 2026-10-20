// The calendar screen: a month, or a week hour by hour, of the connected calendars and of the
// open tasks that have a due date, with the chosen day spelled out beside it. Loaded on demand
// through Host.tsx. A day in the grid is something to pick; what can be done about an event or a task (take notes, open
// it, mark it done) is done from the day's own list. Everything shown comes from
// `briefing.agenda()`; as on the Today screen, a calendar's address is never here.
//
// Tasks can be moved: dragged to another day of the month, or to another hour (or to the top of
// a day, without one) of the week; Ctrl+Z puts them back. A click on an empty day, or on an empty
// hour of the week, adds a task due then.
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, JSX, KeyboardEvent, MouseEvent, Ref } from 'react'
import { localDay, type BriefingCalendar, type BriefingEvent, type BriefingTask } from '@shared/briefing'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import * as L from '@/database/logic'
import { useResolvedDatabase } from '@/database/resolved'
import { useHome } from '@/home/store'
import { QuickAdd } from '@/tasks/QuickAdd'
import { notifyError, toast } from '@/ui/toast'
import { Popover } from '@/ui/Popover'
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
} from '@shared/database/dates'
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
import { canMove, moveTask, slotTime, undoMove, type Move } from './reschedule'
import '@/tasks/tasks.css'
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

/** The words this screen gained with moving and adding tasks, in the language of the home. */
const CAL_COPY = {
  en: {
    moved: (when: string) => `Moved to ${when}.`,
    undo: 'Undo',
    undone: 'Put back.',
    moveFailed: 'Could not move the task.',
    undoFailed: 'Could not put the task back.',
    newTask: (when: string) => `New task, ${when}`,
    placeholder: 'A task: Call the bank p1 #Home',
    dragHint: 'drag to another day or hour to move it'
  },
  'pt-BR': {
    moved: (when: string) => `Movida para ${when}.`,
    undo: 'Desfazer',
    undone: 'Voltou para onde estava.',
    moveFailed: 'Não foi possível mover a tarefa.',
    undoFailed: 'Não foi possível desfazer.',
    newTask: (when: string) => `Nova tarefa, ${when}`,
    placeholder: 'Uma tarefa: Ligar pro banco p1 #Casa',
    dragHint: 'arraste para outro dia ou horário para mover'
  }
}

/** Where a task is dropped: a day, at a time (`HH:mm`), without one (null) or at the one it had (undefined). */
type Drop = (day: string, time: string | null | undefined) => void

/** Moving and adding tasks, shared by the cells of both views. */
interface Planner {
  dragging: BriefingTask | null
  dragHint: string
  startDrag: (task: BriefingTask) => void
  endDrag: () => void
  drop: Drop
  /** Opens the quick add for a task due on `day` (at `time`), next to the point clicked. */
  add: (day: string, time: string | null, point: { x: number; y: number }) => void
}

const PlannerContext = createContext<Planner | null>(null)

interface DropTarget {
  over: boolean
  props: {
    onDragOver: (event: DragEvent<HTMLDivElement>) => void
    onDragLeave: (event: DragEvent<HTMLDivElement>) => void
    onDrop: (event: DragEvent<HTMLDivElement>) => void
  }
}

/** The props that let a cell take a dropped task, and whether one is over it. */
function useDropTarget(
  onDrop: (event: DragEvent<HTMLDivElement>) => void,
  onOver?: (event: DragEvent<HTMLDivElement>) => void
): DropTarget {
  const planner = use(PlannerContext)
  const [over, setOver] = useState(false)
  const active = !!planner?.dragging
  useEffect(() => {
    if (!active) setOver(false)
  }, [active])
  return {
    over: active && over,
    props: {
      onDragOver: (event) => {
        if (!planner?.dragging) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOver(true)
        onOver?.(event)
      },
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      },
      onDrop: (event) => {
        if (!planner?.dragging) return
        event.preventDefault()
        setOver(false)
        onDrop(event)
      }
    }
  }
}

interface DragSource {
  draggable?: boolean
  title?: string
  onDragStart?: (event: DragEvent<HTMLElement>) => void
  onDragEnd?: () => void
}

/** The props that make a task draggable, when it can be moved. */
function useDragSource(task: BriefingTask): DragSource {
  const planner = use(PlannerContext)
  if (!planner || !canMove(task)) return {}
  return {
    draggable: true,
    title: `${task.title} · ${planner.dragHint}`,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', task.title)
      planner.startDrag(task)
    },
    onDragEnd: () => planner.endDrag()
  }
}

/** The local moment a time of a day stands for (ms). */
function momentOf(day: string, time: string): number {
  const date = new Date(dayStart(day) ?? 0)
  const [hours, minutes] = time.split(':').map(Number)
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

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
  const drag = useDragSource(task)
  const classes = ['cal-item', 'is-task']
  if (overdue) classes.push('is-overdue')
  if (drag.draggable) classes.push('is-movable')
  return (
    <span className={classes.join(' ')} title={task.title} {...drag}>
      <span className="cal-ring" />
      {task.time && task.due && <span className="cal-item-time">{shortClock(momentOf(task.due, task.time))}</span>}
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
  const planner = use(PlannerContext)
  // Dropped on another day of the month, a task keeps its time.
  const target = useDropTarget(() => planner?.drop(day, undefined))
  const classes = ['cal-day']
  if (outside) classes.push('is-outside')
  if (day === today) classes.push('is-today')
  if (selected) classes.push('is-selected')
  if (target.over) classes.push('is-drop')

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    onPick(day)
    // An empty day is a place to put a task.
    if (total === 0) planner?.add(day, null, { x: event.clientX, y: event.clientY })
  }

  return (
    <div className={classes.join(' ')} onClick={onClick} {...target.props}>
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
  // Tasks due at an hour are in the hours below.
  const untimed = agenda.tasks.filter((task) => !task.time)
  const total = bands.length + untimed.length
  const room = total > DAY_LINES ? DAY_LINES - 1 : total
  const events = bands.slice(0, room)
  const tasks = untimed.slice(0, room - events.length)
  const planner = use(PlannerContext)
  // Dropped at the top of a day, a task is due that day, at no hour.
  const target = useDropTarget(() => planner?.drop(day, null))
  const classes = ['cal-week-head']
  if (day === today) classes.push('is-today')
  if (selected) classes.push('is-selected')
  if (target.over) classes.push('is-drop')

  return (
    <div className={classes.join(' ')} onClick={() => onPick(day)} {...target.props}>
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
  // Events and the tasks due at an hour share the lanes: a task is half an hour long, as drawn.
  const timed = useMemo(() => {
    const items: Slot[] = agenda.events.map((event) => ({ event, start: event.start, end: event.end, allDay: event.allDay }))
    for (const task of agenda.tasks) {
      if (!task.time) continue
      const start = momentOf(day, task.time)
      items.push({ task, start, end: start + 30 * 60_000, allDay: false })
    }
    return dayTimeline(items, from, to)
  }, [agenda.events, agenda.tasks, day, from, to])
  const clock = new Date(now)
  const planner = use(PlannerContext)
  const [guide, setGuide] = useState<string | null>(null)
  const timeAt = (event: { clientY: number; currentTarget: HTMLElement }, step = 15): string => {
    const box = event.currentTarget.getBoundingClientRect()
    return slotTime(event.clientY - box.top, box.height, step)
  }
  const target = useDropTarget(
    (event) => planner?.drop(day, timeAt(event)),
    (event) => setGuide(timeAt(event))
  )
  const classes = ['cal-week-col']
  if (day === today) classes.push('is-today')
  if (selected) classes.push('is-selected')

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    onPick(day)
    // An empty hour is a place to put a task, on the half hour clicked.
    if (event.target === event.currentTarget) planner?.add(day, timeAt(event, 30), { x: event.clientX, y: event.clientY })
  }

  return (
    <div className={classes.join(' ')} onClick={onClick} {...target.props}>
      {target.over && guide && (
        <span
          className="cal-drop-guide"
          style={{ top: `${((Number(guide.slice(0, 2)) * 60 + Number(guide.slice(3))) / DAY_MINUTES) * 100}%` }}
        >
          <span className="cal-drop-time">{shortClock(momentOf(day, guide))}</span>
        </span>
      )}
      {timed.map(({ event: item, start, end, lane, lanes }) => {
        const place = {
          top: `${(start / DAY_MINUTES) * 100}%`,
          height: `${((end - start) / DAY_MINUTES) * 100}%`,
          left: `${(lane / lanes) * 100}%`,
          width: `${100 / lanes}%`
        }
        if (item.task) return <TaskBlock key={`task:${item.task.id}`} task={item.task} day={day} today={today} place={place} />
        const event = item.event
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
                ...place,
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

/** What the hours of a day hold: an event, or a task due at an hour. */
type Slot = { start: number; end: number; allDay: boolean } & (
  | { event: BriefingEvent; task?: undefined }
  | { task: BriefingTask; event?: undefined }
)

/** A task due at an hour, in the week: half an hour tall, with its ring. */
function TaskBlock({ task, day, today, place }: { task: BriefingTask; day: string; today: string; place: CSSProperties }): JSX.Element {
  const drag = useDragSource(task)
  const classes = ['cal-block', 'is-task', 'is-short']
  if (day < today) classes.push('is-overdue')
  if (drag.draggable) classes.push('is-movable')
  return (
    <span className={classes.join(' ')} title={task.title} style={place} {...drag}>
      <span className="cal-ring" />
      <span className="cal-block-title">{task.title}</span>
      {task.time && <span className="cal-block-time">{shortClock(momentOf(day, task.time))}</span>}
    </span>
  )
}

/** The quick add of the calendar: a task due on the day (and at the hour) clicked. */
function CalendarQuickAdd({
  day,
  time,
  today,
  title,
  placeholder,
  onClose
}: {
  day: string
  time: string | null
  today: string
  title: string
  placeholder: string
  onClose: () => void
}): JSX.Element {
  const resolved = useResolvedDatabase(TASKS_DATABASE_ID, false)
  const { schema } = useMemo(() => L.normalizeResolved(resolved), [resolved])
  const defaults = useMemo(() => ({ [TASK_PROPS.due]: { start: time ? `${day}T${time}` : day } }), [day, time])
  const box = useRef<HTMLDivElement>(null)
  const ready = resolved?.status === 'ok'
  // The popover is shown once it has been placed: the input can take the focus right after.
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => box.current?.querySelector('input')?.focus(), 30)
    return () => clearTimeout(timer)
  }, [ready])
  return (
    <div className="cal-quickadd" ref={box}>
      <p className="cal-quickadd-title">{title}</p>
      {ready ? (
        <QuickAdd
          list={{ kind: 'inbox' }}
          today={today}
          projects={L.optionsOf(L.propOf(schema, TASK_PROPS.project))}
          labels={L.optionsOf(L.propOf(schema, TASK_PROPS.labels))}
          defaults={defaults}
          placeholder={placeholder}
          onAdded={onClose}
          onCancel={onClose}
        />
      ) : (
        <p className="today-quiet">…</p>
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
  const copy = CAL_COPY[useHome((state) => state.locale)]
  // While other days are on their way, what is held belongs to the ones before: these stay empty.
  const agenda = data && data.from === from && data.to === to ? data : null
  // Tasks just moved, where they went, until the agenda read again says so itself.
  const [moved, setMoved] = useState<ReadonlyMap<string, { due: string; time?: string }>>(() => new Map())
  useEffect(() => {
    if (data) setMoved(new Map())
  }, [data])
  const byDay = useMemo(
    () =>
      agendaByDay(
        days.map((day) => day.date),
        agenda?.events ?? [],
        (agenda?.tasks ?? [])
          .filter((task) => !done.has(tickedKey(task)))
          .map((task) => {
            const place = moved.get(task.id)
            if (!place) return task
            const shifted: BriefingTask = { ...task, due: place.due }
            if (place.time) shifted.time = place.time
            else delete shifted.time
            return shifted
          })
      ),
    [days, agenda, done, moved]
  )

  // ---- moving tasks, and putting them back ----
  const [dragging, setDragging] = useState<BriefingTask | null>(null)
  const undo = useRef<Move[]>([])
  const article = useRef<HTMLElement>(null)

  const putBack = useCallback(
    (move: Move): void => {
      undo.current = undo.current.filter((entry) => entry !== move)
      undoMove(move).then(
        () => toast(copy.undone),
        (error: unknown) => notifyError(copy.undoFailed, error)
      )
    },
    [copy]
  )

  const drop = useCallback<Drop>(
    (day, time) => {
      const task = dragging
      setDragging(null)
      if (!task) return
      const at = time === undefined ? task.time : (time ?? undefined)
      setMoved((current) => new Map(current).set(task.id, at ? { due: day, time: at } : { due: day }))
      moveTask(task, day, time).then(
        (move) => {
          if (!move) return
          undo.current = [...undo.current.slice(-19), move]
          const when = at ? `${longDate(day)}, ${shortClock(momentOf(day, at))}` : longDate(day)
          toast(copy.moved(when), { action: { label: copy.undo, run: () => putBack(move) } })
        },
        (error: unknown) => {
          setMoved((current) => {
            const next = new Map(current)
            next.delete(task.id)
            return next
          })
          notifyError(copy.moveFailed, error)
        }
      )
    },
    [dragging, copy, putBack]
  )

  // Ctrl+Z (outside a text field) puts the last task moved back.
  useEffect(() => {
    const onUndoKey = (event: globalThis.KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable]')))
        return
      // Only while this calendar is the one on screen.
      if (!article.current?.isConnected || article.current.offsetParent === null) return
      const last = undo.current[undo.current.length - 1]
      if (!last) return
      event.preventDefault()
      putBack(last)
    }
    window.addEventListener('keydown', onUndoKey)
    return () => window.removeEventListener('keydown', onUndoKey)
  }, [putBack])

  const [adding, setAdding] = useState<{ day: string; time: string | null; point: { x: number; y: number } } | null>(null)
  const planner = useMemo<Planner>(
    () => ({
      dragging,
      dragHint: copy.dragHint,
      // Changing the page while a drag starts can end it at once: right after is soon enough.
      startDrag: (task) => setTimeout(() => setDragging(task), 0),
      endDrag: () => setDragging(null),
      drop,
      add: (day, time, point) => setAdding({ day, time, point })
    }),
    [dragging, copy, drop]
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
    <PlannerContext value={planner}>
      <article className="cal" aria-label="Calendar" ref={article}>
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
        <Popover open={!!adding} anchor={adding?.point ?? null} onClose={() => setAdding(null)}>
          {adding && (
            <CalendarQuickAdd
              key={`${adding.day}T${adding.time ?? ''}`}
              day={adding.day}
              time={adding.time}
              today={today}
              title={copy.newTask(
                adding.time ? `${longDate(adding.day)}, ${shortClock(momentOf(adding.day, adding.time))}` : longDate(adding.day)
              )}
              placeholder={copy.placeholder}
              onClose={() => setAdding(null)}
            />
          )}
        </Popover>
      </article>
    </PlannerContext>
  )
}
