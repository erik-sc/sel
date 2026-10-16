/**
 * The home: the one place the Home button, `go-home` and (if the user wants) start-up open.
 * It is a page or one of the built-in screens, and it is the same on every device: the
 * `home` setting syncs (settings/home.json, see main/sync/format.ts). What the app does when it
 * starts, `shell.startup`, is chosen per device and never leaves it.
 * Shared by the main process, which validates and syncs it, and the renderer. Pure.
 */

export const HOME_SETTING = 'home'
export const STARTUP_SETTING = 'shell.startup'

/** The screens that can be the home (their routes, see renderer/src/store/tabs.ts). */
export const HOME_SCREENS = ['_today', '_tasks', '_calendar', '_notebook'] as const
export type HomeScreen = (typeof HOME_SCREENS)[number]

export type Home = { kind: 'page'; id: string } | { kind: 'screen'; route: HomeScreen } | null

/** Restore the tabs (the default), open the home, or both with the home first. */
export const STARTUP_MODES = ['tabs', 'home', 'both'] as const
export type StartupMode = (typeof STARTUP_MODES)[number]

/** The shape of a block id (the backend enforces the same). */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** The home a stored or received value names, null for none, or undefined when it is not a home at all. */
export function cleanHome(value: unknown): Home | undefined {
  if (value === null || value === undefined) return null
  if (!isPlain(value)) return undefined
  if (value['kind'] === 'page' && Object.keys(value).length === 2) {
    const id = value['id']
    return typeof id === 'string' && ID_RE.test(id) && id !== '__proto__' ? { kind: 'page', id } : undefined
  }
  if (value['kind'] === 'screen' && Object.keys(value).length === 2) {
    const route = value['route']
    return (HOME_SCREENS as readonly unknown[]).includes(route) ? { kind: 'screen', route: route as HomeScreen } : undefined
  }
  return undefined
}

/** What start-up does on this device; anything unknown is the default. */
export function cleanStartup(value: unknown): StartupMode {
  return (STARTUP_MODES as readonly unknown[]).includes(value) ? (value as StartupMode) : 'tabs'
}

/** What a tab shows for the home: the page's id or the screen's route. */
export function homeTarget(home: Home): string | null {
  return home === null ? null : home.kind === 'page' ? home.id : home.route
}

export function sameHome(a: Home, b: Home): boolean {
  return homeTarget(a) === homeTarget(b) && (a?.kind ?? null) === (b?.kind ?? null)
}
