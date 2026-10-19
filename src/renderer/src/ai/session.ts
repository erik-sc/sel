// The editor's side of an inline AI action: what is being asked, about which part of the page,
// and where the answer will go. A session lives in the editor's UI state while its preview is
// on screen; nothing is written to the page until the user accepts (see `acceptAi`).
// Part of the editor chunk: small, no UI. The preview itself is loaded on demand (slot.tsx).
import type { AiAction, AiLanguage, AiRequest, AiTone } from '@shared/ai'
import { getBlock, newId } from '@/store/blocks'
import type { EditorController } from '@/editor/controller'
import { isTextType } from '@/editor/blockTypes'
import { rtLength, slice, textOf } from '@/editor/richtext-dom'
import { liveChildren, prevVisible, topLevel } from '@/editor/structure'
import { textSel, type Sel } from '@/editor/types'
import { aiEnabled, aiReady, useAiGate } from './gate'
import { planAccept, type AiTarget } from './plan'

/** The mark AI entry points wear. */
export const AI_GLYPH = '\u2726'

export interface AiSession {
  /** Changes with every session, so that a new one never inherits the state of the last. */
  key: number
  /** Null while the prompt bar is waiting for the user to say what to write. */
  action: AiAction | null
  target: AiTarget
  /** False keeps what is selected and puts the answer below it. */
  replace: boolean
  /** The preview is shown after this block; null shows it first in the page. */
  anchorId: string | null
  /** The parts of the request that do not change between tries. */
  base: Pick<AiRequest, 'pageId' | 'blockIds' | 'selectionText' | 'tone' | 'language'>
  /** Where the caret goes back to when the answer is discarded. */
  restore: Sel
  /** Placeholder of the prompt bar. */
  prompt?: string
  /** Markdown added after the answer when it is accepted (the heading over the notes that were there). */
  suffix?: string
}

/** How much text before the caret is sent along for "Continue writing". */
const BEFORE_CARET_CHARS = 2000
let nextKey = 0

function open(ctrl: EditorController, session: Omit<AiSession, 'key'>): number {
  const key = ++nextKey
  ctrl.closeSlash()
  ctrl.ui.setState({ ai: { ...session, key }, menu: null })
  return key
}

/**
 * Opens the session once the program is known to be there; the setup sheet opens instead when
 * it is not. The check asks the main process, and the first one of a run of the app starts the
 * program to read its version, which takes a moment. So nothing waits for it when it can be
 * avoided: a prompt bar (only a text field) and anything asked for after a check that passed
 * open at once, and are taken away again if the check comes back saying no.
 */
function start(ctrl: EditorController, build: () => Omit<AiSession, 'key'> | null): void {
  if (!aiEnabled()) return
  // What the action is about is read now: by the time the check answers, the selection may be gone.
  const session = build()
  if (!session) return
  if (session.action === null || useAiGate.getState().status?.available === true) {
    const key = open(ctrl, session)
    void aiReady().then((ready) => {
      if (!ready && ctrl.ui.getState().ai?.key === key) discardAi(ctrl)
    })
    return
  }
  void aiReady().then((ready) => {
    if (ready) open(ctrl, session)
  })
}

/** The text before `offset` in a block, with as much of the blocks above it as fits. */
function textBefore(ctrl: EditorController, blockId: string, offset: number): string {
  const parts: string[] = []
  let length = 0
  const own = textOf(slice(getBlock(blockId)?.props.title, 0, offset))
  if (own) {
    parts.unshift(own)
    length += own.length
  }
  let id = prevVisible(ctrl.tree, blockId)
  while (id && id !== ctrl.pageId && length < BEFORE_CARET_CHARS) {
    const text = textOf(getBlock(id)?.props.title)
    if (text) {
      parts.unshift(text)
      length += text.length
    }
    id = prevVisible(ctrl.tree, id)
  }
  return parts.join('\n').slice(-BEFORE_CARET_CHARS)
}

export interface AiOptions {
  tone?: AiTone
  language?: AiLanguage
}

