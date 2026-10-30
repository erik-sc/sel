// The Tasks screen: the built-in Tasks database as lists, Todoist-style. A column of lists on the
// left (the fixed ones, then projects and labels from the select options, then the database's
// own views), the tasks of the chosen one in the middle, and the task panel on the right while a
// task is open in it. Rows are pages of the database, drawn by TaskRow: a click opens the panel,
// Ctrl+click the page, the round checkbox completes it through the same path as the Today screen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { projectSummaries, readPlans, readProjectTasks } from '@shared/tasks/projects'
import { getBlock } from '@/store/blocks'
import { openPage } from '@/store/tabs'
import { notifyError, toast } from '@/ui/toast'
import * as L from '@/database/logic'
import * as actions from '@/database/actions'
import { chooseView, DatabaseView } from '@/database/DatabaseView'
import { useTasksDatabase } from './data'
import { useHome } from '@/home/store'
import { CONTEXT_COPY } from '@/ai/contextCopy'
import { LockMark } from '@/ai/PrivateLock'
import { toggleProjectPrivate, useProjectsPrivate } from '@/ai/privacy'
import { Button } from '@/ui/Button'
import { Lock } from '@/ui/icons'
import { TASK_COPY } from './copy'
import { focusQuickAdd, showTaskList, stopRefine, useTasksGate, type RefineFrom, type TaskListKey } from './gate'
import { dueLabel, emptyChipsOf, listCounts, listTasks, openDescendants, readTasks, type TaskGroup, type TaskItem } from './lists'
import { ProjectHeader } from './ProjectHeader'
import { Refine } from './Refine'
import { refineQueue } from './refineWalk'
import { QuickAdd } from './QuickAdd'
import { TaskPanel } from './lazy'
import type { ManyAction } from './model'
import { ROW_SELECTOR, TaskRow, useTaskRows } from './TaskRow'
import { BulkPopover } from './BulkPopover'
import { SelectionBar } from './SelectionBar'
import { setPriorityMany, toggleDoneMany } from './bulk'
import { rowSelectionOf, useTaskSelection } from './useTaskSelection'
import { TasksTools } from './TasksTools'
import { useLeaving } from './useLeaving'
import './tasks.css'

