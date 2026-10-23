// The small part of the AI feature that is always loaded: whether it is on, what is open, and
// the triggers the shell and the editor call. Everything with a face (the conversation balloon,
// setup sheet, inline preview) is in chunks of its own, fetched when one of these triggers asks.
import { create } from 'zustand'
import { AI_ONBOARDED_KEY, type AiStatus } from '@shared/ai'
import { AI_CONTEXT_CAPS, AI_CONTEXT_PAGES_KEY, contextPageIds } from '@shared/aiContext'
import { AI_CONVERSATIONS_KEY } from '@shared/aiHistory'
import { notifyError } from '../ui/toast'
import { aiPrivacyNow, loadAncestors } from './privacy'

/** Which explanation the setup sheet opens with. */
export type AiSetupReason = 'not-installed' | 'not-logged-in'

/** A page-level action asked for from outside the editor (the page menu). */
export interface AiPageCommand {
  pageId: string
  /** `consolidate`: the notes of a recorded meeting, from its transcript (see meetings/). */
  action: 'summarize' | 'title' | 'consolidate'
  /** Distinguishes two identical commands in a row. */
  nonce: number
}

/** Where the persona's introduction was opened from: the balloon opens after it when it was the balloon. */
export type OnboardingFrom = 'balloon' | 'settings' | 'command'

/** What the open page offers the conversation balloon: the text in scope and a way to put an answer in. */
export interface AiEditorBridge {
  pageId: string
  /** Inserts Markdown as blocks: below the caret's block, or over the selection in scope. One undo step. */
  insert(markdown: string, mode: 'below' | 'replace'): boolean
}

interface AiGate {
  /** `ai.enabled`. False until the setting has loaded: no AI entry point shows before that. */
  enabled: boolean
  /** The conversation balloon (by the persona, or in the corner without it) is open. */
  balloonOpen: boolean
  setup: AiSetupReason | null
  status: AiStatus | null
  command: AiPageCommand | null
  editor: AiEditorBridge | null
  /** The selected text of the open page, kept while the focus is in the balloon. */
  scope: { pageId: string; text: string } | null
  /** Pages pinned as context for every request (`ai.contextPages`, Settings → AI → Context). */
  contextPages: string[]
  /** The persona's introduction (0.8.0 A1), while it is open. */
  onboarding: { from: OnboardingFrom } | null
  /** Whether it was shown (`ai.onboarded`); null until known. Only false shows it by itself. */
  onboarded: boolean | null
}

export const useAiGate = create<AiGate>(() => ({
  enabled: false,
  balloonOpen: false,
  setup: null,
  status: null,
  command: null,
  editor: null,
  scope: null,
  contextPages: [],
  onboarding: null,
  onboarded: null
}))

export function aiEnabled(): boolean {
  return useAiGate.getState().enabled
}

export async function initAi(): Promise<void> {
  const [value, pages] = await Promise.all([
    window.api.app.getSetting<unknown>('ai.enabled').catch(() => null),
    window.api.app.getSetting<unknown>(AI_CONTEXT_PAGES_KEY).catch(() => null)
  ])
  useAiGate.setState({ enabled: value !== false, contextPages: contextPageIds(pages) })
  void loadOnboarded()
}

/**
 * Whether the introduction was shown. A profile that already has conversations used the AI before
 * the introduction existed: for it, the first time has passed, and it is marked so, quietly.
 */
async function loadOnboarded(): Promise<void> {
  try {
    if ((await window.api.app.getSetting<unknown>(AI_ONBOARDED_KEY)) === true) {
      useAiGate.setState({ onboarded: true })
      return
    }
    const earlier = await window.api.app.getSetting<unknown>(AI_CONVERSATIONS_KEY)
    if (Array.isArray(earlier) && earlier.length > 0) {
      useAiGate.setState({ onboarded: true })
      await window.api.app.setSetting(AI_ONBOARDED_KEY, true)
      return
    }
    useAiGate.setState({ onboarded: false })
  } catch (error) {
    // Unknown: it never shows by itself, and nothing else changes.
    console.error('ai: whether the introduction was shown could not be read', error)
  }
}

