// The refine mode (docs/plans/tasks-refine.md, 9c): the tasks still to refine, one at a time, on a
// card the keyboard drives. Enter goes to the next, S skips, Delete deletes (Undo on the message),
// Escape leaves; F2 edits the name with the quick-add parser, D the date (with its quick choices
// and "sex 15h"), R the repeat, 1–4 the priority, # the project, @ the labels. The walk and its
// keys are pure (./refineWalk.ts); the fields open the editors a row's chips open (./TaskEditors.tsx).
// At the end: "Inbox em dia." when nothing is left, and no score either way.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ruleText } from '@shared/rrule'
import { needsRefining } from '@shared/tasks/refine'
import { useHome } from '@/home/store'
import { announce } from '@/a11y/announce'
import { Button } from '@/ui/Button'
import type { PopoverAnchor } from '@/ui/Popover'
import { TASK_COPY, type TaskField } from './copy'
import { deleteTask, renameTask, setPriority } from './edit'
import type { RefineFrom } from './gate'
import { TaskFieldPopover } from './lazy'
import { dueLabel, type TaskItem } from './lists'
import { nextPriority } from './model'
import { currentTask, refineKeyAction, refineQueue, refineStep, startRefineState, type RefineCommand, type RefineState } from './refineWalk'
import { TitleEditor } from './TitleEditor'
import './refine.css'

/** The fields on the card, each with the key that opens it. */
const FIELDS: readonly { field: TaskField; key: string }[] = [
  { field: 'date', key: 'D' },
  { field: 'priority', key: '1–4' },
  { field: 'project', key: '#' },
  { field: 'labels', key: '@' },
  { field: 'repeat', key: 'R' }
]

const KEYS = 'Enter S Delete Escape ArrowLeft ArrowRight F2 D R 1 2 3 4 # @'

/** Where a key belongs to what has the focus, not to the walk: typing, and controls outside the card. */
const TYPING =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="dialog"], [role="menu"], [role="listbox"]'
const CONTROL = 'button, a[href], [role="button"], [role="tab"], [role="treeitem"], [role="option"]'

export interface RefineProps {
  /** The tasks as the screen reads them, kept current. */
  tasks: readonly TaskItem[]
  from: RefineFrom
  today: string
  onExit: () => void
}

