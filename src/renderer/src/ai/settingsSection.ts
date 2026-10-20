// The AI section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

export const AI_SECTION = settingsSection({
  id: 'ai',
  label: 'AI',
  keywords: ['claude', 'assistant'],
  order: 50,
  Section: lazyPanel(() => import('./AiSettings').then((module) => module.AiSection)),
  withDialog: true
})
