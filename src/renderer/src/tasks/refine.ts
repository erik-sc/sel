// The refine mode's model (docs/plans/tasks-refine.md, 9c): which tasks it walks, the keys of its
// card, and how a key moves the walk on. Pure: no React, no DOM, no store; Refine.tsx draws it
// and does what a key asks of the task itself (a field, the name, the trash).
import { refineList } from '@shared/tasks/refine'
import type { TaskField } from './copy'
import type { RefineFrom } from './gate'
import type { TaskItem } from './lists'
import type { Priority } from './model'

/**
 * The ids the walk goes through, oldest first: every task still to refine, or only those in the
 * Inbox (no project). Taken once, when the walk starts: a task refined on the way stays in its place.
 */
export function refineQueue(tasks: readonly TaskItem[], from: RefineFrom): string[] {
  return refineList(tasks)
    .filter((task) => from === 'refine' || !task.project)
    .map((task) => task.id)
}

export interface RefineState {
  queue: readonly string[]
  /** The task on the card. */
  index: number
  /** Passed with S (or →): left as it was, for another time. */
  skipped: readonly string[]
  /** Past the last task: the card says so and waits to be closed. */
  done: boolean
}

export function startRefineState(queue: readonly string[]): RefineState {
  return { queue: [...queue], index: 0, skipped: [], done: queue.length === 0 }
}

/** The task on the card, or null at the end. */
export function currentTask(state: RefineState): string | null {
  return state.done ? null : (state.queue[state.index] ?? null)
}

/** What a key asks of the walk (`next`, `skip`, `back`, `delete`, `exit`) or of the task on the card. */
export type RefineCommand =
  | { kind: 'next' }
  | { kind: 'skip' }
  | { kind: 'back' }
  | { kind: 'delete' }
  | { kind: 'exit' }
  | { kind: 'rename' }
  | { kind: 'edit'; field: TaskField }
  | { kind: 'priority'; level: Priority }

interface Keyed {
  key: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

const LETTERS: Readonly<Record<string, TaskField>> = { d: 'date', r: 'repeat', l: 'remind' }

/**
 * The command of a key pressed on the card, or null when the card lets it go (Tab, keys with
 * Ctrl, Alt or the system key: the app has those). `#` and `@` are read as typed, whatever the
 * layout puts them under. The same letters as a focused task row (model.ts), and the walk's own:
 * Enter next, S skip, Delete delete, Escape leave, ← back.
 */
export function refineKeyAction(event: Keyed): RefineCommand | null {
  const { key } = event
  if (event.ctrlKey || event.altKey || event.metaKey) return null
  if (key === 'Escape') return { kind: 'exit' }
  if (key === '#') return { kind: 'edit', field: 'project' }
  if (key === '@') return { kind: 'edit', field: 'labels' }
  if (event.shiftKey) return null
  switch (key) {
    case 'Enter':
      return { kind: 'next' }
    case 'Delete':
      return { kind: 'delete' }
    case 'ArrowLeft':
      return { kind: 'back' }
    case 'ArrowRight':
      return { kind: 'skip' }
    case 'F2':
      return { kind: 'rename' }
  }
  if (key.length !== 1) return null
  if (key >= '1' && key <= '4') return { kind: 'priority', level: Number(key) as Priority }
  const letter = key.toLowerCase()
  if (letter === 's') return { kind: 'skip' }
  const field = LETTERS[letter]
  return field ? { kind: 'edit', field } : null
}

/**
 * The walk after a command. `next` and `skip` go on (past the last, it is done), `back` returns
 * one, `delete` takes the task out of the walk and shows the one after it. Anything else is about
 * the task, not the walk: the state is the same.
 */
export function refineStep(state: RefineState, command: RefineCommand): RefineState {
  const id = currentTask(state)
  switch (command.kind) {
    case 'next':
    case 'skip': {
      if (state.done || id === null) return state
      const skipped = command.kind === 'skip' ? [...state.skipped.filter((each) => each !== id), id] : state.skipped.filter((each) => each !== id)
      const index = state.index + 1
      return index >= state.queue.length ? { ...state, skipped, index: state.queue.length - 1, done: true } : { ...state, skipped, index }
    }
    case 'back':
      if (state.queue.length === 0) return state
      if (state.done) return { ...state, done: false, index: state.queue.length - 1 }
      return state.index > 0 ? { ...state, index: state.index - 1 } : state
    case 'delete': {
      if (state.done || id === null) return state
      const queue = state.queue.filter((each) => each !== id)
      const skipped = state.skipped.filter((each) => each !== id)
      if (state.index >= queue.length) return { queue, skipped, index: Math.max(0, queue.length - 1), done: true }
      return { ...state, queue, skipped }
    }
    default:
      return state
  }
}
