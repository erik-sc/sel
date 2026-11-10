// The Finance screen. Leaf data for ../screens.ts: the mount point loads when a tab shows it.
import { lazy } from 'react'
import { FINANCE_ROUTE } from '@/routes'
import type { Screen } from '@/screens'

export const FINANCE_SCREENS: readonly Screen[] = [
  { route: FINANCE_ROUTE, title: 'Finances', Host: lazy(() => import('./Host').then((module) => ({ default: module.FinanceHost }))) }
]
