// The Tasks screen: the built-in Tasks database as lists, Todoist-style. A column of lists on the
// left (the fixed ones, then projects and labels from the select options, then the database's
// own views), the tasks of the chosen one on the right. Rows are pages of the database: a click
// opens one, the round checkbox completes it through the same path as the Today screen.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Block } from '@shared/types'
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
import { dueLabel, listCounts, listTasks, openDescendants, readTasks, type TaskGroup, type TaskItem } from './lists'
import { QuickAdd } from './QuickAdd'
import { TasksTools } from './TasksTools'
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

/** A task ticked here: hidden until it is done, or, when it repeats, until it shows its next date. */
interface Pending {
  next?: string
}

function isPending(entry: Pending | undefined, task: TaskItem): boolean {
  return !!entry && (entry.next === undefined || task.due !== entry.next)
}

/**
 * Completing from a list. A ticked task hides at once, until the database hears of it: then it
 * is done (and gone from the open lists), or, when it repeats, back with its next date. A toast
 * offers to take it back. Through `briefing:completeTask`, as on the Today screen.
 */
function useCompletion(today: string): {
  pending: ReadonlyMap<string, Pending>
  complete: (task: TaskItem, subtasks?: readonly TaskItem[]) => void
  reopen: (task: TaskItem) => void
} {
  const [pending, setPending] = useState<ReadonlyMap<string, Pending>>(() => new Map())
  const update = useCallback((change: (map: Map<string, Pending>) => void) => {
    setPending((current) => {
      const next = new Map(current)
      change(next)
      return next
    })
  }, [])
  const forget = useCallback((ids: readonly string[]) => update((map) => ids.forEach((id) => map.delete(id))), [update])

  /** Completes a task, and with it the open subtasks under it (they go first). */
  const complete = useCallback(
    (task: TaskItem, subtasks: readonly TaskItem[] = []): void => {
      const all = [...subtasks, task]
      update((map) => all.forEach((item) => map.set(item.id, {})))
      void Promise.allSettled(all.map((item) => window.api.briefing.completeTask(item.id))).then((results) => {
        const tokens: string[] = []
        let next: string | undefined
        results.forEach((result, index) => {
          const item = all[index]
          if (result.status === 'rejected') {
            forget([item.id])
            return
          }
          tokens.push(result.value.token)
          const moved = result.value.next
          if (moved) update((map) => void (map.has(item.id) && map.set(item.id, { next: moved })))
          if (item === task) next = moved
        })
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (!tokens.length) {
          notifyError('Could not complete the task.', failed?.reason)
          return
        }
        if (failed) notifyError('Some subtasks could not be completed.', failed.reason)
        const title = task.title || 'Untitled'
        const count = tokens.length - (results[results.length - 1].status === 'fulfilled' ? 1 : 0)
        const also = count > 0 ? ` and ${count} subtask${count === 1 ? '' : 's'}` : ''
        toast(next ? `Completed "${title}"${also}. Next: ${dueLabel(next, today).text}.` : `Completed "${title}"${also}.`, {
          action: {
            label: 'Undo',
            run: () => {
              Promise.all(tokens.map((token) => window.api.briefing.undoCompleteTask(token))).then(
                () => forget(all.map((item) => item.id)),
                (error: unknown) => notifyError('Could not undo that.', error)
              )
            }
          }
        })
      })
    },
    [forget, update, today]
  )

  // Back to open: unticked, and no longer counted as completed.
  const reopen = useCallback(
    (task: TaskItem): void => {
      forget([task.id])
      const row = getBlock(task.id)
      if (row) actions.runOps([actions.reopenTaskOp(row)])
    },
    [forget]
  )

  return { pending, complete, reopen }
}

/**
 * Makes `task` a subtask of `parent` (null: a task of its own again). A new subtask joins its
 * parent's project, as in Todoist.
 */
function setParent(task: TaskItem, parent: TaskItem | null): void {
  const row = getBlock(task.id)
  if (!row) return
  const values: L.Values = { ...(L.isPlainObject(row.props.values) ? (row.props.values as L.Values) : {}) }
  if (parent) {
    values[TASK_PROPS.parent] = [parent.id]
    if (parent.project) values[TASK_PROPS.project] = parent.project.id
  } else delete values[TASK_PROPS.parent]
  actions.runOps([{ op: 'update', id: task.id, patch: { props: { values } } }])
}

interface RowProps {
  task: TaskItem
  today: string
  heading?: string
  depth: number
  onToggle: (task: TaskItem) => void
  /** Absent when the task cannot go further in (no task above it at its level) or out. */
  onIndent?: () => void
  onOutdent?: () => void
}