/** An action on the text selected inside one block (the selection toolbar). `null` asks what to do first. */
export function aiOnRange(
  ctrl: EditorController,
  action: AiAction | null,
  range: { id: string; start: number; end: number },
  options: AiOptions = {}
): void {
  start(ctrl, () => {
    ctrl.flush(range.id)
    const text = textOf(slice(getBlock(range.id)?.props.title, range.start, range.end))
    if (!text.trim()) return null
    return {
      action,
      target: { kind: 'range', blockId: range.id, start: range.start, end: range.end },
      replace: action !== 'explain',
      anchorId: range.id,
      base: { pageId: ctrl.pageId, selectionText: text, ...options },
      restore: textSel(range.id, range.start, range.end),
      prompt: 'Tell AI what to do with the selection…'
    }
  })
}

/** An action on selected blocks (the block menu). */
export function aiOnBlocks(ctrl: EditorController, action: AiAction | null, ids: readonly string[], options: AiOptions = {}): void {
  start(ctrl, () => {
    ctrl.flushAll()
    const tops = topLevel(ctrl.tree, ids)
    if (!tops.length) return null
    return {
      action,
      target: { kind: 'blocks', ids: tops },
      replace: action !== 'explain' && action !== 'summarize' && action !== 'actions',
      anchorId: tops[tops.length - 1],
      base: { pageId: ctrl.pageId, blockIds: tops, ...options },
      restore: { kind: 'blocks', ids: tops },
      prompt: 'Tell AI what to do with these blocks…'
    }
  })
}

/** "Continue writing" at the caret. */
export function aiContinue(ctrl: EditorController, blockId: string, offset: number): void {
  start(ctrl, () => {
    ctrl.flush(blockId)
    if (!getBlock(blockId)) return null
    return {
      action: 'continue',
      target: { kind: 'caret', blockId, offset },
      replace: true,
      anchorId: blockId,
      base: { pageId: ctrl.pageId, selectionText: textBefore(ctrl, blockId, offset) || undefined },
      restore: textSel(blockId, offset)
    }
  })
}

/** A page-wide action whose answer goes below a block (the slash menu), or first in the page (the page menu). */
export function aiOnPage(ctrl: EditorController, action: AiAction | null, blockId: string | null, caret = 0): void {
  start(ctrl, () => {
    ctrl.flushAll()
    return {
      action,
      target: { kind: 'after', blockId },
      replace: true,
      anchorId: blockId,
      base: { pageId: ctrl.pageId },
      restore: blockId ? textSel(blockId, caret) : ctrl.currentSel(),
      prompt: 'Ask AI to write…'
    }
  })
}

/** The heading that goes between the written-up notes and what the user typed during the meeting. */
export const MY_NOTES = 'My notes'

/**
 * "Write up notes" on a meeting page: the answer goes first in the page, and the notes the
 * user took stay below it, under a heading of their own. The transcript is read by the main
 * process from the page's "Transcript" sub-page; nothing of it is sent from here.
 */
export function aiConsolidate(ctrl: EditorController): void {
  start(ctrl, () => {
    ctrl.flushAll()
    const own = liveChildren(ctrl.tree, getBlock(ctrl.pageId))
      .map((id) => getBlock(id))
      .filter((block) => block && block.type !== 'page' && block.type !== 'database')
    const hasNotes = own.some((block) => textOf(block?.props.title).trim().length > 0)
    const hasHeading = own.some((block) => block?.type.startsWith('heading') && textOf(block.props.title).trim() === MY_NOTES)
    return {
      action: 'consolidate',
      target: { kind: 'after', blockId: null },
      replace: true,
      anchorId: null,
      base: { pageId: ctrl.pageId },
      restore: ctrl.currentSel(),
      ...(hasNotes && !hasHeading ? { suffix: `\n\n## ${MY_NOTES}` } : {})
    }
  })
}

/** Space on an empty paragraph: the prompt bar, right there. */
export function aiPromptAt(ctrl: EditorController, blockId: string): void {
  aiOnPage(ctrl, null, blockId)
}

/** True when Space in this block should open the prompt bar instead of typing a space. */
export function wantsAiPrompt(blockId: string): boolean {
  if (!aiEnabled()) return false
  const block = getBlock(blockId)
  return !!block && block.type === 'text' && rtLength(block.props.title) === 0 && block.content.length === 0
}

