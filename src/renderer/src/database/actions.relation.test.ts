// Relation and rollup actions against an in-memory store with the real op semantics:
// what reaches the store when links are edited, and how the two halves of a two-way
// relation are kept in step.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, Op, PropertySchema, PropertyValue } from '../../../shared/types'

const store = vi.hoisted(() => ({
  blocks: {} as Record<string, unknown>,
  batches: [] as unknown[][],
  seq: 0,
  /** Blocks that only exist "on disk" until loadChildren is called. */
  unloaded: [] as unknown[]
}))

vi.mock('../store/blocks', async () => {
  const { applyOpsToMap } = await import('../store/ops')
  type Map = Parameters<typeof applyOpsToMap>[0]
  return {
    newId: () => `new-${++store.seq}`,
    getBlock: (id: string | null | undefined) => (id && Object.hasOwn(store.blocks, id) ? (store.blocks[id] as Block) : undefined),
    useBlockStore: { getState: () => ({ missing: {} }) },
    applyOps: (ops: Op[]) => {
      store.batches.push(ops)
      store.blocks = applyOpsToMap(store.blocks as Map, ops, 2_000).map
      return Promise.resolve([])
    },
    loadChildren: () => {
      for (const block of store.unloaded as Block[]) store.blocks[block.id] = block
      store.unloaded = []
      return Promise.resolve()
    },
    loadTree: () => Promise.resolve()
  }
})

import * as actions from './actions'
import * as L from './logic'

const TITLE: PropertySchema = { id: 'title', name: 'Name', type: 'title' }

function database(id: string, title: string, schema: L.Schema, content: string[]): Block {
  return {
    id,
    type: 'database',
    parentId: null,
    content,
    props: {
      title: [[title]],
      schema,
      views: [{ id: `${id}-table`, name: 'Table', type: 'table', visibleProperties: Object.keys(schema), filters: [], sorts: [] }]
    },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null
  }
}

function row(id: string, parentId: string, title: string, values: Record<string, PropertyValue> = {}): Block {
  return { id, type: 'page', parentId, content: [], props: { title: [[title]], values }, createdAt: 1, updatedAt: 1, trashedAt: null }
}

const get = (id: string): Block => store.blocks[id] as Block
const valuesOf = (id: string): Record<string, PropertyValue> => get(id).props.values ?? {}
const schemaOf = (id: string): L.Schema => L.normalizeDatabase(get(id)).schema
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Tasks (one-way "Project" relation to Projects) and Projects. */
function seed(projectRelation: PropertySchema['relation'] = { databaseId: 'projects' }): void {
  const tasks = database(
    'tasks',
    'Tasks',
    { title: TITLE, project: { id: 'project', name: 'Project', type: 'relation', relation: projectRelation } },
    ['t1', 't2']
  )
  const projects = database('projects', 'Projects', { title: TITLE }, ['p1', 'p2'])
  const blocks = [
    tasks,
    projects,
    row('t1', 'tasks', 'Write', { project: ['p1'] }),
    row('t2', 'tasks', 'Test'),
    row('p1', 'projects', 'Alpha'),
    row('p2', 'projects', 'Beta')
  ]
  store.blocks = Object.fromEntries(blocks.map((b) => [b.id, b]))
}

beforeEach(() => {
  store.blocks = {}
  store.batches = []
  store.unloaded = []
  store.seq = 0
})

