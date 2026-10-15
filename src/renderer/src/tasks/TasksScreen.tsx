// The Tasks screen: the built-in Tasks database as lists, Todoist-style. A column of lists on the
// left (the fixed ones, then projects and labels from the select options, then the database's
// own views), the tasks of the chosen one on the right. Rows are pages of the database: a click
// opens one, the round checkbox completes it through the same path as the Today screen.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { Block, PropertyValue } from '@shared/types'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { getBlock, useBlocks } from '@/store/blocks'
import { openPage } from '@/store/tabs'
import { notifyError, toast } from '@/ui/toast'
import * as L from '@/database/logic'
import * as actions from '@/database/actions'
import { useResolvedDatabase } from '@/database/resolved'
import { chooseView, DatabaseView } from '@/database/DatabaseView'
import { tagStyle } from '@/database/common'
import { focusQuickAdd, showTaskList, useTasksGate, type TaskListKey } from './gate'
import { dueLabel, listCounts, listTasks, readTasks, type TaskItem } from './lists'
import { QuickAdd } from './QuickAdd'
import './tasks.css'

const EMPTY: string[] = []

/** The local day, kept current across midnight. */
function useToday(): string {
  const [today, setToday] = useState(() => L.todayISO())
  useEffect(() => {
    const timer = setInterval(() => setToday(L.todayISO()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}

const FIXED: { kind: 'inbox' | 'today' | 'upcoming' | 'completed'; name: string }[] = [
  { kind: 'inbox', name: 'Inbox' },
  { kind: 'today', name: 'Today' },
  { kind: 'upcoming', name: 'Upcoming' },
  { kind: 'completed', name: 'Completed' }
]

const sameList = (a: TaskListKey, b: TaskListKey): boolean => a.kind === b.kind && ('id' in a ? a.id : '') === ('id' in b ? b.id : '')

/**
 * Completing from a list. Ticked tasks hide at once (the database hears of it a moment later);
 * a toast offers to take it back. Through `briefing:completeTask`, as on the Today screen.
 */
function useCompletion(): { pending: ReadonlySet<string>; complete: (task: TaskItem) => void; reopen: (task: TaskItem) => void } {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const forget = useCallback((id: string) => {
    setPending((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }, [])

  const complete = useCallback(
    (task: TaskItem): void => {
      setPending((current) => new Set(current).add(task.id))
      window.api.briefing.completeTask(task.id).then(
        ({ token }) => {
          toast(`Completed "${task.title || 'Untitled'}".`, {
            action: {
              label: 'Undo',
              run: () => {
                window.api.briefing.undoCompleteTask(token).then(
                  () => forget(task.id),
                  (error: unknown) => notifyError('Could not undo that.', error)
                )
              }
            }
          })
        },
        (error: unknown) => {
          forget(task.id)
          notifyError('Could not complete the task.', error)
        }
      )
    },
    [forget]
  )

  // Back to open: unticked, and no longer counted as completed.
  const reopen = useCallback(
    (task: TaskItem): void => {
      forget(task.id)
      const row = getBlock(task.id)
      if (!row) return
      const values: Record<string, PropertyValue> = { ...(L.isPlainObject(row.props.values) ? row.props.values : {}) }
      delete values[TASK_PROPS.done]
      delete values[TASK_PROPS.completedAt]
      actions.runOps([{ op: 'update', id: task.id, patch: { props: { values } } }])
    },
    [forget]
  )

  return { pending, complete, reopen }
}

function TaskRow(props: { task: TaskItem; today: string; heading?: string; onToggle: (task: TaskItem) => void }): JSX.Element {
  const { task, today, heading, onToggle } = props
  const label = task.due ? dueLabel(task.due, today, heading) : null
  const due = label?.text ? label : null
  const title = task.title || 'Untitled'
  return (
    <li className={task.done ? 'task-row is-done' : 'task-row'}>
      <button
        type="button"
        className={`task-check is-p${task.priority}`}
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Mark "${title}" as not done` : `Complete "${title}"`}
        onClick={() => onToggle(task)}
      />
      <button type="button" className="task-open" onClick={(event) => openPage(task.id, { newTab: event.ctrlKey || event.metaKey })}>
        <span className="task-title">{title}</span>
        {(due || task.recurring) && (
          <span className="task-meta">
            {due && <span className={due.overdue && !task.done ? 'task-due is-overdue' : 'task-due'}>{due.text}</span>}
            {task.recurring && (
              <span className="task-repeat" title="Repeats" aria-label="Repeats">
                ↻
              </span>
            )}
          </span>
        )}
      </button>
      {(task.project || task.labels.length > 0) && (
        <span className="task-tags">
          {task.labels.map((label) => (
            <span key={label.id} className="task-label" style={tagStyle(label.color)}>
              @{label.name}
            </span>
          ))}
          {task.project && <span className="task-project">#{task.project.name}</span>}
        </span>
      )}
    </li>
  )
}

const EMPTY_TEXT: Record<TaskListKey['kind'], string> = {
  inbox: 'Nothing in the inbox. Tasks without a project land here.',
  today: 'Nothing due today.',
  upcoming: 'Nothing scheduled after today.',
  completed: 'No completed tasks yet.',
  project: 'No open tasks in this project.',
  label: 'No open tasks with this label.',
  view: ''
}

export function TasksScreen(): JSX.Element {
  const resolved = useResolvedDatabase(TASKS_DATABASE_ID, false)
  const db = resolved?.view
  const { schema, views } = useMemo(() => L.normalizeResolved(resolved), [resolved])
  const rawContent: unknown = db?.content
  const rowIds = useMemo(() => {
    const ids = Array.isArray(rawContent) ? rawContent.filter((id): id is string => typeof id === 'string') : EMPTY
    return ids.length ? ids : EMPTY
  }, [rawContent])
  const rowBlocks = useBlocks(rowIds)
  const rows = useMemo(
    () => rowBlocks.filter((b): b is Block => !!b && b.type === 'page' && !b.trashedAt && b.parentId === TASKS_DATABASE_ID),
    [rowBlocks]
  )
  const today = useToday()
  const list = useTasksGate((state) => state.list)
  const { pending, complete, reopen } = useCompletion()

  const tasks = useMemo(() => readTasks(rows, schema).filter((task) => task.done || !pending.has(task.id)), [rows, schema, pending])
  const groups = useMemo(() => listTasks(tasks, schema, list, today), [tasks, schema, list, today])
  const counts = useMemo(() => listCounts(tasks, schema), [tasks, schema])
  const projects = L.optionsOf(L.propOf(schema, TASK_PROPS.project))
  const labels = L.optionsOf(L.propOf(schema, TASK_PROPS.labels))

  // A project, label or view that is gone falls back to Today.
  const listMissing =
    (list.kind === 'project' && !projects.some((option) => option.id === list.id)) ||
    (list.kind === 'label' && !labels.some((option) => option.id === list.id)) ||
    (list.kind === 'view' && !views.some((view) => view.id === list.id))
  useEffect(() => {
    if (db && listMissing) showTaskList({ kind: 'today' })
  }, [db, listMissing])

  // Asked to add a task while a list without the input is shown: the Inbox has one.
  const focus = useTasksGate((state) => state.focus)
  useEffect(() => {
    const { list: current } = useTasksGate.getState()
    if (focus && (current.kind === 'completed' || current.kind === 'view')) showTaskList({ kind: 'inbox' })
  }, [focus])

  // Q (outside a text field) puts the caret in the quick-add input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'q' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable]'))) return
      event.preventDefault()
      focusQuickAdd()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!resolved || resolved.status === 'loading') return <div className="tasks is-loading" />
  if (!db || db.type !== 'database' || resolved.status !== 'ok') {
    return (
      <div className="tasks is-unavailable">
        <p>The Tasks database could not be opened. Restart sel to create it again.</p>
      </div>
    )
  }

  const heading =
    list.kind === 'project'
      ? (projects.find((option) => option.id === list.id)?.name ?? '')
      : list.kind === 'label'
        ? `@${labels.find((option) => option.id === list.id)?.name ?? ''}`
        : list.kind === 'view'
          ? (views.find((view) => view.id === list.id)?.name ?? '')
          : (FIXED.find((item) => item.kind === list.kind)?.name ?? '')

  const navItem = (key: TaskListKey, name: string, count: number | undefined, extra?: JSX.Element): JSX.Element => {
    const active = sameList(key, list)
    return (
      <li key={`${key.kind}:${'id' in key ? key.id : ''}`}>
        <button
          type="button"
          className={active ? 'tasks-nav-item is-active' : 'tasks-nav-item'}
          aria-current={active ? 'page' : undefined}
          onClick={() => {
            if (key.kind === 'view') chooseView(TASKS_DATABASE_ID, key.id)
            showTaskList(key)
          }}
        >
          {extra}
          <span className="tasks-nav-name">{name}</span>
          {count ? <span className="tasks-nav-count">{count}</span> : null}
        </button>
      </li>
    )
  }

  const empty = groups.every((group) => group.items.length === 0)

  return (
    <div className="tasks">
      <nav className="tasks-nav" aria-label="Task lists">
        <ul className="tasks-nav-list">{FIXED.map((item) => navItem({ kind: item.kind }, item.name, item.kind === 'completed' ? undefined : counts.get(item.kind)))}</ul>
        {projects.length > 0 && (
          <section className="tasks-nav-section">
            <h3 className="tasks-nav-title">Projects</h3>
            <ul className="tasks-nav-list">
              {projects.map((option) =>
                navItem({ kind: 'project', id: option.id }, option.name, counts.get(`project:${option.id}`), <span className="tasks-nav-dot" style={{ background: `var(--c-${option.color})` }} aria-hidden="true" />)
              )}
            </ul>
          </section>
        )}
        {labels.length > 0 && (
          <section className="tasks-nav-section">
            <h3 className="tasks-nav-title">Labels</h3>
            <ul className="tasks-nav-list">
              {labels.map((option) =>
                navItem({ kind: 'label', id: option.id }, option.name, counts.get(`label:${option.id}`), <span className="tasks-nav-at" style={{ color: `var(--c-${option.color})` }} aria-hidden="true">@</span>)
              )}
            </ul>
          </section>
        )}
        <section className="tasks-nav-section">
          <h3 className="tasks-nav-title">Views</h3>
          <ul className="tasks-nav-list">{views.map((view) => navItem({ kind: 'view', id: view.id }, view.name, undefined))}</ul>
        </section>
      </nav>

      <div className="tasks-main">
        {list.kind === 'view' ? (
          <div className="tasks-view">
            <DatabaseView key={list.id} databaseId={TASKS_DATABASE_ID} onOpenPage={openPage} />
          </div>
        ) : (
          <div className="tasks-list">
            <h1 className="tasks-heading">{heading}</h1>
            {list.kind !== 'completed' && <QuickAdd key={`${list.kind}:${'id' in list ? list.id : ''}`} list={list} today={today} projects={projects} labels={labels} />}
            {empty ? (
              <p className="tasks-empty">{EMPTY_TEXT[list.kind]}</p>
            ) : (
              groups.map((group) =>
                group.items.length ? (
                  <section key={group.id} className="tasks-group">
                    {group.title && <h2 className={group.id === 'overdue' ? 'tasks-group-title is-overdue' : 'tasks-group-title'}>{group.title}</h2>}
                    <ul className="tasks-rows">
                      {group.items.map((task) => (
                        <TaskRow key={task.id} task={task} today={today} heading={group.id} onToggle={task.done ? reopen : complete} />
                      ))}
                    </ul>
                  </section>
                ) : null
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
