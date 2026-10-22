// The task panel: one task of the built-in Tasks database beside the list it was clicked in (the
// Tasks screen, Today, the calendar). Every field, each opening the editor a row's chip opens;
// the subtasks, as rows; the notes, which are the page's own content; and "Open as page".
// Escape (outside the notes) closes it and gives the focus back to the task's row.
import { useId, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ruleText } from '@shared/rrule'
import { useHome } from '@/home/store'
import { openPage } from '@/store/tabs'
import { PageEditor } from '@/editor/lazy'
import { Close } from '@/ui/icons'
import { TASK_COPY, type TaskField } from './copy'
import { useTasksDatabase } from './data'
import { addSubtask, renameTask } from './edit'
import { dueLabel, nestTasks, readTasks, type TaskItem } from './lists'
import { TaskFieldPopover } from './TaskEditors'
import { TaskRow, useTaskRows } from './TaskRow'
import { TitleEditor } from './TitleEditor'
import type { PopoverAnchor } from '@/ui/Popover'
import './panel.css'

const FIELDS: readonly TaskField[] = ['date', 'repeat', 'priority', 'project', 'labels', 'remind']

export interface TaskPanelProps {
  taskId: string
  today: string
  onClose: () => void
  /** Completing from the panel goes the way the list completes. */
  onToggle: (task: TaskItem) => void
  /** A subtask clicked in the panel: the panel shows it. */
  onSelect: (id: string) => void
  /** Drawn over the right side of the screen (Today, the calendar) rather than as a column of it. */
  overlay?: boolean
}

export function TaskPanel({ taskId, today, onClose, onToggle, onSelect, overlay }: TaskPanelProps): JSX.Element {
  const locale = useHome((state) => state.locale)
  const words = TASK_COPY[locale]
  const { resolved, schema, rows } = useTasksDatabase()
  const tasks = useMemo(() => readTasks(rows, schema), [rows, schema])
  const task = tasks.find((item) => item.id === taskId)
  const subtasks = useMemo(() => nestTasks(tasks.filter((item) => item.parent === taskId)), [tasks, taskId])
  const subtaskRows = useTaskRows(useMemo(() => subtasks.items.map((item) => item.id), [subtasks]))
  const [editing, setEditing] = useState<{ field: TaskField; anchor: PopoverAnchor } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [subtask, setSubtask] = useState('')
  const titleId = useId()
  const root = useRef<HTMLElement>(null)

  const close = (): void => {
    onClose()
    // Back to the task's row, wherever it is listed.
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-task-row][data-task-id="${CSS.escape(taskId)}"]`)
      row?.focus({ preventScroll: true })
    })
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return
    if ((event.target as HTMLElement).closest?.('.pe-root')) return
    event.preventDefault()
    close()
  }

  const classes = overlay ? 'task-panel is-overlay' : 'task-panel'
  const loading = !resolved || resolved.status === 'loading' || (!task && rows.length === 0)

  if (!task) {
    return (
      <aside ref={root} className={classes} aria-label={words.panel} onKeyDown={onKeyDown}>
        <div className="task-panel-head">
          <span />
          <button type="button" className="task-panel-close" aria-label={words.close} onClick={close}>
            <Close size={14} />
          </button>
        </div>
        {!loading && <p className="task-panel-quiet">{words.gone}</p>}
      </aside>
    )
  }

  const value = (field: TaskField): string => {
    switch (field) {
      case 'date':
        return task.due ? dueLabel(task.due, today, undefined, words.days).text : ''
      case 'repeat':
        return task.recurrence
          ? `${ruleText(task.recurrence.rule, locale)}${task.recurrence.from === 'completion' ? ` (${words.fromCompletion})` : ''}`
          : ''
      case 'priority':
        return task.priority ? words.priorityName(task.priority) : ''
      case 'project':
        return task.project?.name ?? ''
      case 'labels':
        return task.labels.map((label) => `@${label.name}`).join(' ')
      case 'remind':
        return task.remind ? dueLabel(task.remind, today, undefined, words.days).text : ''
    }
  }

  const title = task.title || words.untitled

  return (
    <aside ref={root} className={classes} aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="task-panel-head">
        <button
          type="button"
          className={task.priority ? `task-check is-p${task.priority}` : 'task-check'}
          role="checkbox"
          aria-checked={task.done}
          aria-label={task.done ? words.reopen(title) : words.complete(title)}
          onClick={() => onToggle(task)}
        />
        {renaming ? (
          <TitleEditor
            className="task-panel-title-edit"
            initial={task.title}
            today={today}
            onCommit={(text, ignored) => {
              setRenaming(false)
              renameTask(task.id, text, ignored)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <h2 id={titleId} className={task.done ? 'task-panel-title is-done' : 'task-panel-title'}>
            <button type="button" className="task-panel-rename" title={`${words.rename} (F2)`} onClick={() => setRenaming(true)}>
              {title}
            </button>
          </h2>
        )}
        <button type="button" className="task-panel-close" aria-label={words.close} title="Esc" onClick={close}>
          <Close size={14} />
        </button>
      </div>

      <dl className="task-panel-fields">
        {FIELDS.map((field) => {
          const shown = value(field)
          return (
            <div key={field} className="task-panel-field">
              <dt>{words.field[field]}</dt>
              <dd>
                <button
                  type="button"
                  className={shown ? 'task-panel-value' : 'task-panel-value is-empty'}
                  aria-label={words.change(words.field[field], shown || words.none)}
                  onClick={(event) => setEditing({ field, anchor: event.currentTarget })}
                >
                  {shown || '—'}
                </button>
              </dd>
            </div>
          )
        })}
      </dl>

      <section className="task-panel-section" aria-label={words.subtasks}>
        <h3 className="task-panel-label">{words.subtasks}</h3>
        {subtasks.items.length > 0 && (
          <ul className="tasks-rows" {...subtaskRows.listProps}>
            {subtasks.items.map((item) => (
              <TaskRow
                key={item.id}
                task={item}
                today={today}
                depth={subtasks.depth.get(item.id) ?? 0}
                tabStop={subtaskRows.stop === item.id}
                onToggle={() => onToggle(item)}
                onOpen={() => onSelect(item.id)}
                onLeave={subtaskRows.leave}
              />
            ))}
          </ul>
        )}
        <input
          className="task-panel-add"
          value={subtask}
          placeholder={`+ ${words.addSubtask}`}
          aria-label={words.addSubtask}
          maxLength={500}
          onChange={(event) => setSubtask(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            if (addSubtask(task.row, subtask)) setSubtask('')
          }}
        />
      </section>

      <section className="task-panel-section task-panel-notes" aria-label={words.notes}>
        <h3 className="task-panel-label">{words.notes}</h3>
        <PageEditor key={task.id} pageId={task.id} onOpenPage={openPage} bodyOnly />
      </section>

      <div className="task-panel-foot">
        <button type="button" className="task-panel-open" onClick={() => openPage(task.id)}>
          {words.openAsPage}
        </button>
      </div>

      {editing && <TaskFieldPopover taskId={task.id} field={editing.field} anchor={editing.anchor} onClose={() => setEditing(null)} />}
    </aside>
  )
}
