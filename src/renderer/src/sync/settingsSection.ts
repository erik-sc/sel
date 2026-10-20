// The Sync section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

// Most people open Settings for something else.
export const SYNC_SECTION = settingsSection({
  id: 'sync',
  label: 'Sync',
  keywords: ['git', 'devices', 'backup'],
  order: 80,
  Section: lazyPanel(() => import('./SyncSettings').then((module) => module.SyncSection))
})
