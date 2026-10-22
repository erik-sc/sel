// The editor of one field of a task, in a popover next to what opened it (a chip, the row, the
// task panel): the date and repeat pickers of the database (9a), a priority menu, and the project
// and label pickers that can make a new one. Each reads the task from the store as it is now and
// writes through tasks/edit.ts.
import { Suspense, useCallback, useEffect, useRef } from 'react'
import type { JSX } from 'react'
import type { Block } from '@shared/types'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { readRecurrence } from '@shared/tasks/recur'
import { useBlock } from '@/store/blocks'
import { useHome } from '@/home/store'
import * as L from '@/database/logic'
import { Floating } from '@/database/common'
import { DatePicker, PartFallback, RecurrencePicker } from '@/database/lazyParts'
import { SelectEditor } from '@/database/SelectEditor'
import { Menu } from '@/ui/Menu'
import type { PopoverAnchor } from '@/ui/Popover'
import { TASK_COPY, type TaskField } from './copy'
import { setDue, setPriority, setProject, setRecurrence, setRemind, taskRow, updateLabels } from './edit'
import { priorityOf, type Priority } from './model'
import { LEVELS, priorityItems } from './priority'

function valuesOf(row: Block | undefined): L.Values {
  return row && L.isPlainObject(row.props.values) ? (row.props.values as L.Values) : {}
}

function dateOf(values: L.Values, id: string): L.DateValue | null {
  return L.normalizeDateValue(Object.hasOwn(values, id) ? values[id] : undefined)
}

function selected(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string')
  return typeof value === 'string' && value ? [value] : []
}

/**
 * Puts the focus in the editor once it is drawn (the pickers load on demand): its first field, so
 * that the keyboard can type a date or a repeat at once. The popover gives it back when it closes.
 */
function useFocusInside(): (el: HTMLDivElement | null) => void {
  const observer = useRef<MutationObserver | null>(null)
  useEffect(() => () => observer.current?.disconnect(), [])
  return useCallback((el: HTMLDivElement | null): void => {
    observer.current?.disconnect()
    if (!el) return
    const tryFocus = (): boolean => {
      const target = el.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=radio]), button, [tabindex]')
      if (!target) return false
      target.focus({ preventScroll: true })
      return true
    }
    if (tryFocus()) return
    observer.current = new MutationObserver(() => {
      if (tryFocus()) observer.current?.disconnect()
    })
    observer.current.observe(el, { childList: true, subtree: true })
  }, [])
}

export interface TaskFieldPopoverProps {
  taskId: string
  field: TaskField
  anchor: PopoverAnchor
  onClose: () => void
}

/** The editor of `field` of the task, open next to `anchor`. */
export function TaskFieldPopover({ taskId, field, anchor, onClose }: TaskFieldPopoverProps): JSX.Element | null {
  const words = TASK_COPY[useHome((state) => state.locale)]
  const row = useBlock(taskId)
  const database = useBlock(TASKS_DATABASE_ID)
  const focusInside = useFocusInside()

  // On Today and the calendar the row may not be in the store yet.
  useEffect(() => {
    if (!row || !database) void taskRow(taskId).catch(() => undefined)
  }, [row, database, taskId])

  if (!row || !database) return null
  const values = valuesOf(row)
  const schema = L.normalizeDatabase(database).schema

  if (field === 'priority') {
    const pick = (level: Priority | null): void => setPriority(taskId, level)
    return (
      <Floating open anchor={anchor} onClose={onClose} role="none">
        {/* 1 to 4 pick at once, as on the row. */}
        <div
          onKeyDown={(event) => {
            const level = Number(event.key)
            if (event.ctrlKey || event.altKey || event.metaKey || !LEVELS.includes(level as Priority)) return
            event.preventDefault()
            pick(level as Priority)
            onClose()
          }}
        >
          <Menu autoFocus items={priorityItems(priorityOf(values[TASK_PROPS.priority]), words, pick)} onClose={onClose} />
        </div>
      </Floating>
    )
  }

  const due = dateOf(values, TASK_PROPS.due)
  let body: JSX.Element | null = null
  if (field === 'date' || field === 'remind') {
    body = (
      <Suspense fallback={<PartFallback kind="popover" />}>
        <DatePicker
          value={dateOf(values, field === 'date' ? TASK_PROPS.due : TASK_PROPS.remind)}
          onChange={(next) => (field === 'date' ? setDue(taskId, next) : setRemind(taskId, next))}
          reminderFor={field === 'remind' ? (due?.start ?? null) : undefined}
        />
      </Suspense>
    )
  } else if (field === 'repeat') {
    body = (
      <Suspense fallback={<PartFallback kind="popover" />}>
        <RecurrencePicker
          value={readRecurrence(values[TASK_PROPS.recurrence])}
          due={due?.start ?? null}
          onChange={(next) => setRecurrence(taskId, next)}
        />
      </Suspense>
    )
  } else {
    const prop = L.propOf(schema, field === 'project' ? TASK_PROPS.project : TASK_PROPS.labels)
    if (!prop) return null
    const multiple = field === 'labels'
    body = (
      <SelectEditor
        databaseId={TASKS_DATABASE_ID}
        prop={prop}
        multiple={multiple}
        value={selected(values[prop.id])}
        onChange={(update) => {
          if (multiple) updateLabels(taskId, update)
          else {
            const ids = update(selected(valuesOf(row)[prop.id]))
            setProject(taskId, ids[ids.length - 1] ?? null)
          }
        }}
        onClose={onClose}
      />
    )
  }

  return (
    <Floating open anchor={anchor} onClose={onClose} label={words.field[field]} className="db-popover">
      <div ref={field === 'project' || field === 'labels' ? undefined : focusInside} className="task-editor">
        {body}
      </div>
    </Floating>
  )
}
