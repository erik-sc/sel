// The Meetings section of Settings (see shell/settingsSections.ts). Leaf data: the panel is fetched when shown.
import { settingsSection } from '@/shell/sectionSpec'
import { lazyPanel } from '@/ui/lazyPanel'

export const MEETINGS_SECTION = settingsSection({
  id: 'meetings',
  label: 'Meetings',
  keywords: ['recording', 'transcription', 'whisper'],
  order: 100,
  Section: lazyPanel(() => import('./MeetingsSettings').then((module) => module.MeetingsSection))
})