export function Refine({ tasks, from, today, onExit }: RefineProps): JSX.Element {
  const locale = useHome((state) => state.locale)
  const words = TASK_COPY[locale]
  // The walk is taken when it starts: a task refined on the way keeps its place.
  const [state, setState] = useState<RefineState>(() => startRefineState(refineQueue(tasks, from)))
  const [editing, setEditing] = useState<{ field: TaskField; anchor: PopoverAnchor } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const section = useRef<HTMLElement>(null)
  const onKeyRef = useRef<((event: KeyboardEvent) => void) | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const fieldRefs = useRef<Partial<Record<TaskField, HTMLButtonElement | null>>>({})
  const headId = useId()

  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const id = currentTask(state)
  const task = id ? byId.get(id) : undefined

  // A task completed or deleted elsewhere while the card waited for it: on to the next.
  useEffect(() => {
    if (id && (!task || task.done)) setState((current) => refineStep(current, { kind: 'skip' }))
  }, [id, task])

  // Each new card takes the focus (and so is read out); the end, its Close button.
  useEffect(() => {
    if (state.done) closeRef.current?.focus({ preventScroll: true })
    else if (!renaming && !editing) card.current?.focus({ preventScroll: true })
  }, [state.done, state.index, id, renaming, editing])

  // The walk's keys are read from the whole window while a card shows, so they keep working when
  // the focus has left the card (a click beside it, a chip clicked, an editor closed by a click).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.defaultPrevented && !event.isComposing) onKeyRef.current?.(event)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const nothingLeft = state.queue.every((each) => {
    const item = byId.get(each)
    return !item || !needsRefining(item)
  })

  if (state.done || !task) {
    onKeyRef.current = null
    return (
      <section className="refine is-done" aria-labelledby={headId}>
        <h1 id={headId} className="tasks-heading">
          {words.refining}
        </h1>
        <div className="refine-card is-end">
          <p className="refine-end" role="status">
            {nothingLeft ? words.refineDone : words.refineLeft}
          </p>
          <Button
            ref={closeRef}
            onClick={onExit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onExit()
              } else if (event.key === 'ArrowLeft' && state.queue.length) {
                event.preventDefault()
                setState((current) => refineStep(current, { kind: 'back' }))
              }
            }}
          >
            {words.close}
          </Button>
        </div>
      </section>
    )
  }

  const title = task.title || words.untitled
  const value = (field: TaskField): string => {
    switch (field) {
      case 'date':
        return task.due ? dueLabel(task.due, today, undefined, words.days).text : ''
      case 'repeat':
        return task.recurrence ? ruleText(task.recurrence.rule, locale) : ''
      case 'priority':
        return task.priority ? `P${task.priority}` : ''
      case 'project':
        return task.project ? `#${task.project.name}` : ''
      case 'labels':
        return task.labels.map((label) => `@${label.name}`).join(' ')
      case 'remind':
        return task.remind ? dueLabel(task.remind, today, undefined, words.days).text : ''
    }
  }
  const edit = (field: TaskField): void => setEditing({ field, anchor: fieldRefs.current[field] ?? card.current })
  const progress = words.progress(state.index + 1, state.queue.length)

  const run = (command: RefineCommand): void => {
    switch (command.kind) {
      case 'exit':
        onExit()
        return
      case 'rename':
        setRenaming(true)
        return
      case 'edit':
        edit(command.field)
        return
      case 'priority': {
        const level = nextPriority(task.priority, command.level)
        setPriority(task.id, level)
        announce(level === null ? words.noPriority : words.priorityName(level))
        return
      }
      case 'delete':
        deleteTask(task.id)
        break
    }
    const next = refineStep(state, command)
    setState(next)
    const after = currentTask(next)
    const nextTask = after ? byId.get(after) : undefined
    if (nextTask) announce(`${words.progress(next.index + 1, next.queue.length)}: ${nextTask.title || words.untitled}`)
  }

  onKeyRef.current =
    renaming || editing
      ? null
      : (event) => {
          // Keys in the name being edited, in an editor, or on a control outside the card are theirs.
          const target = event.target instanceof Element ? event.target : null
          if (target?.closest(TYPING)) return
          if (target && !section.current?.contains(target) && target.closest(CONTROL)) return
          const command = refineKeyAction(event)
          if (!command) return
          event.preventDefault()
          event.stopPropagation()
          run(command)
        }

  return (
    <section ref={section} className="refine" aria-labelledby={headId}>
      <div className="refine-head">
        <h1 id={headId} className="tasks-heading">
          {words.refining}
        </h1>
        <span className="refine-progress">{progress}</span>
      </div>
      <div
        key={task.id}
        ref={card}
        className="refine-card"
        tabIndex={0}
        role="group"
        aria-label={words.rowLabel(
          title,
          FIELDS.map(({ field }) => words.change(words.field[field], value(field) || words.none))
        )}
        aria-keyshortcuts={KEYS}
      >
        {renaming ? (
          <TitleEditor
            className="refine-title-edit"
            initial={task.title}
            today={today}
            onCommit={(text, ignored) => {
              setRenaming(false)
              renameTask(task.id, text, ignored)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <button type="button" tabIndex={-1} className="refine-title" title={`${words.rename} (F2)`} onClick={() => setRenaming(true)}>
            {title}
          </button>
        )}
        <dl className="refine-fields">
          {FIELDS.map(({ field, key }) => {
            const shown = value(field)
            return (
              <div key={field} className="refine-field">
                <dt>
                  <kbd>{key}</kbd> {words.field[field]}
                </dt>
                <dd>
                  <button
                    type="button"
                    tabIndex={-1}
                    ref={(el) => {
                      fieldRefs.current[field] = el
                    }}
                    className={shown ? 'task-chip' : 'task-chip is-empty'}
                    onClick={() => edit(field)}
                  >
                    {shown || words.addField[field]}
                  </button>
                </dd>
              </div>
            )
          })}
        </dl>
      </div>
      <div className="refine-walk">
        <Button variant="ghost" disabled={state.index === 0} onClick={() => run({ kind: 'back' })}>
          {words.refineBack}
        </Button>
        <Button variant="ghost" onClick={() => run({ kind: 'skip' })}>
          {words.refineSkip}
        </Button>
        <Button variant="primary" onClick={() => run({ kind: 'next' })}>
          {words.refineNext}
        </Button>
      </div>
      <p className="refine-keys">{words.refineKeys}</p>
      {editing && (
        <TaskFieldPopover
          taskId={task.id}
          field={editing.field}
          anchor={editing.anchor}
          onClose={() => {
            setEditing(null)
            // after the click that closed it has moved the focus, not before
            requestAnimationFrame(() => card.current?.focus({ preventScroll: true }))
          }}
        />
      )}
    </section>
  )
}
