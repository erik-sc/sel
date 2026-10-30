// One task as every list draws it (the Tasks screen, Today, the calendar's day): the round
// checkbox, the name, and a chip per field it has (date with ↻ when it repeats, priority, project,
// labels). A chip opens the editor of its field; the name is edited where it is (double click or
// F2) and read by the quick-add parser; right click, the Menu key or "⋯" open the row's menu; a
// click opens the task panel, Ctrl+click the page in a new tab.
//
// The row is the list's item: one Tab stop per list (`useTaskRows`), arrows move along, and the
// keys of `rowKeyAction` (model.ts) act on the focused row. The small buttons inside it are for
// the pointer (tabIndex -1): the keyboard has keys and the menu for all of them.
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  FocusEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode
} from 'react'
import { ruleText } from '@shared/rrule'
import { useHome } from '@/home/store'
import { openPage } from '@/store/tabs'
import { announce } from '@/a11y/announce'
import { isMenuKeyEcho, keyboardAnchor, moveFocusAmong, takeMenuKey } from '@/a11y/keys'
import { tagStyle } from '@/database/common'
import { Calendar } from '@/ui/icons'
import { Menu, type MenuItem } from '@/ui/Menu'
import { Popover, type PopoverAnchor } from '@/ui/Popover'
import { TASK_COPY, type TaskCopy, type TaskField } from './copy'
import { deleteTask, renameTask, setPriority } from './edit'
import { setNextAction } from './projects'
import { dueLabel } from './lists'
import { manyKeyAction, nextPriority, rowKeyAction, type ManyAction, type Priority, type RowAction, type TaskView } from './model'
import { preloadTaskEditors, TaskFieldPopover } from './lazy'
import { priorityItems } from './priority'
import { TitleEditor } from './TitleEditor'
import './row.css'

/** What finds a row in a list. */
export const ROW_SELECTOR = '[data-task-row]'

/** Puts the focus on the row of task `id` in the list `from` is in. */
function focusRow(from: HTMLElement, id: string): void {
  const list = from.closest('.tasks-list') ?? from.ownerDocument
  list.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-task-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false })
}
const KEYS = 'Enter Control+Enter F2 D R 1 2 3 4 # @ L Space Delete'

/** A repeat in words, as a chip's title and the screen reader say it. */
function repeatWords(task: TaskView, words: TaskCopy, locale: 'en' | 'pt-BR'): string {
  if (!task.recurrence) return ''
  const text = ruleText(task.recurrence.rule, locale)
  return task.recurrence.from === 'completion' ? `${text} (${words.fromCompletion})` : text
}

export interface TaskRowProps {
  task: TaskView
  today: string
  /** The day the row is listed under: its date chip leaves the day out. */
  heading?: string
  /** How far it is indented under its parent. */
  depth?: number
  /** Whether the row is its list's Tab stop (see useTaskRows). */
  tabStop: boolean
  /** The task panel shows this task. */
  current?: boolean
  /**
   * Completing without hurry (Today): the ring keeps its colour and fills, the tick is drawn, the
   * title is struck and greyed, and the row stays where it is until `folding` closes it.
   */
  calm?: boolean
  /** A calm row that is closing up: it folds to nothing from the height it has. */
  folding?: boolean
  onToggle: (task: TaskView) => void
  /** A click or Enter: the task panel. */
  onOpen: (task: TaskView) => void
  /** Before the row leaves the list (completed, deleted): the list moves the focus on. */
  onLeave?: (id: string) => void
  /** Ctrl+] and Ctrl+[, and the arrows beside the row; absent when it cannot go that way. */
  onIndent?: () => void
  onOutdent?: () => void
  /** Fields shown as an empty chip when the task has none ("+ Date"). */
  emptyChips?: readonly TaskField[]
  /** Anything else beside the chips (a source, on Today). */
  extra?: ReactNode
  /** Makes the row something to drag (onto Today's plan, briefing/DayPlan.tsx). */
  drag?: RowDrag
  /** The list's selection, when it has one. */
  selection?: RowSelection
}