/** Closes the session without touching the page and gives the caret back. */
export function discardAi(ctrl: EditorController): void {
  const session = ctrl.ui.getState().ai
  if (!session) return
  ctrl.ui.setState({ ai: null })
  if (session.restore) ctrl.restoreSel(session.restore)
  else ctrl.root?.focus({ preventScroll: true })
}

/** The user accepted: the answer becomes blocks, in one undoable step, and the session ends. */
export function acceptAi(ctrl: EditorController, markdown: string): boolean {
  const session = ctrl.ui.getState().ai
  if (!session) return false
  ctrl.flushAll()
  const plan = planAccept(ctrl.tree, session.target, `${markdown}${session.suffix ?? ''}`, newId, session.replace)
  ctrl.ui.setState({ ai: null })
  if (!plan) {
    if (session.restore) ctrl.restoreSel(session.restore)
    return false
  }
  ctrl.history.seal()
  ctrl.commit(plan.ops, { before: session.restore, after: plan.after })
  ctrl.history.seal()
  return true
}

/** A suggested title was chosen: the page gets it (and the emoji, when it has no icon yet). One undo step. */
export function applyAiTitle(ctrl: EditorController, title: string, emoji: string): void {
  const page = getBlock(ctrl.pageId)
  const session = ctrl.ui.getState().ai
  ctrl.ui.setState({ ai: null })
  if (!page) return
  ctrl.flushAll()
  ctrl.history.seal()
  ctrl.update(
    ctrl.pageId,
    { title: [[title]], ...(emoji && !page.props.icon ? { icon: emoji } : {}) },
    { before: session?.restore ?? null, silent: true }
  )
  ctrl.history.seal()
  if (session?.restore) ctrl.restoreSel(session.restore)
}

/**
 * For the assistant panel: puts an answer into the page, below the block that last had the
 * caret (at the end of the page without one) or over what is selected.
 */
export function insertFromAssistant(
  ctrl: EditorController,
  markdown: string,
  mode: 'below' | 'replace',
  scope: AiTarget | null,
  lastBlockId: string | null
): boolean {
  ctrl.flushAll()
  let target: AiTarget
  if (mode === 'replace' && scope) target = scope
  else {
    const kids = liveChildren(ctrl.tree, getBlock(ctrl.pageId))
    const anchor = scope?.kind === 'blocks' ? scope.ids[scope.ids.length - 1] : scope && 'blockId' in scope ? scope.blockId : lastBlockId
    target = { kind: 'after', blockId: anchor && getBlock(anchor)?.parentId ? anchor : (kids[kids.length - 1] ?? null) }
  }
  const plan = planAccept(ctrl.tree, target, markdown, newId, mode === 'replace')
  if (!plan) return false
  ctrl.history.seal()
  ctrl.commit(plan.ops, { after: plan.after })
  ctrl.history.seal()
  return true
}

/** The current selection as a target the assistant can act on, with its text. */
export function scopeOf(ctrl: EditorController, sel: Sel): { target: AiTarget; text: string } | null {
  if (!sel) return null
  if (sel.kind === 'blocks') {
    const tops = topLevel(ctrl.tree, sel.ids)
    const text = tops
      .map((id) => textOf(getBlock(id)?.props.title))
      .filter(Boolean)
      .join('\n')
    return tops.length && text ? { target: { kind: 'blocks', ids: tops }, text } : null
  }
  const id = sel.blockId.split(':')[0]
  const block = getBlock(id)
  if (!block || id === ctrl.pageId || sel.blockId !== id || sel.end <= sel.start || !isTextType(block.type)) return null
  const text = textOf(slice(block.props.title, sel.start, sel.end))
  return text.trim() ? { target: { kind: 'range', blockId: id, start: sel.start, end: sel.end }, text } : null
}

/** An item of the slash menu's "AI" group, run on the block the menu was opened in. */
export function aiFromSlash(
  ctrl: EditorController,
  kind: 'continue' | 'summarize' | 'ask' | 'actions' | 'outline',
  blockId: string,
  caret: number
): void {
  if (kind === 'continue') aiContinue(ctrl, blockId, caret)
  else aiOnPage(ctrl, kind === 'ask' ? null : kind, blockId, caret)
}
