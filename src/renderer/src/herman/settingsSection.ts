// The Herman section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

// Herman's settings bring his figure and his stylesheet with them.
export const HERMAN_SECTION = settingsSection({
  id: 'herman',
  label: 'Herman',
  keywords: ['assistant', 'persona', 'herman', 'hermine'],
  order: 60,
  Section: lazyPanel(() => import('./HermanSettings').then((module) => module.HermanSection))
})
