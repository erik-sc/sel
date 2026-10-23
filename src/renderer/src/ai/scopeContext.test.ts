// A project's or database's own context in the window (0.8.0 A4): where it is written (beside the
// project's plan, on the database block), that clearing it removes it, and how the "Sent along"
// line says it went. The block store is stood in for.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import type { Block, Op } from '@shared/types'

const store = vi.hoisted(() => ({ blocks: new Map<string, Block>(), ops: [] as Op[][] }))

vi.mock('@/store/blocks', () => ({
  getBlock: (id: string) => store.blocks.get(id),
  applyOps: async (ops: Op[]) => {
    store.ops.push(ops)
    return []
  }
}))
vi.mock('./privacy', () => ({ aiPrivacyNow: () => null, loadAncestors: async () => undefined }))

const { saveScopeContext, scopeContextOf, scopeName, scopePrivateNow, canPinToScope } = await import('./scopeContext')
const { CONTEXT_COPY, sentLine } = await import('./contextCopy')

function block(id: string, type: Block['type'], props: Block['props']): Block {
  return { id, type, parentId: null, content: [], props, createdAt: 0, updatedAt: 0, trashedAt: null }
}

beforeEach(() => {
  store.ops.length = 0
  store.blocks.clear()
  store.blocks.set(
    TASKS_DATABASE_ID,
    block(TASKS_DATABASE_ID, 'database', {
      title: [['Tasks']],
      schema: {
        [TASK_PROPS.project]: {
          id: TASK_PROPS.project,
          name: 'Project',
          type: 'select',
          options: [
            { id: 'p-x', name: 'Auxiliadora', color: 'blue' },
            { id: 'p-z', name: 'Health', color: 'red' }
          ]
        }
      },
      projects: { 'p-x': { objective: 'Close the deal' } },
      aiPrivateProjects: ['p-z']
    })
  )
  store.blocks.set('notes', block('notes', 'database', { title: [['Reading notes']], aiContext: { text: 'Books.', pages: [] } }))
})

describe('writing a project’s or database’s context', () => {
  it('keeps a project’s beside its plan, and removes it when cleared', async () => {
    await saveScopeContext({ kind: 'project', id: 'p-x' }, { text: 'The bank.', pages: ['brief'] })
    const patch = store.ops[0][0] as Extract<Op, { op: 'update' }>
    expect(patch.id).toBe(TASKS_DATABASE_ID)
    expect(patch.patch.props?.projects).toEqual({
      'p-x': { objective: 'Close the deal', next: null, milestones: [], context: { text: 'The bank.', pages: ['brief'] } }
    })
    store.blocks.set(TASKS_DATABASE_ID, {
      ...(store.blocks.get(TASKS_DATABASE_ID) as Block),
      props: { ...store.blocks.get(TASKS_DATABASE_ID)?.props, projects: patch.patch.props?.projects ?? undefined }
    })
    expect(scopeContextOf({ kind: 'project', id: 'p-x' })).toEqual({ text: 'The bank.', pages: ['brief'] })
    expect(scopeName({ kind: 'project', id: 'p-x' })).toBe('Auxiliadora')
    await saveScopeContext({ kind: 'project', id: 'p-x' }, { text: '  ', pages: [] })
    const cleared = store.ops[1][0] as Extract<Op, { op: 'update' }>
    expect(cleared.patch.props?.projects).toEqual({ 'p-x': { objective: 'Close the deal', next: null, milestones: [] } })
  })

  it('keeps a database’s on its block, capped, and null when cleared', async () => {
    await saveScopeContext({ kind: 'database', id: 'notes' }, { text: 'Novels.', pages: ['a', 'b', 'c', 'd'] })
    expect((store.ops[0][0] as Extract<Op, { op: 'update' }>).patch.props?.aiContext).toEqual({ text: 'Novels.', pages: ['a', 'b', 'c'] })
    await saveScopeContext({ kind: 'database', id: 'notes' }, { text: '', pages: [] })
    expect((store.ops[1][0] as Extract<Op, { op: 'update' }>).patch.props?.aiContext).toBeNull()
    expect(scopeName({ kind: 'database', id: 'notes' })).toBe('Reading notes')
  })

  it('knows a private project, and refuses a fourth page', async () => {
    expect(scopePrivateNow({ kind: 'project', id: 'p-z' })).toBe(true)
    expect(scopePrivateNow({ kind: 'project', id: 'p-x' })).toBe(false)
    expect(await canPinToScope('d', ['a', 'b', 'c'])).toBe('full')
    expect(await canPinToScope('a', ['a', 'b', 'c'])).toBe('ok')
  })
})

describe('the "Sent along" line', () => {
  it('names the project or database whose context went along', () => {
    const sent = {
      context: true,
      pages: [],
      servers: [],
      scopes: [{ kind: 'project' as const, name: 'Auxiliadora', context: true, pages: ['Brief', 'Plan'] }]
    }
    expect(sentLine(sent, CONTEXT_COPY.en)).toBe('Sent along: your context · project “Auxiliadora” (2 pages)')
    expect(sentLine(sent, CONTEXT_COPY['pt-BR'])).toBe('Foi junto: seu contexto · projeto “Auxiliadora” (2 páginas)')
    expect(
      sentLine(
        { context: false, pages: [], servers: [], scopes: [{ kind: 'database', name: 'Notes', context: true, pages: [] }] },
        CONTEXT_COPY.en
      )
    ).toBe('Sent along: database “Notes”')
  })
})
