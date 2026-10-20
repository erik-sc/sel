// Meditations and the closing of the day. Leaf data for ../screens.ts: the mount points load when a
// tab shows them. The notebook's own page is shown as its screen: its past days never change.
import { lazy } from 'react'
import { NOTEBOOK_ID } from '@shared/notebook'
import { CLOSE_ROUTE, NOTEBOOK_ROUTE } from '@/routes'
import type { Screen } from '@/screens'

export const NOTEBOOK_SCREENS: readonly Screen[] = [
  {
    route: NOTEBOOK_ROUTE,
    title: 'Meditations',
    alias: NOTEBOOK_ID,
    Host: lazy(() => import('./Host').then((module) => ({ default: module.NotebookHost })))
  },
  { route: CLOSE_ROUTE, title: 'Close the day', Host: lazy(() => import('./Host').then((module) => ({ default: module.CloseDayHost }))) }
]