/** The local day, kept current across midnight. */
function useToday(): string {
  const [today, setToday] = useState(() => L.todayISO())
  useEffect(() => {
    const timer = setInterval(() => setToday(L.todayISO()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}

const FIXED: { kind: 'inbox' | 'refine' | 'today' | 'upcoming' | 'completed'; name: string }[] = [
  { kind: 'inbox', name: 'Inbox' },
  // Its name is in the home's language (TASK_COPY.refineList).
  { kind: 'refine', name: 'To refine' },
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

type Moves = { onIndent?: () => void; onOutdent?: () => void }

const EMPTY_TEXT: Record<TaskListKey['kind'], string> = {
  inbox: 'Nothing in the inbox. Tasks without a project land here.',
  refine: '',
  today: 'Nothing due today.',
  upcoming: 'Nothing scheduled after today.',
  completed: 'No completed tasks yet.',
  project: 'No open tasks in this project.',
  label: 'No open tasks with this label.',
  view: ''
}

export function TasksScreen(): JSX.Element {
  const { resolved, schema, views, rows } = useTasksDatabase()
  const db = resolved?.view
  const today = useToday()
  const [panel, setPanel] = useState<string | null>(null)
  const list = useTasksGate((state) => state.list)
  const { pending, complete, reopen } = useCompletion(today)
  const locale = useHome((state) => state.locale)
  const words = TASK_COPY[locale]
  const aiWords = CONTEXT_COPY[locale]
  // Projects kept private from the AI (shared/aiPrivate.ts): a lock in the list, a toggle on the project.
  const privateIds = useProjectsPrivate()
  const refining = useTasksGate((state) => state.refining)

  const tasks = useMemo(
    () => readTasks(rows, schema).filter((task) => task.done || !isPending(pending.get(task.id), task)),
    [rows, schema, pending]
  )
  const listed = useMemo(() => listTasks(tasks, schema, list, today), [tasks, schema, list, today])
  // A task given a project fades out of the Inbox instead of vanishing (useLeaving.ts).
  const { groups, leaving } = useLeaving(listed, tasks, `${list.kind}:${'id' in list ? list.id : ''}`, list.kind === 'inbox')
  const order = useMemo(() => listed.flatMap((group) => group.items.map((task) => task.id)), [listed])
  const rowList = useTaskRows(order)
  // Picked rows (E1a): Shift+arrows, Shift+click, "Select all in this list". The keys act on them when there are two or more.
  const picked = useTaskSelection(order)
  const [many, setMany] = useState<{ field: 'date' | 'project' | 'priority'; anchor: HTMLElement } | null>(null)
  const listId = `${list.kind}:${'id' in list ? list.id : ''}`
  // Another list is another selection.
  const resetPicked = picked.reset
  useEffect(() => {
    resetPicked()
    setMany(null)
  }, [listId, resetPicked])
  // The "Select all in this list" command bumps a counter; only a bump after this screen was drawn counts.
  const selectAllTick = useTasksGate((state) => state.selectAll)
  const handledTick = useRef(selectAllTick)
  const pickAll = picked.selectAll
  useEffect(() => {
    if (selectAllTick === handledTick.current) return
    handledTick.current = selectAllTick
    if (!useTasksGate.getState().refining && list.kind !== 'view') pickAll()
  }, [selectAllTick, pickAll, list.kind])
  const onMany = (action: ManyAction, anchor: HTMLElement): void => {
    const ids = picked.selection.ids
    switch (action.kind) {
      case 'date':
      case 'project':
        setMany({ field: action.kind, anchor })
        break
      case 'priority':
        setPriorityMany(ids, action.level)
        break
      case 'toggle':
        toggleDoneMany(ids)
        break
      case 'ignore':
        break
    }
  }
  const toggle = useCallback(
    (task: TaskItem): void => (task.done ? reopen(task) : complete(task, openDescendants(tasks, task.id))),
    [complete, reopen, tasks]
  )
  const counts = useMemo(() => listCounts(tasks, schema), [tasks, schema])
  // What the refine button would walk, on the Inbox and on "To refine".
  const refineFrom: RefineFrom | null = list.kind === 'inbox' || list.kind === 'refine' ? list.kind : null
  const canRefine = useMemo(() => (refineFrom ? refineQueue(tasks, refineFrom).length > 0 : false), [tasks, refineFrom])
  const projects = L.optionsOf(L.propOf(schema, TASK_PROPS.project))
  const labels = L.optionsOf(L.propOf(schema, TASK_PROPS.labels))
  // A project's list opens with what the project is for (0.8.0 E3).
  const projectId = list.kind === 'project' ? list.id : null
  const rawPlans = db?.props.projects
  const project = useMemo(() => {
    const option = projectId ? L.optionsOf(L.propOf(schema, TASK_PROPS.project)).find((each) => each.id === projectId) : undefined
    if (!option) return null
    const counted = readProjectTasks(rows)
    const [summary] = projectSummaries([option], readPlans(rawPlans), counted)
    const open = counted.filter((task) => task.project === option.id && !task.done).map(({ id, title }) => ({ id, title }))
    return { summary, open }
  }, [projectId, schema, rows, rawPlans])

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
          : list.kind === 'refine'
            ? words.refineList
            : (FIXED.find((item) => item.kind === list.kind)?.name ?? '')

  const navItem = (key: TaskListKey, name: string, count: number | undefined, extra?: JSX.Element, locked = false): JSX.Element => {
    const active = sameList(key, list)
    return (
      <li key={`${key.kind}:${'id' in key ? key.id : ''}`}>
        <button
          type="button"
          className={active ? 'tasks-nav-item is-active' : 'tasks-nav-item'}
          aria-current={active ? 'page' : undefined}
          onClick={() => {
            if (key.kind === 'view') chooseView(TASKS_DATABASE_ID, key.id)
            stopRefine()
            showTaskList(key)
          }}
        >
          {extra}
          <span className="tasks-nav-name">{name}</span>
          {locked && <LockMark why={aiWords.privateWhy.self} />}
          {count ? <span className="tasks-nav-count">{count}</span> : null}
        </button>
      </li>
    )
  }

  const empty = groups.every((group) => group.items.length === 0)

  /** Indent: under the nearest task above at the same level. Outdent: next to its parent. Not for completed tasks. */
  const moves = (group: TaskGroup, index: number): Moves => {
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
    <div className={panel ? 'tasks has-panel' : 'tasks'}>
      <nav className="tasks-nav" aria-label="Task lists">
        <ul className="tasks-nav-list">
          {FIXED.map((item) =>
            navItem(
              { kind: item.kind },
              item.kind === 'refine' ? words.refineList : item.name,
              item.kind === 'completed' ? undefined : counts.get(item.kind)
            )
          )}
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
                  <span className="tasks-nav-dot" style={{ background: `var(--c-${option.color})` }} aria-hidden="true" />,
                  privateIds.includes(option.id)
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
        {refining && refineFrom ? (
          <Refine
            key={refineFrom}
            tasks={tasks}
            from={refining}
            today={today}
            onExit={() => {
              stopRefine()
              // Back to the list, at the button that started it (or the list when nothing is left).
              requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('.tasks-refine, .tasks-list [data-task-row], .tasks-list .qa-input')?.focus()
              )
            }}
          />
        ) : list.kind === 'view' ? (
          <div className="tasks-view">
            <DatabaseView key={list.id} databaseId={TASKS_DATABASE_ID} onOpenPage={openPage} />
          </div>
        ) : (
          <div
            className="tasks-list"
            {...rowList.listProps}
            onKeyDown={(event) => {
              rowList.listProps.onKeyDown(event)
              // Moving along the list with the plain arrows lets go of the selection; Shift+arrows extend it.
              picked.onListKey(event)
            }}
          >
            <div className="tasks-heading-row">
              <h1 className="tasks-heading">{heading}</h1>
              {list.kind === 'project' && (
                <Button
                  className={privateIds.includes(list.id) ? 'tasks-private is-on' : 'tasks-private'}
                  aria-pressed={privateIds.includes(list.id)}
                  title={privateIds.includes(list.id) ? aiWords.privateWhy.self : undefined}
                  onClick={() =>
                    void toggleProjectPrivate(list.id).then(
                      (now) => toast(now ? aiWords.privateOn : aiWords.privateOff, { kind: 'info', duration: 3000 }),
                      (error: unknown) => notifyError(aiWords.privateFailed, error)
                    )
                  }
                >
                  <Lock size={14} /> {aiWords.projectPrivate}
                </Button>
              )}
              {refineFrom && canRefine && (
                <Button className="tasks-refine" onClick={() => useTasksGate.setState({ refining: refineFrom })}>
                  {words.refine}
                </Button>
              )}
            </div>
            {project && (
              <ProjectHeader key={project.summary.id} summary={project.summary} open={project.open} today={today} onOpenTask={setPanel} />
            )}
            {list.kind !== 'completed' && (
              <QuickAdd key={`${list.kind}:${'id' in list ? list.id : ''}`} list={list} today={today} projects={projects} labels={labels} />
            )}
            {empty ? (
              <p className="tasks-empty">{list.kind === 'refine' ? words.refineEmpty : EMPTY_TEXT[list.kind]}</p>
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
                          tabStop={rowList.stop === task.id}
                          current={panel === task.id}
                          onToggle={() => toggle(task)}
                          onOpen={() => setPanel(task.id)}
                          onLeave={rowList.leave}
                          emptyChips={emptyChipsOf(task)}
                          leaving={leaving.has(task.id)}
                          selection={rowSelectionOf(picked, task.id, rowList.stop, onMany)}
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
        {!refining && list.kind !== 'view' && (
          <SelectionBar
            ids={picked.selection.ids}
            onMenu={(field, anchor) => setMany({ field, anchor })}
            onToggle={() => toggleDoneMany(picked.selection.ids)}
            onClear={() => {
              // The button goes with the strip: the focus goes back to the list's Tab stop first.
              document.querySelector<HTMLElement>(`.tasks-list ${ROW_SELECTOR}[tabindex="0"]`)?.focus({ preventScroll: true })
              picked.clear()
            }}
            onLetGo={() =>
              requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('.tasks-list [data-task-row]')?.focus({ preventScroll: true })
              )
            }
          />
        )}
      </div>
      {many && <BulkPopover field={many.field} ids={picked.selection.ids} anchor={many.anchor} onClose={() => setMany(null)} />}
      {panel && list.kind !== 'view' && (
        <TaskPanel taskId={panel} today={today} onClose={() => setPanel(null)} onToggle={(task) => toggle(task)} onSelect={setPanel} />
      )}
    </div>
  )
}
