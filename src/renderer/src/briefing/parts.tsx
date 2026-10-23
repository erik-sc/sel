// What the Today screen and the calendar screen have in common: how they keep what they show
// current, and the rows an event and a task are drawn as. Styled by today.css; the rows of the
// built-in Tasks database are the task lists' own (tasks/TaskRow.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { localDay, type BriefingCalendar, type BriefingEvent, type BriefingTask } from '@shared/briefing'
import type { Block } from '@shared/types'
import { TASKS_DATABASE_ID } from '@shared/tasks'
import { newMeeting } from '@/meetings/gate'
import { useBlock, useBlocks } from '@/store/blocks'
import { openPage } from '@/store/tabs'
import * as L from '@/database/logic'
import { emptyChipsOf, readTasks } from '@/tasks/lists'
import { viewOfBriefing, type TaskView } from '@/tasks/model'
import { TaskRow as ListTaskRow, type RowDrag, type useTaskRows } from '@/tasks/TaskRow'
import { setSettingsOpen, useUi } from '@/store/ui'
import { notifyError, toast } from '@/ui/toast'
import { dueLabel, tickedKey, untilMidnight, type EventMoment } from './format'
import { requestTodaySettings } from './route'

/** Data older than this is fetched again when the window gets the focus back. */
const STALE_MS = 10 * 60_000
/** Changes to pages arrive in bursts while someone types: one reload after they settle. */
const CHANGE_DEBOUNCE_MS = 500

export interface Live<T> {
  data: T | null
  failed: boolean
  refreshing: boolean
  /** Reads again, the calendars included. */
  refresh: () => void
  /** Changes what is shown without reading again. */
  update: (change: (data: T) => T) => void
}

/**
 * Loads what `read` returns and keeps it current: on change events, on focus, at midnight, on
 * request, and again whenever `read` itself changes. `what` names it in the log.
 */
export function useLive<T>(read: (force: boolean) => Promise<T>, what: string): Live<T> {
  const [state, setState] = useState<{ data: T | null; failed: boolean; refreshing: boolean }>({
    data: null,
    failed: false,
    refreshing: false
  })
  const alive = useRef(true)
  const latest = useRef(0)
  const loadedAt = useRef(0)

  const load = useCallback(
    (force: boolean): void => {
      const ticket = ++latest.current
      if (force) setState((current) => ({ ...current, refreshing: true }))
      read(force).then(
        (data) => {
          if (!alive.current || ticket !== latest.current) return
          loadedAt.current = Date.now()
          setState({ data, failed: false, refreshing: false })
        },
        (error: unknown) => {
          if (!alive.current || ticket !== latest.current) return
          console.error(`${what} failed to load`, error)
          setState((current) => ({ data: current.data, failed: true, refreshing: false }))
        }
      )
    },
    [read, what]
  )

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
  const update = useCallback((change: (data: T) => T) => {
    setState((current) => (current.data ? { ...current, data: change(current.data) } : current))
  }, [])
  return { ...state, refresh, update }
}

/** The current time, refreshed every half minute: what is "now" and "next" follows the clock. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function Lines({ count = 3 }: { count?: number }): JSX.Element {
  return (
    <div className="today-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} />
      ))}
    </div>
  )
}

export function openSettings(): void {
  requestTodaySettings()
  setSettingsOpen(true)
}

/** One event of an agenda (a row of a `today-agenda` list). `time` is how its hours read on the day it is listed under. */
export function EventRow({
  event,
  calendar,
  moment,
  time
}: {
  event: BriefingEvent
  calendar: BriefingCalendar | undefined
  moment: EventMoment
  time: string
}): JSX.Element {
  return (
    <li className={`today-event is-${moment}`}>
      <span className="today-event-time">{time}</span>
      <span
        className="today-dot"
        style={{ background: `var(--c-${calendar?.color ?? 'gray'})` }}
        role="img"
        aria-label={calendar?.label ?? 'Calendar'}
        title={calendar?.label}
      />
      <span className="today-event-body">
        <span className="today-event-title">
          {event.title || 'Untitled'}
          {(moment === 'now' || moment === 'next') && <span className="today-event-mark">{moment === 'now' ? 'Now' : 'Next'}</span>}
        </span>
        {event.location && <span className="today-event-meta">{event.location}</span>}
      </span>
      {!event.allDay && moment !== 'past' && (
        <button
          type="button"
          className="today-event-notes"
          onClick={() =>
            void newMeeting({
              event: {
                title: event.title,
                start: event.start,
                end: event.end,
                ...(event.uid ? { uid: event.uid } : {}),
                ...(event.location ? { location: event.location } : {}),
                ...(event.description ? { description: event.description } : {})
              }
            })
          }
        >
          Take notes
        </button>
      )}
    </li>
  )
}

