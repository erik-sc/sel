// The Sky. Leaf data for ../screens.ts: the mount point loads when a tab shows it. The Sky's own
// page is shown as its screen: it holds what happened, not notes.
import { lazy } from 'react'
import { SKY_ID } from '@shared/sky'
import { SKY_ROUTE } from '@/routes'
import type { Screen } from '@/screens'

export const SKY_SCREENS: readonly Screen[] = [
  { route: SKY_ROUTE, title: 'Sky', alias: SKY_ID, Host: lazy(() => import('./Host').then((module) => ({ default: module.SkyHost }))) }
]