describe('relation properties', () => {
  it('a new relation points at the chosen database and is named after it', () => {
    seed()
    const id = actions.addRelation('tasks', 'projects', 'tasks-table')
    expect(id).toBeDefined()
    expect(schemaOf('tasks')[id as string]).toMatchObject({ name: 'Projects', type: 'relation', relation: { databaseId: 'projects' } })
    expect(L.normalizeDatabase(get('tasks')).views[0].visibleProperties).toContain(id)
    expect(actions.addRelation('tasks', 'p1')).toBeUndefined()
  })

  it('a two-way relation gets a partner in the other database, filled in with the existing links', () => {
    seed()
    actions.setRelationTwoWay('tasks', 'project', true)
    const project = schemaOf('tasks').project
    const partnerId = project.relation?.syncedPropertyId as string
    expect(partnerId).toBeDefined()
    expect(schemaOf('projects')[partnerId]).toMatchObject({
      name: 'Tasks',
      type: 'relation',
      relation: { databaseId: 'tasks', syncedPropertyId: 'project' }
    })
    expect(valuesOf('p1')[partnerId]).toEqual(['t1'])
    expect(L.normalizeDatabase(get('projects')).views[0].visibleProperties).toContain(partnerId)
    // One batch: both schemas and the backfilled cells land together.
    expect(store.batches).toHaveLength(1)
  })

  it('edits of a two-way relation show on both sides', () => {
    seed()
    actions.setRelationTwoWay('tasks', 'project', true)
    const partnerId = schemaOf('tasks').project.relation?.syncedPropertyId as string
    const project = schemaOf('tasks').project
    actions.updateRelation('t2', project, (ids) => L.toggleLink(ids, 'p1'))
    expect(valuesOf('t2').project).toEqual(['p1'])
    expect(valuesOf('p1')[partnerId]).toEqual(['t1', 't2'])
    // And from the other side.
    actions.updateRelation('p1', schemaOf('projects')[partnerId], (ids) => ids.filter((id) => id !== 't1'))
    expect(valuesOf('t1').project).toBeUndefined()
    expect(valuesOf('p1')[partnerId]).toEqual(['t2'])
  })

  it('clearing a cell (Delete in the table) unlinks the other side too', () => {
    seed()
    actions.setRelationTwoWay('tasks', 'project', true)
    const partnerId = schemaOf('tasks').project.relation?.syncedPropertyId as string
    actions.setCell('t1', schemaOf('tasks').project, null)
    expect(valuesOf('t1').project).toBeUndefined()
    expect(Object.hasOwn(valuesOf('p1'), partnerId)).toBe(false)
  })

  it('loads the rows of both databases before editing a two-way relation', async () => {
    seed({ databaseId: 'projects', syncedPropertyId: 'tasks' })
    store.blocks.projects = database(
      'projects',
      'Projects',
      {
        title: TITLE,
        tasks: { id: 'tasks', name: 'Tasks', type: 'relation', relation: { databaseId: 'tasks', syncedPropertyId: 'project' } }
      },
      ['p1', 'p2']
    )
    store.unloaded = [store.blocks.p2]
    delete store.blocks.p2
    actions.updateRelation('t2', schemaOf('tasks').project, (ids) => [...ids, 'p2'])
    expect(store.batches).toHaveLength(0)
    await flush()
    expect(valuesOf('t2').project).toEqual(['p2'])
    expect(valuesOf('p2').tasks).toEqual(['t2'])
  })

  it('turning two-way off deletes the partner with its cells', () => {
    seed()
    actions.setRelationTwoWay('tasks', 'project', true)
    const partnerId = schemaOf('tasks').project.relation?.syncedPropertyId as string
    actions.setRelationTwoWay('tasks', 'project', false)
    expect(schemaOf('tasks').project.relation).toEqual({ databaseId: 'projects' })
    expect(Object.hasOwn(schemaOf('projects'), partnerId)).toBe(false)
    expect(Object.hasOwn(valuesOf('p1'), partnerId)).toBe(false)
    expect(valuesOf('t1').project).toEqual(['p1'])
  })

  it('a two-way relation to its own database keeps both properties in one schema', () => {
    seed({ databaseId: 'tasks' })
    store.blocks.t1 = row('t1', 'tasks', 'Write', { project: ['t2'] })
    actions.setRelationTwoWay('tasks', 'project', true)
    const schema = schemaOf('tasks')
    const partnerId = schema.project.relation?.syncedPropertyId as string
    expect(schema[partnerId]).toMatchObject({ type: 'relation', relation: { databaseId: 'tasks', syncedPropertyId: 'project' } })
    expect(valuesOf('t2')[partnerId]).toEqual(['t1'])
    actions.setRelationTwoWay('tasks', 'project', false)
    expect(Object.hasOwn(schemaOf('tasks'), partnerId)).toBe(false)
  })

  it('deleting one half of a two-way relation leaves the other half as a one-way relation with its links', () => {
    seed()
    actions.setRelationTwoWay('tasks', 'project', true)
    const partnerId = schemaOf('tasks').project.relation?.syncedPropertyId as string
    actions.deleteProperty('tasks', 'project')
    expect(Object.hasOwn(schemaOf('tasks'), 'project')).toBe(false)
    expect(schemaOf('projects')[partnerId].relation).toEqual({ databaseId: 'tasks' })
    expect(valuesOf('p1')[partnerId]).toEqual(['t1'])
  })

  it('pointing a relation elsewhere drops its links and its filter rules', () => {
    seed()
    actions.patchView('tasks', 'tasks-table', (v) => ({ ...v, filters: [{ propertyId: 'project', operator: 'contains', value: ['p1'] }] }))
    actions.setRelationTarget('tasks', 'project', 'tasks')
    expect(schemaOf('tasks').project.relation).toEqual({ databaseId: 'tasks' })
    expect(valuesOf('t1').project).toBeUndefined()
    expect(L.normalizeDatabase(get('tasks')).views[0].filters).toEqual([])
  })

  it('a limit of one keeps the first link of every row, on both sides', () => {
    seed()
    store.blocks.t1 = row('t1', 'tasks', 'Write', { project: ['p1', 'p2'] })
    actions.setRelationTwoWay('tasks', 'project', true)
    const partnerId = schemaOf('tasks').project.relation?.syncedPropertyId as string
    expect(valuesOf('p2')[partnerId]).toEqual(['t1'])
    actions.setRelationLimit('tasks', 'project', 'one')
    expect(schemaOf('tasks').project.relation?.limit).toBe('one')
    expect(valuesOf('t1').project).toEqual(['p1'])
    expect(Object.hasOwn(valuesOf('p2'), partnerId)).toBe(false)
  })

  it('a row created under a "contains" rule links to the page, on both sides', () => {
    seed()
    actions.setRelationTwoWay('tasks', 'project', true)
    const partnerId = schemaOf('tasks').project.relation?.syncedPropertyId as string
    const view = {
      ...L.normalizeDatabase(get('tasks')).views[0],
      filters: [{ propertyId: 'project', operator: 'contains' as const, value: ['p2'] }]
    }
    const id = actions.createRow('tasks', { view })
    expect(valuesOf(id).project).toEqual(['p2'])
    expect(valuesOf('p2')[partnerId]).toEqual([id])
  })

  it('a property that becomes a relation is pointed at its database at once', () => {
    seed()
    actions.changePropertyType('tasks', 'project', 'text')
    actions.changePropertyType('tasks', 'project', 'relation', 'projects')
    expect(schemaOf('tasks').project).toEqual({ id: 'project', name: 'Project', type: 'relation', relation: { databaseId: 'projects' } })
  })
})

describe('rollup properties', () => {
  it('changing the kind of value drops the filter rules on it', () => {
    seed()
    const id = actions.addProperty('tasks', 'rollup', 'tasks-table')
    expect(schemaOf('tasks')[id].rollup).toEqual({ function: 'count', relationId: 'project' })
    actions.patchView('tasks', 'tasks-table', (v) => ({ ...v, filters: [{ propertyId: id, operator: 'gt', value: 1 }] }))
    actions.updateRollup('tasks', id, { function: 'max' })
    expect(L.normalizeDatabase(get('tasks')).views[0].filters).toHaveLength(1)
    actions.updateRollup('tasks', id, { function: 'latest', propertyId: 'due' })
    expect(L.normalizeDatabase(get('tasks')).views[0].filters).toEqual([])
  })

  it('reads the related rows as the store has them', () => {
    seed()
    const id = actions.addProperty('tasks', 'rollup', 'tasks-table')
    const ctx = actions.storeCellContext()
    expect(L.readCell(get('t1'), schemaOf('tasks')[id], ctx)).toBe(1)
    expect(L.readCell(get('t2'), schemaOf('tasks')[id], ctx)).toBe(0)
  })
})