/**
 * What a row needs to be one of a selection (Tasks lists only; Today and the calendar pass none).
 * The list owns the selection; the row reports the keys and clicks that change it, and, when it is
 * one of two or more selected rows, hands the keys that act on all of them to `onMany`.
 */
export interface RowSelection {
  selected: boolean
  /** How many rows are selected in the list. */
  count: number
  /** Shift+Up / Shift+Down: extends the selection and returns the row to focus. */
  onExtend: (direction: 1 | -1) => string | null
  /** Shift+click. */
  onRange: () => void
  /** Escape, a plain click. */
  onClear: () => void
  /** The row menu's "Select all in this list". */
  onSelectAll: () => void
  /** A key that acts on the selection (the row is one of two or more); `anchor` is where its menu opens. */
  onMany: (action: ManyAction, anchor: HTMLElement) => void
}

/** What lets a row be dragged somewhere. */
export interface RowDrag {
  draggable: true
  onDragStart: (event: ReactDragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

type Editing = { field: TaskField; anchor: PopoverAnchor } | null

export function TaskRow(props: TaskRowProps): JSX.Element {
  const {
    task,
    today,
    heading,
    depth = 0,
    tabStop,
    current,
    calm,
    folding,
    onToggle,
    onOpen,
    onLeave,
    onIndent,
    onOutdent,
    emptyChips,
    extra,
    drag,
    selection
  } = props
  const locale = useHome((state) => state.locale)
  const words = TASK_COPY[locale]
  const [editing, setEditing] = useState<Editing>(null)
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState<PopoverAnchor>(null)
  const rowRef = useRef<HTMLLIElement>(null)
  // Folding runs from the row's own height (a long title wraps), so nothing jumps at its start.
  useLayoutEffect(() => {
    if (folding && rowRef.current) rowRef.current.style.setProperty('--fold-from', `${rowRef.current.offsetHeight}px`)
  }, [folding])
  const chips = useRef<Partial<Record<TaskField, HTMLElement | null>>>({})

  const title = task.title || words.untitled
  const due = task.due ? dueLabel(task.due, today, heading, words.days) : null
  // Under the heading of its own day the chip says only the time, or shows a calendar.
  const dueText = due?.text ?? ''
  const dueFull = task.due ? dueLabel(task.due, today, undefined, words.days).text : ''
  const repeat = repeatWords(task, words, locale)

  const edit = (field: TaskField, anchor?: HTMLElement | null): void =>
    setEditing({ field, anchor: anchor ?? chips.current[field] ?? rowRef.current })
  const leave = (): void => onLeave?.(task.id)
  const toggle = (): void => {
    // A calm row stays a moment: the focus moves on when it folds away (useTaskRows).
    if (!task.done && !calm) leave()
    onToggle(task)
  }
  const remove = (): void => {
    leave()
    deleteTask(task.id)
  }
  const pickPriority = (level: Priority | null): void => {
    setPriority(task.id, level)
    announce(level === null ? words.noPriority : words.priorityName(level))
  }

  const menuItems = (): MenuItem[] => [
    { id: 'date', label: words.field.date, hint: 'D', onSelect: () => edit('date') },
    { id: 'repeat', label: words.field.repeat, hint: 'R', onSelect: () => edit('repeat') },
    { id: 'priority', label: words.field.priority, hint: '1–4', submenu: priorityItems(task.priority, words, pickPriority) },
    { id: 'project', label: words.field.project, hint: '#', onSelect: () => edit('project') },
    { id: 'labels', label: words.field.labels, hint: '@', onSelect: () => edit('labels') },
    { id: 'remind', label: words.field.remind, hint: 'L', onSelect: () => edit('remind') },
    ...(task.project && !task.done
      ? [
          {
            id: 'next',
            label: words.makeNext,
            onSelect: () => {
              if (!task.project) return
              setNextAction(task.project.id, task.id)
              announce(words.nextSet(title))
            }
          }
        ]
      : []),
    { separator: true },
    { id: 'rename', label: words.rename, hint: 'F2', onSelect: () => setRenaming(true) },
    { id: 'open', label: words.openPage, onSelect: () => openPage(task.id) },
    { id: 'tab', label: words.openInTab, hint: 'Ctrl+Enter', onSelect: () => openPage(task.id, { newTab: true }) },
    ...(selection ? [{ separator: true } as const, { id: 'select-all', label: words.selectAll, onSelect: selection.onSelectAll }] : []),
    { separator: true },
    { id: 'delete', label: words.delete, hint: 'Del', danger: true, onSelect: remove }
  ]

  const onKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>): void => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === ']' || event.key === '[')) {
      const move = event.key === ']' ? onIndent : onOutdent
      if (move) {
        event.preventDefault()
        move()
      }
      return
    }
    if (takeMenuKey(event)) {
      event.preventDefault()
      setMenu(keyboardAnchor(event.currentTarget))
      return
    }
    if (selection && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        event.stopPropagation()
        const to = selection.onExtend(event.key === 'ArrowDown' ? 1 : -1)
        if (to) focusRow(event.currentTarget, to)
        return
      }
      if (event.key === 'Escape' && selection.count > 0) {
        event.preventDefault()
        event.stopPropagation()
        selection.onClear()
        return
      }
    }
    const action = rowKeyAction(event)
    if (!action) return
    const many = selection?.selected && selection.count >= 2 ? manyKeyAction(action) : null
    if (selection && many) {
      event.preventDefault()
      event.stopPropagation()
      selection.onMany(many, event.currentTarget)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    runAction(action)
  }

  const runAction = (action: RowAction): void => {
    switch (action.kind) {
      case 'open':
        if (action.newTab) openPage(task.id, { newTab: true })
        else onOpen(task)
        break
      case 'rename':
        setRenaming(true)
        break
      case 'edit':
        edit(action.field)
        break
      case 'priority':
        pickPriority(nextPriority(task.priority, action.level))
        break
      case 'toggle':
        toggle()
        break
      case 'delete':
        remove()
        break
    }
  }

  const onClick = (event: ReactMouseEvent<HTMLLIElement>): void => {
    if (renaming) return
    if (event.ctrlKey || event.metaKey) openPage(task.id, { newTab: true })
    else if (event.shiftKey && selection) selection.onRange()
    else {
      if (selection && selection.count > 0) selection.onClear()
      onOpen(task)
    }
  }

  const onContextMenu = (event: ReactMouseEvent<HTMLLIElement>): void => {
    if (renaming) return
    event.preventDefault()
    if (isMenuKeyEcho()) return
    setMenu({ x: event.clientX, y: event.clientY })
  }

  const chip = (field: TaskField, content: ReactNode, value: string, className = '', style?: CSSProperties): JSX.Element => (
    <button
      type="button"
      tabIndex={-1}
      className={`task-chip is-${field}${className ? ` ${className}` : ''}`}
      style={style}
      ref={(el) => {
        chips.current[field] = el
      }}
      aria-label={words.change(words.field[field], value)}
      title={words.change(words.field[field], value)}
      onClick={(event) => {
        event.stopPropagation()
        edit(field, event.currentTarget)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {content}
    </button>
  )
  const empty = (field: TaskField): JSX.Element | null =>
    emptyChips?.includes(field) ? chip(field, words.addField[field], words.none, 'is-empty') : null

  const details = [
    selection?.selected ? words.selectedRow : '',
    dueFull,
    task.recurrence ? `${words.repeats}: ${repeat}` : '',
    task.priority ? words.priorityName(task.priority) : '',
    task.project ? `#${task.project.name}` : '',
    ...task.labels.map((label) => `@${label.name}`)
  ].filter(Boolean)

  const classes = ['task-row']
  if (task.done) classes.push('is-done')
  if (current) classes.push('is-current')
  if (calm) classes.push('is-calm')
  if (folding) classes.push('is-folding')
  if (selection?.selected) classes.push('is-selected')

  return (
    <li
      ref={rowRef}
      className={classes.join(' ')}
      style={{ '--depth': depth } as CSSProperties}
      data-task-row=""
      data-task-id={task.id}
      tabIndex={tabStop ? 0 : -1}
      aria-label={words.rowLabel(title, details)}
      aria-current={current ? 'true' : undefined}
      aria-keyshortcuts={KEYS}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onMouseDown={(event) => {
        // Shift+click picks a range: it must not also select the text between the rows.
        if (selection && event.shiftKey) event.preventDefault()
      }}
      onContextMenu={onContextMenu}
      onPointerEnter={preloadTaskEditors}
      onFocus={preloadTaskEditors}
      {...(drag && !renaming ? drag : {})}
    >
      <button
        type="button"
        tabIndex={-1}
        className={task.priority ? `task-check is-p${task.priority}` : 'task-check'}
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? words.reopen(title) : words.complete(title)}
        onClick={(event) => {
          event.stopPropagation()
          toggle()
        }}
      >
        {calm && (
          <svg className="task-tick" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 6.5 L5 9 L10 3" />
          </svg>
        )}
      </button>
      <span className="task-body">
        {renaming ? (
          <TitleEditor
            initial={task.title}
            today={today}
            onCommit={(text, ignored) => {
              setRenaming(false)
              renameTask(task.id, text, ignored)
              rowRef.current?.focus({ preventScroll: true })
            }}
            onCancel={() => {
              setRenaming(false)
              rowRef.current?.focus({ preventScroll: true })
            }}
          />
        ) : (
          <span
            className="task-title"
            onDoubleClick={(event) => {
              event.stopPropagation()
              setRenaming(true)
            }}
          >
            {title}
          </span>
        )}
        <span className="task-chips">
          {due
            ? chip(
                'date',
                dueText || <Calendar size={12} />,
                dueFull,
                [due.overdue && !task.done ? 'is-overdue' : '', dueText ? '' : 'is-icon'].filter(Boolean).join(' ')
              )
            : empty('date')}
          {task.recurrence && chip('repeat', '↻', repeat, 'is-icon')}
          {task.priority
            ? chip('priority', `P${task.priority}`, words.priorityName(task.priority), `is-p${task.priority}`)
            : empty('priority')}
          {task.project ? chip('project', `#${task.project.name}`, task.project.name) : empty('project')}
          {task.labels.map((label, index) => (
            <button
              key={label.id}
              type="button"
              tabIndex={-1}
              className="task-chip is-labels"
              style={tagStyle(label.color)}
              ref={
                index === 0
                  ? (el) => {
                      chips.current.labels = el
                    }
                  : undefined
              }
              aria-label={words.change(words.field.labels, label.name)}
              onClick={(event) => {
                event.stopPropagation()
                edit('labels', event.currentTarget)
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              @{label.name}
            </button>
          ))}
          {!task.labels.length && empty('labels')}
          {extra}
        </span>
      </span>
      <span className="task-side">
        {selection?.selected && (
          <span className="task-selected-mark" aria-hidden="true">
            ✓
          </span>
        )}
        {(onIndent || onOutdent) && (
          <span className="task-moves">
            {onOutdent && (
              <button
                type="button"
                tabIndex={-1}
                className="task-move"
                title="Ctrl+["
                aria-label={`← ${title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onOutdent()
                }}
              >
                ←
              </button>
            )}
            {onIndent && (
              <button
                type="button"
                tabIndex={-1}
                className="task-move"
                title="Ctrl+]"
                aria-label={`→ ${title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onIndent()
                }}
              >
                →
              </button>
            )}
          </span>
        )}
        <button
          type="button"
          tabIndex={-1}
          className="task-more"
          aria-label={words.more(title)}
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation()
            setMenu(event.currentTarget)
          }}
        >
          ⋯
        </button>
      </span>
      {menu && (
        <Popover open anchor={menu} onClose={() => setMenu(null)} role="none">
          {/* Clicks and keys in the menu are not the row's. */}
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <Menu autoFocus items={menuItems()} onClose={() => setMenu(null)} />
          </div>
        </Popover>
      )}
      {editing && (
        <TaskFieldPopover
          taskId={task.id}
          field={editing.field}
          anchor={editing.anchor}
          onClose={() => {
            setEditing(null)
            rowRef.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </li>
  )
}

/**
 * One Tab stop for a list of task rows (roving tabindex): the row focused last, else the first.
 * Arrows, Home and End move along; a row about to leave hands the focus to its neighbour; a row
 * drawn again elsewhere (its date moved it to another group) keeps the focus.
 */
export function useTaskRows(ids: readonly string[]): {
  stop: string | null
  leave: (id: string) => void
  listProps: {
    ref: (el: HTMLElement | null) => void
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
    onFocus: (event: FocusEvent<HTMLElement>) => void
    onBlur: (event: FocusEvent<HTMLElement>) => void
  }
} {
  const [focused, setFocused] = useState<string | null>(null)
  const container = useRef<HTMLElement | null>(null)
  const inside = useRef(false)
  /** Where the focused row was in the list. */
  const position = useRef(0)
  const stop = focused && ids.includes(focused) ? focused : (ids[0] ?? null)

  const rowEl = (id: string): HTMLElement | null =>
    container.current?.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-task-id="${CSS.escape(id)}"]`) ?? null

  // The focused row was drawn again somewhere else (or the focus fell to <body> as it was): back to it.
  // When it left the list (an edit moved it out, as a date does on Today), to the row now in its place.
  useLayoutEffect(() => {
    if (!inside.current || !focused) return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    const place = ids.length ? ids[Math.min(position.current, ids.length - 1)] : null
    const el = rowEl(focused) ?? (place ? rowEl(place) : null)
    el?.focus({ preventScroll: true })
  })

  const leave = useCallback((id: string): void => {
    const rows = [...(container.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? [])]
    const index = rows.findIndex((row) => row.dataset.taskId === id)
    const next = rows[index + 1] ?? rows[index - 1]
    if (index < 0 || !next) return
    setFocused(next.dataset.taskId ?? null)
    next.focus({ preventScroll: true })
  }, [])

  return {
    stop,
    leave,
    listProps: {
      ref: (el) => {
        container.current = el
      },
      onKeyDown: (event) => {
        // A list inside this one (the panel's subtasks) took the key already.
        if (event.defaultPrevented) return
        const target = event.target as HTMLElement
        if (!target.matches?.(ROW_SELECTOR) || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
        if (moveFocusAmong(event.currentTarget, ROW_SELECTOR, event.key, 'vertical')) event.preventDefault()
      },
      onFocus: (event) => {
        // Focus events come up the React tree: from a row, and from the editor or menu a row
        // opened (drawn elsewhere, in a popover), which still count as being in the list.
        inside.current = true
        const row = (event.target as HTMLElement).closest?.(ROW_SELECTOR) as HTMLElement | null
        if (!row || !event.currentTarget.contains(row)) return
        const id = row.dataset.taskId ?? null
        setFocused(id)
        if (id && ids.includes(id)) position.current = ids.indexOf(id)
      },
      onBlur: (event) => {
        // Gone somewhere else on purpose. Into a popover (a row's editor or menu, drawn outside
        // the list) the list still has it: when that row leaves, the focus comes back to the list.
        // A row taken out of the page gives no place to go.
        const to = event.relatedTarget
        if (to instanceof Element && !event.currentTarget.contains(to) && !to.closest('.ui-popover')) inside.current = false
        else if (!to) {
          // Nowhere: a click on empty space (the row is still there) or the row taken away.
          const from = event.target as Node
          requestAnimationFrame(() => {
            if (from.isConnected && !container.current?.contains(document.activeElement)) inside.current = false
          })
        }
      }
    }
  }
}
