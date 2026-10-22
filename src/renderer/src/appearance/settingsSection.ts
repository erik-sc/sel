// The Appearance section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

export const APPEARANCE_SECTION = settingsSection({
  id: 'appearance',
  label: 'Appearance',
  keywords: ['colours', 'colors', 'font', 'look'],
  order: 20,
  Section: lazyPanel(() => import('./AppearancePanel').then((module) => module.AppearancePanel)),
  withDialog: true
})
