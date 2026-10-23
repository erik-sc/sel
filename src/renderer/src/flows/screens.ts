// The Fluxos screen. Leaf data for ../screens.ts: the mount point loads when a tab shows it.
import { lazy } from 'react'
import { FLOWS_ROUTE } from '@/routes'
import type { Screen } from '@/screens'

export const FLOWS_SCREENS: readonly Screen[] = [
  { route: FLOWS_ROUTE, title: 'Flows', Host: lazy(() => import('./Host').then((module) => ({ default: module.FlowsHost }))) }
]
