// Apply and its Undo against an in-memory store with the real op semantics (`applyOpsToMap`):
// after Undo the workspace is as it was before Apply, and every touched page got a version first.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HermanAction } from '@shared/actions'
import type { Block, BlockProps, BlockType, Op } from '@shared/types'

const store = vi.hoisted(() => ({ blocks: {} as Record<string, unknown>, seq: 0, batches: [] as unknown[][] }))

vi.mock('@/store/blocks', async () => {
  const { applyOpsToMap } = await import('../store/ops')
  type Map = Parameters<typeof applyOpsToMap>[0]
  return {
    newId: () => `new-${++store.seq}`,
    getBlock: (id: string | null | undefined) => (id && Object.hasOwn(store.blocks, id) ? (store.blocks[id] as Block) : undefined),
    applyOps: (ops: Op[]) => {
      store.batches.push(ops)
      store.blocks = applyOpsToMap(store.blocks as Map, ops, 2_000).map
      return Promise.resolve([])
    },
    refreshBlocks: () => Promise.resolve()
  }
})
vi.mock('@/store/tree', () => ({ refreshTree: () => Promise.resolve() }))
vi.mock('@/store/ui', () => ({ setExpanded: () => undefined }))
vi.mock('@/shell/actions', () => ({ logError: () => () => undefined }))

const versions = vi.hoisted(() => [] as { id: string; label: string | null | undefined }[])
vi.stubGlobal('window', {
  api: {
    versions: {
      save: (id: string, label?: string | null) => {
        versions.push({ id, label })
        return Promise.resolve({})
      }
    },
    pages: { restore: () => Promise.resolve() }
  }
})

import { applyActions, BEFORE_HERMAN, undoApplied } from './applyActions'

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

beforeEach(() => {
  store.seq = 0
  store.batches = []
  versions.length = 0
  store.blocks = {
    notes: block('notes', 'page', null, ['t1'], { title: [['Notes']] }),
    t1: block('t1', 'text', 'notes', [], { title: [['First line']] }),
    other: block('other', 'page', null, [], { title: [['Other']], icon: '📁' })
  }
})

describe('Apply and Undo', () => {
  const proposal: HermanAction[] = [
    { do: 'append', page: 'current', markdown: 'A new paragraph\n\n- and a list' },
    { do: 'update-page', page: 'other', title: 'Renamed', icon: '🧭' },
    { do: 'create-page', title: 'Trip', parent: 'other', markdown: '# Plan' }
  ]

  it('undo puts the workspace back as it was before Apply', async () => {
    const before = shape()
    const applied = await applyActions(proposal, 'notes')
    expect(applied.done).toHaveLength(3)
    expect(shape()).not.toEqual(before)
    expect((store.blocks.other as Block).props.title).toEqual([['Renamed']])

    await undoApplied(applied.undo!)
    expect(shape()).toEqual(before)
    // The page it created is in the trash, like a page the editor's undo takes back.
    const trip = Object.values(store.blocks as Record<string, Block>).find((b) => b.type === 'page' && b.parentId === 'other')
    expect(trip?.props.title).toEqual([['Trip']])
    expect(trip?.trashedAt).not.toBeNull()
  })

  it('saves a version of each page it touches before changing anything', async () => {
    await applyActions(proposal, 'notes')
    expect(versions.map((v) => v.id).sort()).toEqual(['notes', 'other'])
    expect(versions.every((v) => v.label === BEFORE_HERMAN)).toBe(true)
  })

  it('a proposal that plans nothing has nothing to undo', async () => {
    const applied = await applyActions([{ do: 'update-page', page: 'missing', title: 'X' }], 'notes')
    expect(applied.undo).toBeNull()
    expect(store.batches).toEqual([])
    expect(versions).toEqual([])
  })
})
