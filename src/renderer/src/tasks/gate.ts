// The always-loaded part of Tasks: its route, the way to reach it, and which list the screen
// shows (kept here so it survives switching tabs). The screen itself is a chunk of its own
// (see Host.tsx).
import { create } from 'zustand'
import { TASKS_ROUTE } from '@/routes'
import { openScreen } from '@/store/tabs'

/** What the screen lists: a fixed list, a project or label (by option id), or one of the database's views. */
export type TaskListKey =
  | { kind: 'inbox' | 'refine' | 'today' | 'upcoming' | 'completed' }
  | { kind: 'project' | 'label'; id: string }
  | { kind: 'view'; id: string }

interface TasksGate {
  list: TaskListKey
  /** Bumped to ask the quick-add input for focus. */
  focus: number
  /** The refine mode (Refine.tsx), walking the Inbox's tasks to refine or all of them; null when off. */
  refining: RefineFrom | null
  /** Bumped to ask the list on screen to select all its tasks (the "Select all in this list" command). */
  selectAll: number
}

/** Which tasks the refine mode walks: those of the Inbox, or every one still to refine. */
export type RefineFrom = 'inbox' | 'refine'

export const useTasksGate = create<TasksGate>(() => ({ list: { kind: 'today' }, focus: 0, refining: null, selectAll: 0 }))

export function showTaskList(list: TaskListKey): void {
  useTasksGate.setState({ list })
}

/** Puts the caret in the quick-add input (once the screen is there). */
export function focusQuickAdd(): void {
  useTasksGate.setState((state) => ({ focus: state.focus + 1 }))
}

/** Selects every task of the list the screen shows (once the screen is there). */
export function selectAllTasks(): void {
  useTasksGate.setState((state) => ({ selectAll: state.selectAll + 1 }))
}

/** True in the small window the system-wide quick-add shortcut opens (`?quickadd=1`, see main/tasks/window.ts). */
export function isQuickAddWindow(): boolean {
  return new URLSearchParams(window.location.search).get('quickadd') === '1'
}

export function isTasksRoute(pageId: string | null | undefined): boolean {
  return pageId === TASKS_ROUTE
}

export function openTasks(): void {
  openScreen(TASKS_ROUTE)
}

/** Opens Tasks on the list and starts the refine mode over it (from Herman, a notification, Today, the palette). */
export function startRefine(from: RefineFrom = 'refine'): void {
  openTasks()
  useTasksGate.setState({ list: { kind: from }, refining: from })
}

export function stopRefine(): void {
  useTasksGate.setState({ refining: null })
}

export function loadTasksScreen(): Promise<typeof import('./TasksScreen')> {
  return import('./TasksScreen')
}

/** Starts fetching the screen; call it when the pointer reaches a way in. */
export function preloadTasks(): void {
  void loadTasksScreen().catch(() => undefined)
}
