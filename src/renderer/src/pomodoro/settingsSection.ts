// The Pomodoro section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

export const POMODORO_SECTION = settingsSection({
  id: 'pomodoro',
  label: 'Pomodoro',
  keywords: ['timer', 'focus', 'break', 'tomato'],
  order: 110,
  Section: lazyPanel(() => import('./PomodoroSettings').then((module) => module.PomodoroSection))
})
