/**
 * Appearance engine: a zustand store holding only the user's overrides of the tokens in
 * styles/tokens.css, written to one <style id="appearance-overrides"> element that is kept
 * after every other stylesheet. Persisted under the `appearance` setting and mirrored to
 * other windows over a BroadcastChannel.
 */
import { create } from 'zustand'
import { LEGACY_NAME, modernizeUrls } from '../../../shared/legacy'
import { readMirror, writeMirror } from '../boot'
import { notifyError } from '../ui/toast'
import { PRESET_MAP } from './presets'
import {
  buildCss,
  cleanValue,
  countOverrides,
  emptyAppearance,
  readAppearanceMessage,
  sanitizeAppearance,
  sanitizeCustomCss
} from './sanitize'
import type { AppearanceData, AppearanceMessage } from './sanitize'
import { TOKENS, TOKEN_MAP, defaultValue } from './schema'
import type { ThemeName, TokenGroup } from './schema'
import { isSkin } from './skins'

export type { AppearanceData } from './sanitize'
export type TokenScope = ThemeName | 'current'

const SETTING_KEY = 'appearance'
const STYLE_ID = 'appearance-overrides'
const CHANNEL_NAME = 'appearance'
const SAVE_DELAY = 400
/** Synchronous copy of the saved overrides, applied before the first frame (see boot.ts). */
const MIRROR_KEY = 'appearance'
const FILE_FORMAT = 'sel-theme'
/** Themes exported under the app's earlier name are still themes. */
const LEGACY_FILE_FORMAT = `${LEGACY_NAME}-theme`
/** Largest theme file accepted, in characters (and, before reading, in bytes). */
export const MAX_IMPORT_LENGTH = 2_000_000

export const useAppearance = create<AppearanceData>(() => emptyAppearance())

// ---- applying ----

function paint(data: AppearanceData): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
  }
  const css = buildCss(data)
  if (el.textContent !== css) el.textContent = css
  const root = document.documentElement
  if (data.skin === null) delete root.dataset.skin
  else if (root.dataset.skin !== data.skin) root.dataset.skin = data.skin
  // Stylesheets injected later (lazy chunks, hot reload) must not end up after the overrides.
  keepLast(el)
}

function keepLast(el: HTMLStyleElement): void {
  if (el.parentNode !== document.head || document.head.lastElementChild !== el) document.head.appendChild(el)
}

let headObserver: MutationObserver | null = null

/**
 * Lazily loaded chunks append their stylesheets to <head> whenever they arrive; the
 * overrides (custom CSS in particular) have to stay after them to keep winning.
 */
function watchHead(): void {
  if (headObserver || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  headObserver = new MutationObserver(() => {
    const el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    // Moving the element is itself a mutation; the second pass finds it last and stops.
    if (el) keepLast(el)
  })
  headObserver.observe(document.head, { childList: true })
}

// ---- persistence and cross-window sync ----

let saveTimer: ReturnType<typeof setTimeout> | null = null

function flushSave(): void {
  if (saveTimer === null) return
  clearTimeout(saveTimer)
  saveTimer = null
  writeMirror(MIRROR_KEY, useAppearance.getState())
  window.api.app
    .setSetting(SETTING_KEY, { version: 1, ...useAppearance.getState() })
    .catch((error) => notifyError('Your appearance changes could not be saved.', error))
}

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, SAVE_DELAY)
}

let channel: BroadcastChannel | null = null

function openChannel(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event) => {
    // Another window changed the look: adopt it without saving or echoing it back. The
    // message is validated and sanitised like a file; anything unexpected is ignored.
    const data = readAppearanceMessage(event.data)
    if (!data) return
    useAppearance.setState(data, true)
    paint(data)
    writeMirror(MIRROR_KEY, data)
  }
}

function commit(data: AppearanceData): void {
  useAppearance.setState(data, true)
  paint(data)
  scheduleSave()
  const message: AppearanceMessage = { type: 'appearance', version: 1, data }
  channel?.postMessage(message)
}

/**
 * Applies the mirrored overrides synchronously, before the first render. The mirror goes
 * through the same sanitiser as the setting. Returns false when there is none yet (first
 * run): the caller then waits for initAppearance() to avoid a flash.
 */
export function bootAppearance(): boolean {
  const saved = readMirror(MIRROR_KEY)
  if (!saved || typeof saved !== 'object') return false
  const data = sanitizeAppearance(saved)
  useAppearance.setState(data, true)
  paint(data)
  watchHead()
  return true
}

