// The window's side of the feature that does not exist (see src/shared/fake): its screen and what
// its command does. A real feature writes this with `defineFeature` (../feature.ts), which checks
// its handlers against `MenuCommand`; the fixture's command is not one, so it is typed by hand.
import { createElement, lazy } from 'react'
import { FAKE_ROUTE } from '@shared/fake'
import type { MenuHandler } from '@/feature'
import type { Screen } from '@/screens'
import { openScreen } from '@/store/tabs'

export const FAKE_SCREENS: readonly Screen[] = [
  { route: FAKE_ROUTE, title: 'Fake', Host: lazy(async () => ({ default: () => createElement('p', null, 'Nothing here') })) }
]

export const fakeFeature = {
  id: 'fake',
  menu: { 'open-fake': { run: () => openScreen(FAKE_ROUTE) } } satisfies Record<string, MenuHandler>
}
