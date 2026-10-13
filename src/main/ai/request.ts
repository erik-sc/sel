import { AI_LIMITS, isAiAction, isAiLanguage, isAiTone, type AiAction, type AiRequest, type AiTurn } from '../../shared/ai'
import type { Block } from '../../shared/types'
import * as arg from '../validate'
import type { PromptContext } from './prompts'

/**
 * Checking an AI request that arrived from a renderer, and loading what it points at.
 * Free of Electron imports (unit-tested); the repository is passed in.
 */

const KEYS: ReadonlySet<string> = new Set([
  'action',
  'pageId',
  'blockIds',
  'selectionText',
  'instruction',
  'language',
  'tone',
  'history',
  'transcript',
  'notes'
])

/** Actions that are about existing content: they need a page, blocks or a selection. */
const NEEDS_CONTENT: ReadonlySet<AiAction> = new Set([
  'summarize',
  'continue',
  'expand',
  'improve',
  'fix',
  'shorten',
  'lengthen',
  'simplify',
  'tone',
  'translate',
  'outline',
  'actions',
  'title',
  'explain'
])

function optionalText(value: unknown, what: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined
  return arg.text(value, what, max)
}

/** Exactly an `AiRequest`: known keys only, every field typed and bounded, and what the action needs present. */
export function aiRequest(value: unknown): AiRequest {
  const raw = arg.plainObject(value, 'AI request')
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) throw new Error('Invalid AI request')
  if (!isAiAction(raw['action'])) throw new Error('Unknown AI action')
  const request: AiRequest = { action: raw['action'] }

  const pageId = arg.optionalId(raw['pageId'], 'pageId')
  if (pageId) request.pageId = pageId
  if (raw['blockIds'] !== undefined && raw['blockIds'] !== null) {
    const ids = arg.list(raw['blockIds'], 'blockIds', AI_LIMITS.blockIds).map((id) => arg.id(id, 'blockIds'))
    if (ids.length) {
      if (!pageId) throw new Error('Invalid AI request')
      request.blockIds = ids
    }
  }
  const selection = optionalText(raw['selectionText'], 'selection', AI_LIMITS.selection)
  if (selection) request.selectionText = selection
  const instruction = optionalText(raw['instruction'], 'instruction', AI_LIMITS.instruction)
  if (instruction?.trim()) request.instruction = instruction
  if (raw['language'] !== undefined && raw['language'] !== null) {
    if (!isAiLanguage(raw['language'])) throw new Error('Unknown language')
    request.language = raw['language']
  }
  if (raw['tone'] !== undefined && raw['tone'] !== null) {
    if (!isAiTone(raw['tone'])) throw new Error('Unknown tone')
    request.tone = raw['tone']
  }
  if (raw['history'] !== undefined && raw['history'] !== null) {
    const turns: AiTurn[] = arg.list(raw['history'], 'history', AI_LIMITS.historyTurns).map((item) => {
      const turn = arg.plainObject(item, 'history')
      if (turn['role'] !== 'user' && turn['role'] !== 'assistant') throw new Error('Invalid history')
      return { role: turn['role'], text: arg.text(turn['text'], 'history', AI_LIMITS.historyTurnChars) }
    })
    if (turns.length) request.history = turns
  }
  const transcript = optionalText(raw['transcript'], 'transcript', AI_LIMITS.transcript)
  if (transcript) request.transcript = transcript
  const notes = optionalText(raw['notes'], 'notes', AI_LIMITS.notes)
  if (notes) request.notes = notes

  const { action } = request
  if ((action === 'custom' || action === 'ask') && !request.instruction) throw new Error('The request is empty')
  if (action === 'tone' && !request.tone) throw new Error('Unknown tone')
  if (action === 'translate' && !request.language) throw new Error('Unknown language')
  if (action === 'consolidate' && !request.transcript?.trim()) throw new Error('There is no transcript')
  if (action === 'title' && !request.pageId) throw new Error('Invalid AI request')
  if (NEEDS_CONTENT.has(action) && !request.pageId && !request.selectionText?.trim()) throw new Error('There is nothing to work on')
  return request
}

// ---- content ----------------------------------------------------------------

/** What the loader needs of the repository and the Markdown exporter. */
export interface ContentSource {
  get(id: string): Block | null
  pageToMarkdown(id: string): { title: string; markdown: string }
  blocksToMarkdown(blocks: Block[]): string
}

const MAX_DEPTH = 64

/** The page (or database) a block is in: its nearest ancestor of that kind. */
function pageOf(source: ContentSource, block: Block): string | null {
  let current: Block | null = block
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    const parentId: string | null = current.parentId
    if (!parentId) return null
    const parent = source.get(parentId)
    if (!parent) return null
    if (parent.type === 'page' || parent.type === 'database') return parent.id
    current = parent
  }
  return null
}

/**
 * Reads the content a request names. The renderer only sends ids: what the model sees of the
 * page is what is stored, read here. Blocks must belong to the page the request names.
 */
export function loadContext(source: ContentSource, request: AiRequest): PromptContext {
  const context: PromptContext = {}
  if (!request.pageId) return context
  const page = source.get(request.pageId)
  if (!page || (page.type !== 'page' && page.type !== 'database')) throw new Error('The page no longer exists')
  // A transcript brings its own content; the page it will be written to is not part of the prompt.
  if (request.action !== 'consolidate') {
    const { title, markdown } = source.pageToMarkdown(page.id)
    context.pageTitle = title
    context.pageMarkdown = markdown
  }
  if (request.blockIds?.length) {
    const wanted = new Set(request.blockIds)
    const blocks: Block[] = []
    for (const id of request.blockIds) {
      const block = source.get(id)
      if (!block || block.trashedAt !== null || block.type === 'page' || block.type === 'database') continue
      if (pageOf(source, block) !== page.id) throw new Error('Invalid AI request')
      // A block whose parent is selected too comes with its parent.
      if (block.parentId && wanted.has(block.parentId)) continue
      blocks.push(block)
    }
    if (blocks.length) context.blocksMarkdown = source.blocksToMarkdown(blocks)
  }
  return context
}
