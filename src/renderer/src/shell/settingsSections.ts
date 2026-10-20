// The sections of Settings: the window's list (SettingsDialog.tsx) and the palette's
// "Settings: …" commands (commands/builtin.ts) both read this. Each feature describes its own
// (`<feature>/settingsSection.ts`); this lists them, one line each. Leaf data: a section's panel
// is fetched the first time it is shown.
import { APPEARANCE_SECTION } from '@/appearance/settingsSection'
import { AI_SECTION } from '@/ai/settingsSection'
import { NOTIFICATIONS_SECTION } from '@/alarms/settingsSection'
import { TODAY_SECTION } from '@/briefing/settingsSection'
import { MCP_SECTION } from '@/external/settingsSection'
import { HERMAN_SECTION } from '@/herman/settingsSection'
import { MEETINGS_SECTION } from '@/meetings/settingsSection'
import { POMODORO_SECTION } from '@/pomodoro/settingsSection'
import { SYNC_SECTION } from '@/sync/settingsSection'
import { lazyPanel } from '@/ui/lazyPanel'
import { HISTORY_SECTION } from '@/versions/settingsSection'
import { settingsSection, type SettingsSectionSpec } from './sectionSpec'
import { SIDEBAR_KEYWORDS } from './sidebarCopy'

const GENERAL_SECTION = settingsSection({
  id: 'general',
  label: 'General',
  keywords: ['import', 'theme', 'home', 'startup'],
  order: 10,
  Section: lazyPanel(() => import('./GeneralSettings').then((module) => module.GeneralSection)),
  withDialog: true
})

// The sidebar's layout brings its list editor with it.
const SIDEBAR_SECTION = settingsSection({
  id: 'sidebar',
  label: 'Sidebar',
  keywords: SIDEBAR_KEYWORDS,
  order: 30,
  Section: lazyPanel(() => import('./SidebarSettings').then((module) => module.SidebarSection))
})

const LISTED = [
  GENERAL_SECTION,
  APPEARANCE_SECTION,
  SIDEBAR_SECTION,
  HISTORY_SECTION,
  AI_SECTION,
  HERMAN_SECTION,
  NOTIFICATIONS_SECTION,
  SYNC_SECTION,
  TODAY_SECTION,
  MEETINGS_SECTION,
  POMODORO_SECTION,
  MCP_SECTION
] as const

/** A section of Settings, by its id. */
export type SettingsSection = (typeof LISTED)[number]['id']

/** Every section, in the list's order. */
export const SETTINGS_SECTIONS: readonly SettingsSectionSpec<SettingsSection>[] = [...LISTED].sort((a, b) => a.order - b.order)

/** Fetches the panels that show at once with the window (`withDialog`). */
export function preloadDialogSections(): Promise<unknown> {
  return Promise.all(SETTINGS_SECTIONS.filter((section) => section.withDialog).map((section) => section.Section.preload()))
}
