// What a section of Settings is (see ./settingsSections.ts). A leaf, so that each feature's
// descriptor can use it without importing the list.
import type { LazyPanel } from '@/ui/lazyPanel'

export interface SettingsSectionSpec<Id extends string = string> {
  id: Id
  /** In the list, as the title above the panel, and after "Settings: " in the palette. */
  label: string
  /** Other words the palette finds it by, besides "preferences" and "options". */
  keywords: readonly string[]
  /** Its place in the list, ten apart. */
  order: number
  /** Its panel, fetched the first time it is shown. */
  Section: LazyPanel
  /** Fetched along with the Settings window, so it shows at once: a small panel that is often the first one open. */
  withDialog?: boolean
}

/** Keeps a section's id as a literal type, for `SettingsSection`. */
export function settingsSection<const Id extends string>(spec: SettingsSectionSpec<Id>): SettingsSectionSpec<Id> {
  return spec
}
