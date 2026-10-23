// The log of what the AI applied (`ai.applied`, src/shared/aiHistory.ts): one entry per Apply,
// with when, the question behind it, what was done, the pages it changed, and what it takes to
// put it all back. "Undo all of this" runs that through the ordinary write path (undoApplied).
// Shown in the balloon and in Settings → AI.
import { create } from 'zustand'
import { AI_APPLIED_KEY, cleanAppliedLog, fitAppliedLog, type AppliedEntry, type AppliedPage } from '@shared/aiHistory'
import { plainText } from '@shared/richtext'
import type { Block, Op } from '@shared/types'
import { getBlock, refreshBlocks } from '@/store/blocks'
import { undoApplied, type Applied } from './applyActions'

interface LogState {
  entries: AppliedEntry[]
  loaded: boolean
}

export const useAppliedLog = create<LogState>(() => ({ entries: [], loaded: false }))

let loading: Promise<void> | null = null
let reading = false
let saving: Promise<void> = Promise.resolve()

/** Reads the log once; later calls wait for the same read. */
export function loadAppliedLog(): Promise<void> {
  // Read once; a store that was reset (by a test) reads again.
  if (loading && (reading || useAppliedLog.getState().loaded)) return loading
  reading = true
  loading = window.api.app
    .getSetting<unknown>(AI_APPLIED_KEY)
    .then((value) => {
      // An entry recorded before the read finished stays.
      const stored = cleanAppliedLog(value) ?? []
      const known = new Set(useAppliedLog.getState().entries.map((entry) => entry.id))
      useAppliedLog.setState((state) => ({
        entries: fitAppliedLog([...state.entries, ...stored.filter((entry) => !known.has(entry.id))]),
        loaded: true
      }))
    })
    .catch((error: unknown) => {
      console.error('the log of what the AI applied could not be read', error)
      useAppliedLog.setState({ loaded: true })
    })
    .finally(() => {
      reading = false
    })
  return loading
}

function persist(): Promise<void> {
  const entries = useAppliedLog.getState().entries
  // In order: a later write never lands before an earlier one.
  saving = saving.catch(() => undefined).then(() => window.api.app.setSetting(AI_APPLIED_KEY, entries.length ? entries : null))
  return saving
}

function setEntries(update: (entries: AppliedEntry[]) => AppliedEntry[]): Promise<void> {
  useAppliedLog.setState((state) => ({ entries: fitAppliedLog(update(state.entries)) }))
  return persist()
}

const isPage = (block: Block | undefined): boolean => block?.type === 'page' || block?.type === 'database'
const titleOf = (block: Block | undefined): string => plainText(block?.props.title).trim() || 'Untitled'

/**
 * The pages and databases a batch changed or created, each once, in the order first touched:
 * a block counts for the page it sits in. `get` reads blocks as they are after the batch.
 */
export function pagesTouched(ops: readonly Op[], get: (id: string) => Block | undefined): AppliedPage[] {
  const pages = new Map<string, string>()
  const pageOf = (id: string | null | undefined): void => {
    let current = id ? get(id) : undefined
    for (let depth = 0; current && depth < 64; depth++) {
      if (isPage(current)) {
        if (!pages.has(current.id)) pages.set(current.id, titleOf(current))
        return
      }
      current = current.parentId ? get(current.parentId) : undefined
    }
  }
  for (const op of ops) {
    if (op.op === 'create') {
      if (op.input.id && (op.input.type === 'page' || op.input.type === 'database')) pageOf(op.input.id)
      else pageOf(op.input.parentId)
    } else {
      pageOf(op.id)
      if (op.op === 'move') pageOf(op.parentId)
    }
  }
  return [...pages].map(([id, title]) => ({ id, title }))
}

/** The blocks an entry's undo would write: changed after `at`, they were edited since. */
export function blocksOf(entry: AppliedEntry): string[] {
  if (!entry.undo) return []
  const ids = new Set<string>(entry.undo.restore)
  for (const op of entry.undo.inverse) ids.add(op.op === 'create' ? (op.input.id ?? '') : op.id)
  ids.delete('')
  return [...ids]
}

/** Margin for the clocks of the write and of the entry. */
const SINCE_MARGIN_MS = 2000

/** Of the blocks an undo would write, those changed after the batch was applied (by the user, or by sync). */
export function changedSince(entry: AppliedEntry, get: (id: string) => Block | undefined): string[] {
  return blocksOf(entry).filter((id) => {
    const block = get(id)
    return !!block && block.updatedAt > entry.at + SINCE_MARGIN_MS
  })
}

let nextId = 0
const newEntryId = (): string => `a${Date.now().toString(36)}${(++nextId).toString(36)}`

/** Records an Apply that changed something. Returns the entry's id. */
export function recordApplied(applied: Applied, context: { request: string; conversationId?: string }): string | null {
  if (!applied.undo) return null
  const entry: AppliedEntry = {
    id: newEntryId(),
    at: Date.now(),
    request: context.request.slice(0, 300),
    done: applied.done,
    skipped: applied.skipped,
    pages: pagesTouched(applied.ops, getBlock),
    blocks: new Set(applied.ops.map((op) => (op.op === 'create' ? op.input.id : op.id))).size,
    undo: applied.undo,
    ...(context.conversationId ? { conversationId: context.conversationId } : {})
  }
  void loadAppliedLog().then(() =>
    setEntries((entries) => [entry, ...entries]).catch((error: unknown) => console.error('the Apply could not be logged', error))
  )
  return entry.id
}

export function findApplied(id: string): AppliedEntry | undefined {
  return useAppliedLog.getState().entries.find((entry) => entry.id === id)
}

/** Reads the blocks an entry's undo would write, and says which were changed since. */
export async function checkUndo(id: string): Promise<string[]> {
  const entry = findApplied(id)
  if (!entry?.undo) return []
  await refreshBlocks(blocksOf(entry)).catch(() => undefined)
  return changedSince(entry, getBlock)
}

/** "Undo all of this": the batch is reversed and the entry marked undone. */
export async function undoAppliedEntry(id: string): Promise<void> {
  await loadAppliedLog()
  const entry = findApplied(id)
  if (!entry?.undo || entry.undoneAt) return
  await undoApplied(entry.undo)
  await setEntries((entries) => entries.map((item) => (item.id === id ? { ...item, undoneAt: Date.now() } : item)))
}

/** Forgets the log (nothing in the workspace changes). */
export function clearAppliedLog(): Promise<void> {
  return setEntries(() => [])
}
