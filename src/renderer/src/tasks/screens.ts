// The Tasks screen. Leaf data for ../screens.ts: the mount point loads when a tab shows it.
import { lazy } from 'react'
import { TASKS_ROUTE } from '@/routes'
import type { Screen } from '@/screens'

export const TASKS_SCREENS: readonly Screen[] = [
  { route: TASKS_ROUTE, title: 'Tasks', Host: lazy(() => import('./Host').then((module) => ({ default: module.TasksHost }))) }
]