function TaskRow(props: RowProps): JSX.Element {
  const { task, today, heading, depth, onToggle, onIndent, onOutdent } = props
  const label = task.due ? dueLabel(task.due, today, heading) : null
  const due = label?.text ? label : null
  const title = task.title || 'Untitled'
  const onKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    if (event.key === ']' && onIndent) onIndent()
    else if (event.key === '[' && onOutdent) onOutdent()
    else return
    event.preventDefault()
  }
  return (
    <li className={task.done ? 'task-row is-done' : 'task-row'} style={{ '--depth': depth } as CSSProperties} onKeyDown={onKeyDown}>
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
      <span className="task-side">
        {(onIndent || onOutdent) && (
          <span className="task-moves">
            {onOutdent && (
              <button
                type="button"
                className="task-move"
                title="Move out of its parent (Ctrl+[)"
                aria-label={`Move "${title}" out of its parent`}
                onClick={onOutdent}
              >
                ←
              </button>
            )}
            {onIndent && (
              <button
                type="button"
                className="task-move"
                title="Make it a subtask of the task above (Ctrl+])"
                aria-label={`Make "${title}" a subtask of the task above`}
                onClick={onIndent}
              >
                →
              </button>
            )}
          </span>
        )}
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
      </span>
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
  const { pending, complete, reopen } = useCompletion(today)

  const tasks = useMemo(
    () => readTasks(rows, schema).filter((task) => task.done || !isPending(pending.get(task.id), task)),
    [rows, schema, pending]
  )
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
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable]')))
        return
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

  /** Indent: under the nearest task above at the same level. Outdent: next to its parent. Not for completed tasks. */
  const moves = (group: TaskGroup, index: number): Pick<RowProps, 'onIndent' | 'onOutdent'> => {
    const task = group.items[index]
    if (task.done) return {}
    const level = group.depth.get(task.id) ?? 0
    let above: TaskItem | undefined
    for (let i = index - 1; i >= 0; i--) {
      const candidate = group.items[i]
      const candidateLevel = group.depth.get(candidate.id) ?? 0
      if (candidateLevel < level) break
      if (candidateLevel === level) {
        above = candidate
        break
      }
    }
    const parent = task.parent ? tasks.find((item) => item.id === task.parent) : undefined
    const grandparent = parent?.parent ? (tasks.find((item) => item.id === parent.parent) ?? null) : null
    return {
      onIndent: above ? () => setParent(task, above) : undefined,
      onOutdent: task.parent ? () => setParent(task, grandparent) : undefined
    }
  }

  return (
    <div className="tasks">
      <nav className="tasks-nav" aria-label="Task lists">
        <ul className="tasks-nav-list">
          {FIXED.map((item) => navItem({ kind: item.kind }, item.name, item.kind === 'completed' ? undefined : counts.get(item.kind)))}
        </ul>
        {projects.length > 0 && (
          <section className="tasks-nav-section">
            <h3 className="tasks-nav-title">Projects</h3>
            <ul className="tasks-nav-list">
              {projects.map((option) =>
                navItem(
                  { kind: 'project', id: option.id },
                  option.name,
                  counts.get(`project:${option.id}`),
                  <span className="tasks-nav-dot" style={{ background: `var(--c-${option.color})` }} aria-hidden="true" />
                )
              )}
            </ul>
          </section>
        )}
        {labels.length > 0 && (
          <section className="tasks-nav-section">
            <h3 className="tasks-nav-title">Labels</h3>
            <ul className="tasks-nav-list">
              {labels.map((option) =>
                navItem(
                  { kind: 'label', id: option.id },
                  option.name,
                  counts.get(`label:${option.id}`),
                  <span className="tasks-nav-at" style={{ color: `var(--c-${option.color})` }} aria-hidden="true">
                    @
                  </span>
                )
              )}
            </ul>
          </section>
        )}
        <section className="tasks-nav-section">
          <h3 className="tasks-nav-title">Views</h3>
          <ul className="tasks-nav-list">{views.map((view) => navItem({ kind: 'view', id: view.id }, view.name, undefined))}</ul>
        </section>
        <TasksTools />
      </nav>

      <div className="tasks-main">
        {list.kind === 'view' ? (
          <div className="tasks-view">
            <DatabaseView key={list.id} databaseId={TASKS_DATABASE_ID} onOpenPage={openPage} />
          </div>
        ) : (
          <div className="tasks-list">
            <h1 className="tasks-heading">{heading}</h1>
            {list.kind !== 'completed' && (
              <QuickAdd key={`${list.kind}:${'id' in list ? list.id : ''}`} list={list} today={today} projects={projects} labels={labels} />
            )}
            {empty ? (
              <p className="tasks-empty">{EMPTY_TEXT[list.kind]}</p>
            ) : (
              groups.map((group) =>
                group.items.length ? (
                  <section key={group.id} className="tasks-group">
                    {group.title && (
                      <h2 className={group.id === 'overdue' ? 'tasks-group-title is-overdue' : 'tasks-group-title'}>{group.title}</h2>
                    )}
                    <ul className="tasks-rows">
                      {group.items.map((task, index) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          today={today}
                          heading={group.id}
                          depth={group.depth.get(task.id) ?? 0}
                          onToggle={task.done ? reopen : (item) => complete(item, openDescendants(tasks, item.id))}
                          {...moves(group, index)}
                        />
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
