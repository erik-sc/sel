// The day's plan on the Today screen (0.8.0 E2): the calendar's events and the tasks' time blocks
// side by side on the same hours. A task dragged from the open tasks onto the hours becomes a
// block (its due date gets a start and an end, shared/tasks/blocks.ts); a block can be dragged
// to another time, made longer or shorter by its lower edge, and taken off the plan. Ctrl+Z and
// the toast's Undo put it back. Nothing is ever written to a calendar: the block lives on the task.
//
// From the keyboard: "Schedule…" opens a small form (task, time, length), and a focused block
// moves with the arrows, changes its length with Shift+arrows and leaves the plan with Delete.
import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, FormEvent, JSX, KeyboardEvent, PointerEvent } from 'react'
import type { Briefing, BriefingTask } from '@shared/briefing'
import {
  BLOCK_STEP,
  DEFAULT_BLOCK_MINUTES,
  clockOf,
  freeSpans,
  minutesOf,
  moveBlock,
  placeBlock,
  resizeBlock,
  snap,
  type Span,
  type TimeBlock
} from '@shared/tasks/blocks'
import { announce } from '@/a11y/announce'
import { useHome } from '@/home/store'
import { notifyError, toast } from '@/ui/toast'
import { dayStart, nextDayStart, shortClock } from './format'
import { lengthLabel, planBlocks, planEvents, planLoad, planWindow, unplannedTasks, withLanes, type PlanBlock } from './plan'
import { blockTask, canMove, undoMove, unblockTask, type Move } from './reschedule'
import './plan.css'

/** Pixels per minute of the plan: 48 px an hour. */
const PX = 0.8
const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240] as const

const PLAN_COPY = {
  en: {
    title: 'Plan',
    calendar: 'Calendar',
    blocks: 'Blocks',
    schedule: 'Schedule…',
    hint: 'Drag a task here to give it a time. Nothing is written to your calendars.',
    task: 'Task',
    at: 'At',
    length: 'Length',
    add: 'Put on the plan',
    cancel: 'Cancel',
    noTasks: 'No open task to schedule.',
    placed: (title: string, when: string) => `${title}: ${when}.`,
    unplanned: (title: string) => `${title} is off the plan.`,
    undo: 'Undo',
    undone: 'Put back.',
    failed: 'Could not change the plan.',
    undoFailed: 'Could not put it back.',
    blockLabel: (title: string, when: string) => `${title}, ${when}`,
    blockKeys: 'Arrows move it, Shift with the arrows changes its length, Delete takes it off the plan.',
    resize: 'Drag to change the length',
    over: (wanted: string, free: string) => `The day holds more than fits: about ${wanted} of tasks without a time, and ${free} free.`,
    overlap: 'Some blocks sit on top of other things. That may be fine, or the day may be fuller than it looks.',
    due: 'due at this time'
  },
  'pt-BR': {
    title: 'Plano',
    calendar: 'Agenda',
    blocks: 'Blocos',
    schedule: 'Agendar…',
    hint: 'Arraste uma tarefa para cá para dar um horário a ela. Nada é escrito nas suas agendas.',
    task: 'Tarefa',
    at: 'Às',
    length: 'Duração',
    add: 'Pôr no plano',
    cancel: 'Cancelar',
    noTasks: 'Nenhuma tarefa aberta para agendar.',
    placed: (title: string, when: string) => `${title}: ${when}.`,
    unplanned: (title: string) => `${title} saiu do plano.`,
    undo: 'Desfazer',
    undone: 'Voltou para onde estava.',
    failed: 'Não foi possível mudar o plano.',
    undoFailed: 'Não foi possível desfazer.',
    blockLabel: (title: string, when: string) => `${title}, ${when}`,
    blockKeys: 'As setas movem, Shift com as setas muda a duração, Delete tira do plano.',
    resize: 'Arraste para mudar a duração',
    over: (wanted: string, free: string) => `O dia tem mais do que cabe: umas ${wanted} de tarefas sem horário, e ${free} livres.`,
    overlap: 'Alguns blocos estão em cima de outras coisas. Pode estar tudo bem, ou o dia está mais cheio do que parece.',
    due: 'com hora marcada'
  }
}

