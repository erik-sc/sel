// The Today section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

export const TODAY_SECTION = settingsSection({
  id: 'today',
  label: 'Today',
  keywords: ['calendar', 'briefing', 'bell', 'close the day', 'sky', 'céu', 'hemisphere', 'rare nights'],
  order: 90,
  Section: lazyPanel(() => import('./TodaySettings').then((module) => module.TodaySection)),
  withDialog: true
})
