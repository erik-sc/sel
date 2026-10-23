// The log of what the AI applied, end to end against an in-memory store with the real op
// semantics: Apply, the entry kept as a setting (through main's cleaner, as on disk), the app
// "restarted" (the log read back), then "Undo all of this" — and the pages are exactly as before.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HermanAction } from '@shared/actions'
import { AI_APPLIED_KEY, cleanAppliedLog } from '@shared/aiHistory'
import type { Block, BlockProps, BlockType } from '@shared/types'

const store = vi.hoisted(() => ({ blocks: {} as Record<string, unknown>, seq: 0, clock: 1_000, settings: {} as Record<string, unknown> }))

vi.mock('@/store/blocks', async () => {
  const { applyOpsToMap } = await import('../store/ops')
  type Map = Parameters<typeof applyOpsToMap>[0]
  return {
    newId: () => `new-${++store.seq}`,
    getBlock: (id: string | null | undefined) => (id && Object.hasOwn(store.blocks, id) ? (store.blocks[id] as Block) : undefined),
    applyOps: (ops: Parameters<typeof applyOpsToMap>[1]) => {
      store.blocks = applyOpsToMap(store.blocks as Map, ops, store.clock).map
      return Promise.resolve([])
    },
    refreshBlocks: () => Promise.resolve()
  }
})
vi.mock('@/store/tree', () => ({ refreshTree: () => Promise.resolve() }))
vi.mock('@/store/ui', () => ({ setExpanded: () => undefined }))
vi.mock('@/shell/actions', () => ({ logError: () => () => undefined }))

vi.stubGlobal('window', {
  api: {
    versions: { save: () => Promise.resolve({}) },
    pages: {
      // Back from the trash, as the backend does it.
      restore: (id: string) => {
        const block = store.blocks[id] as Block | undefined
        if (block) store.blocks[id] = { ...block, trashedAt: null }
        return Promise.resolve()
      }
    },
    app: {
      getSetting: (key: string) => Promise.resolve(store.settings[key] ?? null),
      setSetting: (key: string, value: unknown) => {
        // Through main's cleaner and JSON, as it would be stored.
        store.settings[key] = value === null ? null : JSON.parse(JSON.stringify(cleanAppliedLog(value)))
        return Promise.resolve()
      }
    }
  }
})

const { applyActions } = await import('./applyActions')
const log = await import('./appliedStore')

function block(id: string, type: BlockType, parentId: string | null, content: string[] = [], props: BlockProps = {}): Block {
  return { id, type, parentId, content, props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

/** What the user sees of the workspace: every block outside the trash, its place, kind and props. */
function shape(): unknown {
  const blocks = store.blocks as Record<string, Block>
  const shown = (id: string): boolean => !!blocks[id] && !blocks[id].trashedAt
  return Object.fromEntries(
    Object.entries(blocks)
      .filter(([id]) => shown(id))
      .map(([id, b]) => [id, { type: b.type, parentId: b.parentId, content: b.content.filter(shown), props: b.props }] as const)
      .sort(([a], [b]) => a.localeCompare(b))
  )
}

/** Waits for the log's writes, which run after the Apply resolves. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const proposal: HermanAction[] = [
  { do: 'append', page: 'current', markdown: 'A new paragraph\n\n- and a list' },
  { do: 'update-page', page: 'other', title: 'Renamed', icon: '🧭' },
  { do: 'create-page', title: 'Trip', parent: 'other', markdown: '# Plan' },
  { do: 'trash', page: 'old' }
]

beforeEach(() => {
  store.seq = 0
  store.clock = 1_000
  store.settings = {}
  store.blocks = {
    notes: block('notes', 'page', null, ['t1'], { title: [['Notes']] }),
    t1: block('t1', 'text', 'notes', [], { title: [['First line']] }),
    other: block('other', 'page', null, [], { title: [['Other']], icon: '📁' }),
    old: block('old', 'page', null, ['o1'], { title: [['Old']] }),
    o1: block('o1', 'text', 'old', [], { title: [['kept inside']] })
  }
  log.useAppliedLog.setState({ entries: [], loaded: false })
})

describe('the log of what the AI applied', () => {
  it('records an Apply and undoes it after a restart, leaving the pages exactly as before', async () => {
    const before = shape()
    const applied = await applyActions(proposal, 'notes')
    const id = log.recordApplied(applied, { request: 'Tidy my notes', conversationId: 'c1' })
    expect(id).toBeTruthy()
    await flush()
    expect(shape()).not.toEqual(before)

    // Kept as a setting: when, the question, what was done, which pages.
    const stored = store.settings[AI_APPLIED_KEY] as ReturnType<typeof cleanAppliedLog>
    expect(stored).toHaveLength(1)
    const [entry] = stored ?? []
    expect(entry).toMatchObject({ id, request: 'Tidy my notes', conversationId: 'c1' })
    expect(entry.done).toHaveLength(4)
    expect(entry.pages.map((page) => page.title).sort()).toEqual(['Notes', 'Old', 'Renamed', 'Trip'])
    expect(entry.undo?.restore).toEqual(['old'])

    // The app starts again: the log is read back from the setting, and undone from there.
    log.useAppliedLog.setState({ entries: [], loaded: false })
    vi.resetModules()
    const fresh = await import('./appliedStore')
    fresh.useAppliedLog.setState({ entries: [], loaded: false })
    await fresh.loadAppliedLog()
    expect(fresh.findApplied(id ?? '')).toBeDefined()
    await fresh.undoAppliedEntry(id ?? '')
    expect(shape()).toEqual(before)
    expect((store.settings[AI_APPLIED_KEY] as { undoneAt?: number }[])[0].undoneAt).toBeTypeOf('number')

    // Undone once: a second undo does nothing.
    await fresh.undoAppliedEntry(id ?? '')
    expect(shape()).toEqual(before)
  })

  it('says which blocks were changed after the Apply', async () => {
    store.clock = 5_000
    const applied = await applyActions([{ do: 'update-page', page: 'other', title: 'Renamed' }], 'notes')
    log.recordApplied(applied, { request: 'rename' })
    await flush()
    const [entry] = log.useAppliedLog.getState().entries
    const get = (id: string): Block | undefined => store.blocks[id] as Block | undefined
    expect(log.changedSince({ ...entry, at: 5_000 }, get)).toEqual([])
    store.blocks.other = { ...(store.blocks.other as Block), updatedAt: 60_000 }
    expect(log.changedSince({ ...entry, at: 5_000 }, get)).toEqual(['other'])
  })

  it('names the pages a batch touched, a block standing for the page it is in', () => {
    const get = (id: string): Block | undefined => store.blocks[id] as Block | undefined
    expect(
      log.pagesTouched(
        [
          { op: 'update', id: 't1', patch: { props: { title: [['x']] } } },
          { op: 'create', input: { id: 'n1', type: 'text', parentId: 'notes' } },
          { op: 'move', id: 'other', parentId: 'notes' }
        ],
        get
      )
    ).toEqual([
      { id: 'notes', title: 'Notes' },
      { id: 'other', title: 'Other' }
    ])
  })

  it('logs nothing for a proposal that changed nothing', async () => {
    const applied = await applyActions([{ do: 'update-page', page: 'missing', title: 'X' }], 'notes')
    expect(log.recordApplied(applied, { request: 'x' })).toBeNull()
  })
})