export type PlanCopy = (typeof PLAN_COPY)['en']

/** What is being dragged onto the plan: a task, and where it was held (minutes from a block's start; 0 from the list). */
export interface PlanDragging {
  task: BriefingTask
  grab: number
}

export interface PlanDrag {
  dragging: PlanDragging | null
  start: (task: BriefingTask, grab?: number) => void
  end: () => void
}

/** The drag shared by the open tasks (where tasks come from) and the plan (where they go). */
export function usePlanDrag(): PlanDrag {
  const [dragging, setDragging] = useState<PlanDragging | null>(null)
  const start = useCallback((task: BriefingTask, grab = 0) => setDragging({ task, grab }), [])
  const end = useCallback(() => setDragging(null), [])
  return useMemo(() => ({ dragging, start, end }), [dragging, start, end])
}

/** The props that let a task of a list be dragged onto the plan, or none when it cannot have a time. */
export function planDragSource(
  drag: PlanDrag,
  task: BriefingTask
): { draggable: true; onDragStart: (event: DragEvent<HTMLElement>) => void; onDragEnd: () => void } | undefined {
  if (!canMove(task)) return undefined
  return {
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', task.title)
      drag.start(task)
    },
    onDragEnd: drag.end
  }
}

/** What changed on a task, to show at once (see plan.ts patchTasks). */
export type PlanPatch = (id: string, change: { due: string; time?: string | null; minutes?: number | null }) => void

/** A minute of the day as the clock of the locale says it ("9:30am", "09:30"). */
function timeLabel(day: string, minute: number): string {
  return shortClock((dayStart(day) ?? 0) + minute * 60_000)
}

function span(block: TimeBlock): string {
  return `${timeLabel(block.day, block.start)}–${timeLabel(block.day, block.start + block.minutes)}`
}

function blockFrom(item: PlanBlock, day: string): TimeBlock {
  return { day, start: item.start, minutes: item.end - item.start }
}