/** Loads saved overrides and applies them. Authoritative: replaces whatever bootAppearance() showed. */
export async function initAppearance(): Promise<void> {
  openChannel()
  watchHead()
  window.addEventListener('pagehide', flushSave)
  const saved = await window.api.app.getSetting<unknown>(SETTING_KEY).catch((error) => {
    console.error('could not load appearance', error)
    return null
  })
  // An edit made while the setting was loading is newer than it.
  if (saveTimer !== null) return
  const data = sanitizeAppearance(saved)
  useAppearance.setState(data, true)
  paint(data)
  writeMirror(MIRROR_KEY, data)
}

// ---- api ----

export function currentTheme(): ThemeName {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function bucketOf(name: string, scope: TokenScope): 'light' | 'dark' | 'shared' | null {
  const token = TOKEN_MAP[name]
  if (!token) return null
  if (!token.themed) return 'shared'
  return scope === 'current' ? currentTheme() : scope
}

/**
 * Overrides one token. Returns false, changing nothing, when the value is not valid for it.
 * Tokens without a dark variant always go to the shared set, whatever the scope.
 */
export function setToken(name: string, value: string, scope: TokenScope = 'current'): boolean {
  const bucket = bucketOf(name, scope)
  if (!bucket) return false
  const token = TOKEN_MAP[name]
  const clean = cleanValue(token, value)
  if (clean === null) return false
  const state = useAppearance.getState()
  const map = { ...state[bucket] }
  if (clean === defaultValue(token, bucket === 'dark' ? 'dark' : 'light')) delete map[name]
  else map[name] = clean
  commit({ ...state, [bucket]: map, presetId: null })
  return true
}

export function resetToken(name: string, scope: TokenScope = 'current'): void {
  const bucket = bucketOf(name, scope)
  const state = useAppearance.getState()
  if (!bucket || !Object.hasOwn(state[bucket], name)) return
  const map = { ...state[bucket] }
  delete map[name]
  commit({ ...state, [bucket]: map, presetId: null })
}

/** Resets a group. With a scope, themed tokens are reset for that theme only. */
export function resetGroup(group: TokenGroup, scope?: TokenScope): void {
  const state = useAppearance.getState()
  const theme = scope === undefined ? null : scope === 'current' ? currentTheme() : scope
  const light = { ...state.light }
  const dark = { ...state.dark }
  const shared = { ...state.shared }
  for (const token of TOKENS) {
    if (token.group !== group) continue
    delete shared[token.name]
    if (theme !== 'dark') delete light[token.name]
    if (theme !== 'light') delete dark[token.name]
  }
  commit({ ...state, light, dark, shared, presetId: null })
}

/** Removes every token override in both themes and the window style. Custom CSS is kept. */
export function resetAll(): void {
  commit({ ...emptyAppearance(), customCss: useAppearance.getState().customCss })
}

/** Replaces all token overrides and the window style with a preset's. Custom CSS is kept. */
export function applyPreset(id: string): boolean {
  const preset = PRESET_MAP[id]
  if (!preset) return false
  commit(
    sanitizeAppearance({
      light: preset.light,
      dark: preset.dark,
      shared: preset.shared,
      customCss: useAppearance.getState().customCss,
      presetId: id,
      skin: preset.skin ?? null
    })
  )
  return true
}

/** Switches the window style, keeping the colours. Null is the plain style. */
export function setSkin(skin: string | null): boolean {
  if (skin !== null && !isSkin(skin)) return false
  const state = useAppearance.getState()
  if (state.skin !== skin) commit({ ...state, skin })
  return true
}

export function setCustomCss(css: string): void {
  const customCss = sanitizeCustomCss(css)
  const state = useAppearance.getState()
  if (customCss !== state.customCss) commit({ ...state, customCss })
}

export function exportJson(): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, ...useAppearance.getState() }, null, 2)
}

export function importJson(text: string): { ok: boolean; error?: string } {
  if (text.length > MAX_IMPORT_LENGTH) return { ok: false, error: 'The file is too large to be a theme.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(modernizeUrls(text))
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'The file is not a sel theme.' }
  }
  const record = parsed as Record<string, unknown>
  const hasContent = ['light', 'dark', 'shared', 'customCss', 'skin'].some((key) => key in record)
  if (!hasContent || ('format' in record && record.format !== FILE_FORMAT && record.format !== LEGACY_FILE_FORMAT)) {
    return { ok: false, error: 'The file is not a sel theme.' }
  }
  const data = sanitizeAppearance(record)
  const supplied = ['light', 'dark', 'shared'].reduce((sum, key) => {
    const map = record[key]
    return sum + (typeof map === 'object' && map !== null ? Object.keys(map).length : 0)
  }, 0)
  if (supplied > 0 && countOverrides(data) === 0 && !data.customCss) {
    return { ok: false, error: 'The file has no values this version understands.' }
  }
  commit(data)
  return { ok: true }
}