/**
 * The built-in Tasks database's tasks among `tasks`, as their rows draw them: from the store once
 * it has them (an edit shows at once), from the briefing until then. Null for one that is gone.
 * Other tasks are not in the map: they keep their plain row.
 */
export function useTaskViews(tasks: readonly BriefingTask[]): ReadonlyMap<string, TaskView | null> {
  const ids = useMemo(() => tasks.filter((task) => viewOfBriefing(task)).map((task) => task.id), [tasks])
  const blocks = useBlocks(ids)
  const database = useBlock(ids.length ? TASKS_DATABASE_ID : null)
  return useMemo(() => {
    const schema = L.normalizeDatabase(database).schema
    const rows = blocks.filter((block): block is Block => !!block && block.parentId === TASKS_DATABASE_ID)
    const live = new Map(database ? readTasks(rows, schema).map((item) => [item.id, item]) : [])
    const views = new Map<string, TaskView | null>()
    for (const task of tasks) {
      const view = viewOfBriefing(task)
      if (!view) continue
      const row = rows.find((block) => block.id === task.id)
      views.set(task.id, row?.trashedAt || live.get(task.id)?.done ? null : (live.get(task.id) ?? view))
    }
    return views
  }, [tasks, blocks, database])
}

/**
 * One open task of a briefing list: a row of the built-in Tasks database with its chips and
 * editors (`view`), any other as a plain row. `day` is the day it is listed under.
 */
export function BriefingTaskItem({
  task,
  view,
  day,
  today,
  rows,
  panel,
  onComplete,
  onOpen,
  drag
}: {
  task: BriefingTask
  view: TaskView | null | undefined
  day: string
  today: string
  rows: ReturnType<typeof useTaskRows>
  /** The task the panel shows. */
  panel: string | null
  onComplete: (task: BriefingTask) => void
  onOpen: (id: string) => void
  /** Makes the row something to drag onto the day's plan. */
  drag?: RowDrag
}): JSX.Element | null {
  if (view === null) return null
  if (!view) return <TaskRow task={task} day={day} onComplete={onComplete} drag={drag} />
  return (
    <ListTaskRow
      task={view}
      today={today}
      heading={day}
      tabStop={rows.stop === task.id}
      current={panel === task.id}
      onToggle={() => onComplete(task)}
      onOpen={() => onOpen(task.id)}
      onLeave={rows.leave}
      emptyChips={emptyChipsOf(view)}
      drag={drag}
    />
  )
}

/** One open task. `day` is the day it is listed under: a due date is only spelled out when it is another one. */
export function TaskRow({
  task,
  day,
  onComplete,
  drag
}: {
  task: BriefingTask
  day: string
  onComplete: (task: BriefingTask) => void
  drag?: RowDrag
}): JSX.Element {
  return (
    <li className="today-task" {...drag}>
      <button type="button" className="today-check" aria-label={`Mark "${task.title}" as done`} onClick={() => onComplete(task)} />
      <button
        type="button"
        className="today-task-open"
        onClick={(event) => openPage(task.pageId, { newTab: event.ctrlKey || event.metaKey })}
      >
        <span className="today-task-title">{task.title}</span>
        <span className="today-task-meta">
          {[task.source, task.due && task.due !== day ? dueLabel(task.due, day) : '', task.priority?.name].filter(Boolean).join(' · ')}
        </span>
      </button>
    </li>
  )
}

/**
 * Marking tasks done from a list. `done` holds the `tickedKey` of those ticked here, to hide at
 * once; the next load no longer has them, or has a repeating one on its next date. A toast
 * offers to take it back.
 */
export function useCompleteTask(): { done: ReadonlySet<string>; complete: (task: BriefingTask) => void } {
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set())

  const complete = useCallback((task: BriefingTask): void => {
    const key = tickedKey(task)
    setDone((current) => new Set(current).add(key))
    const restore = (): void =>
      setDone((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    window.api.briefing.completeTask(task.id).then(
      ({ token, next }) => {
        // A repeating task stays open with a later date: it is off today's list all the same.
        toast(next ? `Done. Next: ${dueLabel(next.slice(0, 10), localDay())}.` : 'Marked as done.', {
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
  }, [])

  return { done, complete }
}
