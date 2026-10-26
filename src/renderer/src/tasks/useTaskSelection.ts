// The selection of a Tasks list as the screen holds it (the model is selection.ts): it follows the
// list, so a task that is completed, deleted or moved to another list drops out of it, and every
// change that matters is said politely ("3 selected").
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { announce } from '@/a11y/announce'
import { useHome } from '@/home/store'
import { TASK_COPY } from './copy'
import type { ManyAction } from './model'
import type { RowSelection } from './TaskRow'
import { extend, isSelected, NO_SELECTION, prune, selectAll, selectRange, type Selection } from './selection'

export interface TaskSelection {
  selection: Selection
  count: number
  has: (id: string) => boolean
  /** Shift+arrow from `focused`: the row to focus, or null when `focused` is not in the list. */
  extend: (focused: string, direction: 1 | -1) => string | null
  /** Shift+click on `id`; `from` is the row last focused, where a range with no selection starts. */
  range: (id: string, from: string | null) => void
  selectAll: () => void
  clear: () => void
  /** For the list's own keydown, after it moved the focus: the plain arrows, Home and End let go of the selection. */
  onListKey: (event: KeyboardEvent) => void
  /** Ends the selection without a word (the list changed). */
  reset: () => void
}

/** `order` is the list's rows as they are on screen, top to bottom. */
export function useTaskSelection(order: readonly string[]): TaskSelection {
  const [held, setHeld] = useState<Selection>(NO_SELECTION)
  const words = TASK_COPY[useHome((state) => state.locale)]
  const selection = useMemo(() => prune(held, order), [held, order])
  // Keep what the state holds in step with the list: a row that comes back later is not selected again.
  useEffect(() => {
    if (selection !== held) setHeld(selection)
  }, [selection, held])

  const reset = useCallback((): void => setHeld(NO_SELECTION), [])
  const clear = (): void => {
    if (!selection.ids.length) return
    setHeld(NO_SELECTION)
    announce(words.selectionCleared)
  }
  const say = useCallback((next: Selection): void => announce(words.selected(next.ids.length)), [words])

  return {
    selection,
    count: selection.ids.length,
    has: (id) => isSelected(selection, id),
    extend: (focused, direction) => {
      if (!order.includes(focused)) return null
      const result = extend(selection, order, focused, direction)
      setHeld(result.selection)
      say(result.selection)
      return result.focus
    },
    range: (id, from) => {
      const next = selectRange(selection, order, id, from)
      setHeld(next)
      say(next)
    },
    selectAll: () => {
      const next = selectAll(order)
      setHeld(next)
      if (next.ids.length) say(next)
    },
    reset,
    onListKey: (event) => {
      const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
      if (plain && selection.ids.length > 0 && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) clear()
    },
    clear
  }
}

/**
 * What a row of the list is given to be one of the selection. `from` is the row last focused (the
 * list's Tab stop), where Shift+click starts a range when nothing is selected yet; `onMany` runs
 * the keys that act on all the selected rows.
 */
export function rowSelectionOf(
  picked: TaskSelection,
  id: string,
  from: string | null,
  onMany: (action: ManyAction, anchor: HTMLElement) => void
): RowSelection {
  return {
    selected: picked.has(id),
    count: picked.count,
    onExtend: (direction) => picked.extend(id, direction),
    onRange: () => picked.range(id, from),
    onClear: picked.clear,
    onSelectAll: picked.selectAll,
    onMany
  }
}
