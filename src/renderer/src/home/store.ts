// The home as this window knows it: which page or screen it is (the synced `home` setting),
// what start-up does on this device (`shell.startup`), and the language its words are in.
// Small and always loaded: the sidebar's Home button reads it.
import { create } from 'zustand'
import type { Block } from '@shared/types'
import { cleanHome, cleanStartup, HOME_SETTING, homeTarget, STARTUP_SETTING, type Home, type StartupMode } from '@shared/home'
import { fetchBlocks, getBlock, useBlock, useBlockStatus, type BlockStatus } from '@/store/blocks'
import { openScreen } from '@/store/tabs'
import { setSettingsOpen, useUi } from '@/store/ui'
import { useSync } from '@/sync/store'
import { notifyError, toast } from '@/ui/toast'
import { HOME_COPY, homeLocale, type HomeCopy, type HomeLocale } from './copy'

interface HomeState {
  home: Home
  startup: StartupMode
  locale: HomeLocale
}

export const useHome = create<HomeState>(() => ({ home: null, startup: 'tabs', locale: homeLocale(null, navigator.language) }))

/** Other windows of this app hear about a home chosen here on this channel. */
const CHANNEL_NAME = 'home'

/**
 * Whether the home can be opened: `none` when there is no home, `trashed` when its page is in
 * the Trash, `missing` when the page is not on this device (deleted, or not synced here yet).
 * An archived page is still a home.
 */
export type HomeStatus = 'none' | 'ready' | 'loading' | 'trashed' | 'missing'

export function homeStatus(home: Home, block: Block | undefined, status: BlockStatus): HomeStatus {
  if (home === null) return 'none'
  if (home.kind === 'screen') return 'ready'
  if (block) return block.trashedAt ? 'trashed' : 'ready'
  return status === 'missing' ? 'missing' : 'loading'
}

export function useHomeCopy(): HomeCopy {
  return HOME_COPY[useHome((state) => state.locale)]
}

/** The home and whether it can be opened, kept current as its page changes. */
export function useHomeStatus(): { home: Home; status: HomeStatus; block: Block | undefined } {
  const home = useHome((state) => state.home)
  const pageId = home?.kind === 'page' ? home.id : null
  const block = useBlock(pageId)
  const status = useBlockStatus(pageId)
  return { home, status: homeStatus(home, block, status), block }
}

/** Why the Home button cannot open the home, or null when it can. */
export function homeHint(status: HomeStatus, copy: HomeCopy): string | null {
  return status === 'none' ? copy.choose : status === 'trashed' ? copy.trashed : status === 'missing' ? copy.missing : null
}

async function reload(): Promise<void> {
  const [home, startup, language] = await Promise.all([
    window.api.app.getSetting<unknown>(HOME_SETTING),
    window.api.app.getSetting<unknown>(STARTUP_SETTING),
    window.api.app.getSetting<unknown>('ai.language')
  ])
  useHome.setState({ home: cleanHome(home) ?? null, startup: cleanStartup(startup), locale: homeLocale(language, navigator.language) })
}

let started = false

/** Loads the home, and follows it when another window or a sync changes it. */
export function initHome(): void {
  if (started) return
  started = true
  const reloadQuietly = (): void => void reload().catch((error) => console.error('could not load the home', error))
  reloadQuietly()
  if (typeof BroadcastChannel !== 'undefined') new BroadcastChannel(CHANNEL_NAME).onmessage = reloadQuietly
  // A sync may have brought another device's home.
  useSync.subscribe((state, previous) => {
    if (state.status.lastSyncAt !== previous.status.lastSyncAt) reloadQuietly()
  })
}

function tellOtherWindows(): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.postMessage('changed')
  channel.close()
}

export async function setHome(home: Home): Promise<void> {
  const previous = useHome.getState().home
  useHome.setState({ home })
  try {
    await window.api.app.setSetting(HOME_SETTING, home)
    tellOtherWindows()
  } catch (error) {
    useHome.setState({ home: previous })
    notifyError(HOME_COPY[useHome.getState().locale].saveFailed, error)
  }
}

export async function setStartup(startup: StartupMode): Promise<void> {
  const previous = useHome.getState().startup
  useHome.setState({ startup })
  try {
    await window.api.app.setSetting(STARTUP_SETTING, startup)
    tellOtherWindows()
  } catch (error) {
    useHome.setState({ startup: previous })
    notifyError(HOME_COPY[useHome.getState().locale].saveFailed, error)
  }
}

/** Opens Settings on General, where the home is chosen. */
export function chooseHome(): void {
  useUi.setState({ settingsSection: 'general' })
  setSettingsOpen(true)
}

/**
 * The Home button, `go-home` and Ctrl+Alt+H: the tab that already shows the home, else the
 * active tab when it is blank, else a new tab. Without a home, Settings opens where one is chosen.
 */
export function goHome(): void {
  const { home, locale } = useHome.getState()
  const copy = HOME_COPY[locale]
  if (home === null) return chooseHome()
  const target = homeTarget(home)!
  if (home.kind === 'screen') return openScreen(target)
  const open = (block: Block | undefined): void => {
    const status = homeStatus(home, block, 'missing')
    const hint = homeHint(status, copy)
    if (hint) toast(hint)
    else openScreen(target)
  }
  const cached = getBlock(target)
  if (cached) return open(cached)
  void fetchBlocks(() => window.api.blocks.getMany([target]))
    .then((blocks) => open(blocks.find((block) => block.id === target)))
    .catch((error) => console.error('could not open the home', error))
}
