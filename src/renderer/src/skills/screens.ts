// The Skills screen. Leaf data for ../screens.ts: the mount point loads when a tab shows it.
import { lazy } from 'react'
import { SKILLS_ROUTE } from '@/routes'
import type { Screen } from '@/screens'

export const SKILLS_SCREENS: readonly Screen[] = [
  { route: SKILLS_ROUTE, title: 'Skills', Host: lazy(() => import('./Host').then((module) => ({ default: module.SkillsHost }))) }
]
