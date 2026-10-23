// The weekly review. Leaf data for ../screens.ts: the mount point loads when a tab shows it.
import { lazy } from 'react'
import { REVIEW_ROUTE } from '@/routes'
import type { Screen } from '@/screens'

export const REVIEW_SCREENS: readonly Screen[] = [
  { route: REVIEW_ROUTE, title: 'Weekly review', Host: lazy(() => import('./Host').then((module) => ({ default: module.ReviewHost }))) }
]
