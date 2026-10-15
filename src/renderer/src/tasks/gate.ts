// The always-loaded part of Tasks: its route, the way to reach it, and which list the screen
// shows (kept here so it survives switching tabs). The screen itself is a chunk of its own
// (see Host.tsx).
import { create } from 'zustand'
import { openScreen, TASKS_ROUTE } from '@/store/tabs'

export { TASKS_ROUTE }

export const TASKS_TITLE = 'Tasks'

/** What the screen lists: a fixed list, a project or label (by option id), or one of the database's views. */
export type TaskListKey =
  | { kind: 'inbox' | 'today' | 'upcoming' | 'completed' }
  | { kind: 'project' | 'label'; id: string }
  | { kind: 'view'; id: string }

export const useTasksGate = create<{ list: TaskListKey }>(() => ({ list: { kind: 'today' } }))

export function showTaskList(list: TaskListKey): void {
  useTasksGate.setState({ list })
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
