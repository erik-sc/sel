// The History section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

export const HISTORY_SECTION = settingsSection({
  id: 'history',
  label: 'History',
  keywords: ['versions', 'snapshots'],
  order: 40,
  Section: lazyPanel(() => import('./HistorySettings').then((module) => module.HistorySection)),
  withDialog: true
})