export function DayPlan({
  briefing,
  now,
  drag,
  onPatch,
  onOpen
}: {
  briefing: Briefing
  now: number
  drag: PlanDrag
  onPatch: PlanPatch
  onOpen: (id: string) => void
}): JSX.Element {
  const words = PLAN_COPY[useHome((state) => state.locale)]
  const day = briefing.date
  const from = dayStart(day) ?? 0
  const to = nextDayStart(from)
  const events = useMemo(() => planEvents(briefing.events.today, from, to), [briefing.events.today, from, to])
  const blocks = useMemo(() => planBlocks(briefing.tasks.today, day), [briefing.tasks.today, day])
  const clock = new Date(now)
  const isToday = now >= from && now < to
  const minuteNow = isToday ? clock.getHours() * 60 + clock.getMinutes() : undefined
  const range = useMemo(() => planWindow([...events, ...blocks]), [events, blocks])
  const load = useMemo(() => planLoad(events, blocks, briefing.tasks, day, minuteNow), [events, blocks, briefing.tasks, day, minuteNow])
  const body = useRef<HTMLDivElement>(null)
  const undos = useRef<Move[]>([])
  const [guide, setGuide] = useState<number | null>(null)
  const [resizing, setResizing] = useState<{ id: string; minutes: number } | null>(null)
  const [form, setForm] = useState(false)

  /** What is busy besides the task `except`: the events and the other blocks. */
  const busyBut = (except: string | null): Span[] => [
    ...events.map(({ start, end }) => ({ start, end })),
    ...blocks.filter((item) => item.task.id !== except).map(({ start, end }) => ({ start, end }))
  ]

  const undo = (move: Move): void => {
    undos.current = undos.current.filter((each) => each !== move)
    undoMove(move).then(
      () => announce(words.undone),
      (error: unknown) => notifyError(words.undoFailed, error)
    )
  }

  /** Writes a block (shown at once), remembers how to undo it, and says so when `tell`. */
  const commit = (task: BriefingTask, block: TimeBlock, tell: boolean): void => {
    onPatch(task.id, { due: block.day, time: clockOf(block.start), minutes: block.minutes })
    const when = span(block)
    if (!tell) announce(words.placed(task.title, when))
    blockTask(task, block).then(
      (move) => {
        if (!move) return
        undos.current.push(move)
        if (tell) toast(words.placed(task.title, when), { action: { label: words.undo, run: () => undo(move) } })
      },
      (error: unknown) => notifyError(words.failed, error)
    )
  }

  const unplan = (task: BriefingTask): void => {
    onPatch(task.id, { due: day, time: null, minutes: null })
    announce(words.unplanned(task.title))
    unblockTask(task, day).then(
      (move) => {
        if (!move) return
        undos.current.push(move)
        toast(words.unplanned(task.title), { action: { label: words.undo, run: () => undo(move) } })
      },
      (error: unknown) => notifyError(words.failed, error)
    )
  }

  // ---- dropping ----

  const minuteAt = (clientY: number): number => {
    const box = body.current?.getBoundingClientRect()
    return range.start + (box ? (clientY - box.top) / PX : 0)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!drag.dragging) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setGuide(Math.max(range.start, snap(minuteAt(event.clientY) - drag.dragging.grab)))
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    const dragging = drag.dragging
    setGuide(null)
    if (!dragging) return
    event.preventDefault()
    drag.end()
    const at = minuteAt(event.clientY) - dragging.grab
    const existing = blocks.find((item) => item.task.id === dragging.task.id)
    const block =
      existing && existing.sized
        ? moveBlock(blockFrom(existing, day), at)
        : placeBlock(day, at, busyBut(dragging.task.id), dragging.task.minutes ?? DEFAULT_BLOCK_MINUTES)
    if (block) commit(dragging.task, block, true)
  }

  // ---- resizing, by the lower edge ----

  const resizeStart = (event: PointerEvent<HTMLSpanElement>, item: PlanBlock): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setResizing({ id: item.task.id, minutes: item.end - item.start })
  }
  const resizeMove = (event: PointerEvent<HTMLSpanElement>, item: PlanBlock): void => {
    if (resizing?.id !== item.task.id) return
    const next = resizeBlock(blockFrom(item, day), minuteAt(event.clientY))
    if (next.minutes !== resizing.minutes) setResizing({ id: item.task.id, minutes: next.minutes })
  }
  const resizeEnd = (item: PlanBlock): void => {
    if (resizing?.id !== item.task.id) return
    const minutes = resizing.minutes
    setResizing(null)
    // `item` is drawn at the length being dragged to: what it was is in `blocks`.
    const before = blocks.find((each) => each.task.id === item.task.id) ?? item
    if (minutes !== before.end - before.start || !before.sized) commit(item.task, { day, start: before.start, minutes }, true)
  }

  // ---- the keyboard ----

  const onBlockKey = (event: KeyboardEvent<HTMLDivElement>, item: PlanBlock): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const block = blockFrom(item, day)
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(item.task.id)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      unplan(item.task)
      return
    }
    const step = event.key === 'ArrowUp' ? -BLOCK_STEP : event.key === 'ArrowDown' ? BLOCK_STEP : 0
    if (!step) return
    event.preventDefault()
    const next = event.shiftKey ? resizeBlock(block, block.start + block.minutes + step) : moveBlock(block, block.start + step)
    if (next.start !== block.start || next.minutes !== block.minutes || !item.sized) commit(item.task, next, false)
  }

  const onSectionKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
    const target = event.target as HTMLElement
    if (target.closest('input, select, textarea, [contenteditable]')) return
    const move = undos.current[undos.current.length - 1]
    if (!move) return
    event.preventDefault()
    undo(move)
  }

  // ---- drawing ----

  const height = (range.end - range.start) * PX
  const top = (minute: number): number => (minute - range.start) * PX
  const hours: number[] = []
  for (let hour = Math.ceil(range.start / 60); hour * 60 < range.end; hour++) hours.push(hour)
  const labelOf = (minute: number): string => timeLabel(day, minute)
  const placedEvents = withLanes(events)
  const placedBlocks = withLanes(
    blocks.map((item) => (resizing?.id === item.task.id ? { ...item, end: item.start + resizing.minutes } : item))
  )

  return (
    <section className="today-section today-plan" aria-labelledby="today-plan" onKeyDown={onSectionKey}>
      <div className="plan-top">
        <h2 className="today-label" id="today-plan">
          {words.title}
        </h2>
        <button type="button" className="today-link" aria-expanded={form} onClick={() => setForm((open) => !open)}>
          {words.schedule}
        </button>
      </div>
      {form && (
        <ScheduleForm
          words={words}
          day={day}
          tasks={[...unplannedTasks(briefing.tasks, day), ...blocks.map((item) => item.task)].filter(canMove)}
          suggest={(minutes) => {
            const start = Math.max(range.start, minuteNow === undefined ? 0 : Math.ceil(minuteNow / BLOCK_STEP) * BLOCK_STEP)
            const free = freeSpans(busyBut(null), start, Math.max(range.end, start + minutes))
            return (free.find((each) => each.end - each.start >= minutes) ?? free[0])?.start ?? start
          }}
          onSubmit={(task, block) => {
            setForm(false)
            commit(task, block, true)
          }}
          onCancel={() => setForm(false)}
        />
      )}
      <div className="plan" style={{ '--plan-height': `${height}px` } as CSSProperties}>
        <div className="plan-heads" aria-hidden="true">
          <span />
          <span className="plan-head">{words.calendar}</span>
          <span className="plan-head">{words.blocks}</span>
        </div>
        <div
          ref={body}
          className={drag.dragging ? 'plan-body is-dropping' : 'plan-body'}
          onDragOver={onDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGuide(null)
          }}
          onDrop={onDrop}
        >
          <div className="plan-gutter" aria-hidden="true">
            {hours.map((hour) => (
              <span key={hour} className="plan-hour" style={{ top: top(hour * 60) }}>
                {labelOf(hour * 60)}
              </span>
            ))}
          </div>
          <ul className="plan-col is-events" aria-label={words.calendar}>
            {placedEvents.map((item) => {
              const color = briefing.events.calendars.find((calendar) => calendar.id === item.event.calendarId)?.color ?? 'gray'
              const past = minuteNow !== undefined && item.end <= minuteNow
              return (
                <li
                  key={item.event.id}
                  className={['plan-event', past ? 'is-past' : '', item.end - item.start < 45 ? 'is-short' : ''].filter(Boolean).join(' ')}
                  style={
                    {
                      top: top(item.start),
                      height: Math.max((item.end - item.start) * PX, 14),
                      left: `${(item.lane / item.lanes) * 100}%`,
                      width: `${100 / item.lanes}%`,
                      '--block': `var(--c-${color})`,
                      '--block-bg': `var(--c-${color}-bg)`
                    } as CSSProperties
                  }
                >
                  <span className="plan-time">{`${labelOf(item.start)}–${labelOf(item.end)}`}</span>
                  <span className="plan-title">{item.event.title || 'Untitled'}</span>
                </li>
              )
            })}
          </ul>
          <ul className="plan-col is-blocks" aria-label={words.blocks}>
            {placedBlocks.map((item) => {
              const block = blockFrom(item, day)
              const when = item.sized ? span(block) : `${labelOf(item.start)}, ${words.due}`
              const movable = canMove(item.task)
              const classes = ['plan-block']
              if (!item.sized) classes.push('is-point')
              if (item.end - item.start < 45) classes.push('is-short')
              if (resizing?.id === item.task.id) classes.push('is-resizing')
              return (
                <li
                  key={item.task.id}
                  className={classes.join(' ')}
                  style={{
                    top: top(item.start),
                    height: Math.max((item.end - item.start) * PX, 14),
                    left: `${(item.lane / item.lanes) * 100}%`,
                    width: `${100 / item.lanes}%`
                  }}
                >
                  <div
                    className="plan-block-main"
                    role="button"
                    tabIndex={0}
                    aria-label={words.blockLabel(item.task.title, when)}
                    aria-description={movable ? words.blockKeys : undefined}
                    aria-keyshortcuts={movable ? 'ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown Delete Enter' : 'Enter'}
                    draggable={movable}
                    onDragStart={(event) => {
                      if (!movable) return
                      const box = event.currentTarget.getBoundingClientRect()
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', item.task.title)
                      drag.start(item.task, Math.max(0, (event.clientY - box.top) / PX))
                    }}
                    onDragEnd={drag.end}
                    onClick={() => onOpen(item.task.id)}
                    onKeyDown={(event) => (movable ? onBlockKey(event, item) : undefined)}
                  >
                    <span className="plan-time">{item.sized ? span(block) : labelOf(item.start)}</span>
                    <span className="plan-title">{item.task.title}</span>
                    {item.sized && item.end - item.start >= 45 && <span className="plan-length">{lengthLabel(item.end - item.start)}</span>}
                  </div>
                  {movable && (
                    <span
                      className="plan-resize"
                      aria-hidden="true"
                      title={words.resize}
                      onPointerDown={(event) => resizeStart(event, item)}
                      onPointerMove={(event) => resizeMove(event, item)}
                      onPointerUp={() => resizeEnd(item)}
                      onPointerCancel={() => setResizing(null)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
          {minuteNow !== undefined && minuteNow >= range.start && minuteNow <= range.end && (
            <span className="plan-now" style={{ top: top(minuteNow) }} />
          )}
          {guide !== null && drag.dragging && (
            <span className="plan-guide" style={{ top: top(guide) }}>
              <span className="plan-guide-time">{labelOf(guide)}</span>
            </span>
          )}
        </div>
      </div>
      {blocks.length === 0 && <p className="today-quiet plan-hint">{words.hint}</p>}
      {load.over && (
        <p className="today-note plan-note" role="status">
          {load.wanted > load.free ? words.over(lengthLabel(load.wanted), lengthLabel(load.free)) : words.overlap}
        </p>
      )}
    </section>
  )
}

/** The keyboard's way to put a task on the plan: which task, at what time, for how long. */
function ScheduleForm({
  words,
  day,
  tasks,
  suggest,
  onSubmit,
  onCancel
}: {
  words: PlanCopy
  day: string
  tasks: readonly BriefingTask[]
  suggest: (minutes: number) => number
  onSubmit: (task: BriefingTask, block: TimeBlock) => void
  onCancel: () => void
}): JSX.Element {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? '')
  const task = tasks.find((each) => each.id === taskId)
  const [minutes, setMinutes] = useState<number>(task?.minutes ?? DEFAULT_BLOCK_MINUTES)
  const [time, setTime] = useState(() => clockOf(suggest(minutes)))

  if (!tasks.length) {
    return (
      <div className="plan-form">
        <p className="today-quiet">{words.noTasks}</p>
        <button type="button" className="today-link" onClick={onCancel}>
          {words.cancel}
        </button>
      </div>
    )
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const start = minutesOf(time)
    if (!task || start === null) return
    onSubmit(task, { day, start, minutes })
  }

  return (
    <form
      className="plan-form"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <label className="plan-field is-task">
        <span className="plan-field-label">{words.task}</span>
        <select autoFocus value={taskId} onChange={(event) => setTaskId(event.target.value)}>
          {tasks.map((each) => (
            <option key={each.id} value={each.id}>
              {each.title}
            </option>
          ))}
        </select>
      </label>
      <label className="plan-field">
        <span className="plan-field-label">{words.at}</span>
        <input type="time" step={BLOCK_STEP * 60} value={time} required onChange={(event) => setTime(event.target.value)} />
      </label>
      <label className="plan-field">
        <span className="plan-field-label">{words.length}</span>
        <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
          {LENGTHS.map((each) => (
            <option key={each} value={each}>
              {lengthLabel(each)}
            </option>
          ))}
        </select>
      </label>
      <div className="plan-form-actions">
        <button type="submit" className="today-link">
          {words.add}
        </button>
        <button type="button" className="today-link" onClick={onCancel}>
          {words.cancel}
        </button>
      </div>
    </form>
  )
}