/** Opens the persona's introduction (the balloon closes meanwhile). */
export function openOnboarding(from: OnboardingFrom): void {
  if (!useAiGate.getState().enabled) return
  useAiGate.setState({ onboarding: { from }, balloonOpen: false })
}

/**
 * Opens the introduction when it was never shown (the first time the AI is used, or turned on).
 * True when it opened.
 */
export function maybeOnboard(from: OnboardingFrom): boolean {
  const { enabled, onboarded, onboarding } = useAiGate.getState()
  if (!enabled || onboarded !== false || onboarding) return false
  openOnboarding(from)
  return true
}

/**
 * Closes the introduction, finished or skipped: either way it does not come back by itself. Opened
 * from the balloon, the balloon opens now.
 */
export function closeOnboarding(): void {
  const { onboarding } = useAiGate.getState()
  if (!onboarding) return
  useAiGate.setState({ onboarding: null, onboarded: true, ...(onboarding.from === 'balloon' ? { balloonOpen: true } : {}) })
  window.api.app
    .setSetting(AI_ONBOARDED_KEY, true)
    .catch((error: unknown) => console.error('ai: the introduction could not be marked as shown', error))
}

/** Stores the pinned pages; the old list comes back if it could not be stored. */
export async function setContextPages(ids: string[]): Promise<void> {
  const previous = useAiGate.getState().contextPages
  const next = contextPageIds(ids)
  useAiGate.setState({ contextPages: next })
  try {
    await window.api.app.setSetting(AI_CONTEXT_PAGES_KEY, next.length ? next : null)
  } catch (error) {
    useAiGate.setState({ contextPages: previous })
    throw error
  }
}

/**
 * Pins a page as context, or unpins it. Says why when it could not be pinned: the list is full,
 * or the page is private from the AI (itself, or a page it is in: those above it are read first).
 */
export async function toggleContextPage(id: string): Promise<'pinned' | 'unpinned' | 'full' | 'private'> {
  const pinned = useAiGate.getState().contextPages
  if (pinned.includes(id)) {
    await setContextPages(pinned.filter((entry) => entry !== id))
    return 'unpinned'
  }
  await loadAncestors(id)
  if (aiPrivacyNow(id)) return 'private'
  if (pinned.length >= AI_CONTEXT_CAPS.pages) return 'full'
  await setContextPages([...pinned, id])
  return 'pinned'
}

export function setAiEnabled(enabled: boolean): void {
  useAiGate.setState(enabled ? { enabled } : { enabled, balloonOpen: false, setup: null, command: null, status: null })
}

/** Opens or closes the conversation balloon. The very first time, the persona introduces itself instead. */
export function toggleAssistant(): void {
  const { enabled, balloonOpen } = useAiGate.getState()
  if (!enabled) return
  if (!balloonOpen && maybeOnboard('balloon')) return
  useAiGate.setState({ balloonOpen: !balloonOpen })
}

export function closeAssistant(): void {
  if (useAiGate.getState().balloonOpen) useAiGate.setState({ balloonOpen: false })
}

export function openAiSetup(reason: AiSetupReason): void {
  useAiGate.setState({ setup: reason })
}

export function closeAiSetup(): void {
  useAiGate.setState({ setup: null })
}

/** Asks the main process whether the program is there; remembers the answer for the UI. */
export async function refreshAiStatus(refresh = false): Promise<AiStatus> {
  const status = await window.api.ai.status(refresh)
  useAiGate.setState({ status })
  return status
}

/**
 * The check every AI entry point starts with. True when requests can run; otherwise the
 * setup sheet opens (the one place that explains what is missing) and the action is dropped.
 */
export async function aiReady(): Promise<boolean> {
  if (!aiEnabled()) return false
  try {
    const status = await refreshAiStatus()
    if (status.available) return true
    if (status.reason !== 'disabled') openAiSetup('not-installed')
    return false
  } catch (error) {
    notifyError('Could not check for Claude Code.', error)
    return false
  }
}

let commandNonce = 0

/** Runs a page-level action in the editor showing `pageId`. */
export function requestPageAi(pageId: string, action: AiPageCommand['action']): void {
  void aiReady().then((ready) => {
    if (ready) useAiGate.setState({ command: { pageId, action, nonce: ++commandNonce } })
  })
}
