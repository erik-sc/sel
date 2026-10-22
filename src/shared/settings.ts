/**
 * Which settings a renderer may write, and what is stored for each. Every feature declares its
 * own spec next to its keys (src/shared/<feature>); `SETTINGS` below lists them, one line each,
 * and main checks `app:setSetting` against that list and nothing else (src/main/validate.ts).
 * Pure: free of Electron and the DOM.
 *
 * What changing a setting does in the main process (a timer that follows, a cache that goes
 * stale) belongs to the feature's main side: its `onSettingChanged` in src/main/features.ts.
 */
import { ALARMS_SETTINGS } from './alarms'
import { AI_SETTINGS } from './ai'
import { BRIEFING_SETTINGS } from './briefing'
import { HERMAN_SETTINGS } from './herman'
import { HOME_SETTINGS } from './home'
import { MCP_SETTINGS } from './mcp'
import { MEETINGS_SETTINGS } from './meetings'
import { NOTEBOOK_SETTINGS } from './notebook'
import { POMODORO_SETTINGS } from './pomodoro'
import { SIDEBAR_SETTINGS } from './sidebar'
import { SKY_SETTINGS } from './sky'
import { REFINE_SETTINGS } from './tasks/refine'
import { UPDATES_SETTINGS } from './updates'
import { HISTORY_SETTINGS } from './versions'

export interface SettingsSpec {
  /** Exact keys a renderer may write. Nothing else in their namespace is writable unless `namespaces` says so. */
  readonly keys?: readonly string[]
  /** `<namespace>.<anything>` keys a renderer may write, stored as given within the size cap. An exact key wins over these. */
  readonly namespaces?: readonly string[]
  /**
   * What is stored for one of `keys`, or undefined when the value is not one it takes. Null (and
   * undefined) never reach it: they reset the key. Without it a value is stored as given, within the size cap.
   */
  readonly clean?: (key: string, value: unknown) => unknown
  /** Keys whose value only a native dialog in main may set: a renderer can clear them, never name one. */
  readonly dialogOnly?: { readonly keys: readonly string[]; readonly message: string }
  /**
   * Keys that sync, each with the setting that records when it last changed on this device:
   * writing the key stamps it, so the newer of two devices' changes stands.
   */
  readonly syncedAt?: Readonly<Record<string, string>>
}

/** The shell's own keys: the theme, the appearance (synced) and the per-device layout namespaces. */
export const CORE_SETTINGS: SettingsSpec = {
  keys: ['theme', 'appearance'],
  namespaces: ['shell', 'database', 'editor', 'appearance', 'ui'],
  syncedAt: { appearance: 'sync.appearanceAt' }
}

/** Every writable setting. A feature adds its spec here, one line. */
export const SETTINGS: readonly SettingsSpec[] = [
  CORE_SETTINGS,
  HOME_SETTINGS,
  SIDEBAR_SETTINGS,
  HISTORY_SETTINGS,
  AI_SETTINGS,
  BRIEFING_SETTINGS,
  MEETINGS_SETTINGS,
  HERMAN_SETTINGS,
  UPDATES_SETTINGS,
  MCP_SETTINGS,
  NOTEBOOK_SETTINGS,
  ALARMS_SETTINGS,
  POMODORO_SETTINGS,
  SKY_SETTINGS,
  REFINE_SETTINGS
]

/** The spec a key is written under: one that names it exactly, else one that owns its namespace; null when none does. */
export function settingsSpecOf(key: string, specs: readonly SettingsSpec[] = SETTINGS): { spec: SettingsSpec; exact: boolean } | null {
  for (const spec of specs) if (spec.keys?.includes(key)) return { spec, exact: true }
  const dot = key.indexOf('.')
  if (dot <= 0) return null
  const namespace = key.slice(0, dot)
  for (const spec of specs) if (spec.namespaces?.includes(namespace)) return { spec, exact: false }
  return null
}

/**
 * The value stored for an exact key of a spec that cleans its values: null resets it, a value the
 * spec does not take throws, and so does any value for a key only a dialog may set.
 */
export function cleanSettingValue(spec: SettingsSpec, key: string, value: unknown): unknown {
  if (value === undefined || value === null) return null
  if (spec.dialogOnly?.keys.includes(key)) throw new Error(spec.dialogOnly.message)
  const clean = spec.clean ? spec.clean(key, value) : value
  if (clean === undefined) throw new Error('Invalid setting value')
  return clean
}

/** The setting that records when `key` last changed here, when it is a synced one. */
export function syncedAtOf(key: string, specs: readonly SettingsSpec[] = SETTINGS): string | null {
  const found = settingsSpecOf(key, specs)
  return (found?.exact && found.spec.syncedAt?.[key]) || null
}
