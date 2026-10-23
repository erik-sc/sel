// The small part of the AI feature that is always loaded: whether it is on, what is open, and
// the triggers the shell and the editor call. Everything with a face (the conversation balloon,
// setup sheet, inline preview) is in chunks of its own, fetched when one of these triggers asks.
import { create } from 'zustand'
import type { AiStatus } from '@shared/ai'
import { AI_CONTEXT_CAPS, AI_CONTEXT_PAGES_KEY, contextPageIds } from '@shared/aiContext'
import { notifyError } from '../ui/toast'

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
}

export const useAiGate = create<AiGate>(() => ({
  enabled: false,
  balloonOpen: false,
  setup: null,
  status: null,
  command: null,
  editor: null,
  scope: null,
  contextPages: []
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

/** Pins a page as context, or unpins it. False when it could not be pinned because the list is full. */
export function toggleContextPage(id: string): Promise<boolean> {
  const pinned = useAiGate.getState().contextPages
  if (pinned.includes(id)) return setContextPages(pinned.filter((entry) => entry !== id)).then(() => true)
  if (pinned.length >= AI_CONTEXT_CAPS.pages) return Promise.resolve(false)
  return setContextPages([...pinned, id]).then(() => true)
}

export function setAiEnabled(enabled: boolean): void {
  useAiGate.setState(enabled ? { enabled } : { enabled, balloonOpen: false, setup: null, command: null, status: null })
}

/** Opens or closes the conversation balloon. */
export function toggleAssistant(): void {
  const { enabled, balloonOpen } = useAiGate.getState()
  if (enabled) useAiGate.setState({ balloonOpen: !balloonOpen })
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
