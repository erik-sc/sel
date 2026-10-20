// The briefing's two screens. Leaf data for ../screens.ts: the mount points load when a tab shows them.
import { lazy } from 'react'
import { CALENDAR_ROUTE, TODAY_ROUTE } from '@/routes'
import type { Screen } from '@/screens'

export const BRIEFING_SCREENS: readonly Screen[] = [
  { route: TODAY_ROUTE, title: 'Today', Host: lazy(() => import('./Host').then((module) => ({ default: module.TodayHost }))) },
  { route: CALENDAR_ROUTE, title: 'Calendar', Host: lazy(() => import('./Host').then((module) => ({ default: module.CalendarHost }))) }
]
