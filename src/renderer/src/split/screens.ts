// The household screen. Leaf data for ../screens.ts: the mount point loads when a tab shows it.
import { lazy } from 'react'
import { SPLIT_ROUTE } from '@/routes'
import type { Screen } from '@/screens'

export const SPLIT_SCREENS: readonly Screen[] = [
  { route: SPLIT_ROUTE, title: 'Shared bills', Host: lazy(() => import('./Host').then((module) => ({ default: module.SplitHost }))) }
]
