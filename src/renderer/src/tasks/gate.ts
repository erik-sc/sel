// The always-loaded part of Tasks: its route, the way to reach it, and which list the screen
// shows (kept here so it survives switching tabs). The screen itself is a chunk of its own
// (see Host.tsx).
import { create } from 'zustand'
import { TASKS_ROUTE } from '@/routes'
import { openScreen } from '@/store/tabs'

/** What the screen lists: a fixed list, a project or label (by option id), or one of the database's views. */
export type TaskListKey =
  | { kind: 'inbox' | 'today' | 'upcoming' | 'completed' }
  | { kind: 'project' | 'label'; id: string }
  | { kind: 'view'; id: string }

interface TasksGate {
  list: TaskListKey
  /** Bumped to ask the quick-add input for focus. */
  focus: number
}

export const useTasksGate = create<TasksGate>(() => ({ list: { kind: 'today' }, focus: 0 }))

export function showTaskList(list: TaskListKey): void {
  useTasksGate.setState({ list })
}

/** Puts the caret in the quick-add input (once the screen is there). */
export function focusQuickAdd(): void {
  useTasksGate.setState((state) => ({ focus: state.focus + 1 }))
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

export function loadTasksScreen(): Promise<typeof import('./TasksScreen')> {
  return import('./TasksScreen')
}

/** Starts fetching the screen; call it when the pointer reaches a way in. */
export function preloadTasks(): void {
  void loadTasksScreen().catch(() => undefined)
}
