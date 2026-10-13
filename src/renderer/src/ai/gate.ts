// The small part of the AI feature that is always loaded: whether it is on, what is open, and
// the triggers the shell and the editor call. Everything with a face (assistant panel, setup
// sheet, inline preview) is in chunks of its own, fetched when one of these triggers asks.
import { create } from 'zustand'
import type { AiStatus } from '@shared/ai'
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

/** What the open page offers the assistant panel: the text in scope and a way to put an answer in. */
export interface AiEditorBridge {
  pageId: string
  /** Inserts Markdown as blocks: below the caret's block, or over the selection in scope. One undo step. */
  insert(markdown: string, mode: 'below' | 'replace'): boolean
}

interface AiGate {
  /** `ai.enabled`. False until the setting has loaded: no AI entry point shows before that. */
  enabled: boolean
  panelOpen: boolean
  setup: AiSetupReason | null
  status: AiStatus | null
  command: AiPageCommand | null
  editor: AiEditorBridge | null
  /** The selected text of the open page, kept while the focus is in the assistant panel. */
  scope: { pageId: string; text: string } | null
}

export const useAiGate = create<AiGate>(() => ({
  enabled: false,
  panelOpen: false,
  setup: null,
  status: null,
  command: null,
  editor: null,
  scope: null
}))

export function aiEnabled(): boolean {
  return useAiGate.getState().enabled
}

export async function initAi(): Promise<void> {
  const value = await window.api.app.getSetting<unknown>('ai.enabled').catch(() => null)
  useAiGate.setState({ enabled: value !== false })
}

export function setAiEnabled(enabled: boolean): void {
  useAiGate.setState(enabled ? { enabled } : { enabled, panelOpen: false, setup: null, command: null, status: null })
}

export function toggleAssistant(): void {
  const { enabled, panelOpen } = useAiGate.getState()
  if (enabled) useAiGate.setState({ panelOpen: !panelOpen })
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
