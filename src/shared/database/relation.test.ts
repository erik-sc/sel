import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema, PropertyValue } from '../types'
import { readCell, cellText, filterTypeOf } from './cell'
import { addProperty, changePropertyType, setRelationLimit, setRelationTarget } from './mutations'
import { normalizeDatabase } from './normalize'
import { defaultsFromFilters, filterValueFor, matchesFilter, operatorsOf, queryRows } from './query'
import {
  addPartnerProperty,
  dropPartnerLink,
  linkableRows,
  linkedIds,
  linkedRows,
  partnerBackfill,
  relatedDatabaseState,
  relationTargets,
  relationWrites,
  toggleLink,
  type CellContext
} from './relation'
import { cellContext } from './resolve'
import { getCellValue, sanitizeValue, formatValue, type Schema, type Values } from './values'

// Tasks.project -> Projects, two-way with Projects.tasks. Projects.lead -> People, one-way.
const TITLE: PropertySchema = { id: 'title', name: 'Name', type: 'title' }

function tasksSchema(projectLimit?: 'one'): Schema {
  return {
    title: TITLE,
    project: {
      id: 'project',
      name: 'Project',
      type: 'relation',
      relation: projectLimit
        ? { databaseId: 'projects', syncedPropertyId: 'tasks', limit: projectLimit }
        : { databaseId: 'projects', syncedPropertyId: 'tasks' }
    },
    hours: { id: 'hours', name: 'Hours', type: 'number' }
  }
}

function projectsSchema(tasksLimit?: 'one'): Schema {
  return {
    title: TITLE,
    tasks: {
      id: 'tasks',
      name: 'Tasks',
      type: 'relation',
      relation: tasksLimit
        ? { databaseId: 'tasks', syncedPropertyId: 'project', limit: tasksLimit }
        : { databaseId: 'tasks', syncedPropertyId: 'project' }
    }
  }
}

function db(id: string, schema: Schema, content: string[], extra: Partial<Block> = {}): Block {
  return {
    id,
    type: 'database',
    parentId: 'home',
    content,
    props: { schema, views: [] },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    ...extra
  }
}

function row(id: string, parentId: string, title: string, values: Values = {}, extra: Partial<Block> = {}): Block {
  return {
    id,
    type: 'page',
    parentId,
    content: [],
    props: { title: [[title]], values },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    ...extra
  }
}

function contextOf(blocks: Block[], missing: string[] = []): CellContext {
  const byId = new Map(blocks.map((b) => [b.id, b]))
  return cellContext({ get: (id) => byId.get(id), isMissing: (id) => missing.includes(id) })
}

function world(overrides: Block[] = []): { blocks: Block[]; ctx: CellContext; get: (id: string) => Block } {
  const base: Block[] = [
    { id: 'home', type: 'page', parentId: null, content: ['tasks', 'projects'], props: {}, createdAt: 1, updatedAt: 1, trashedAt: null },
    db('tasks', tasksSchema(), ['t1', 't2', 't3']),
    db('projects', projectsSchema(), ['p1', 'p2']),
    row('t1', 'tasks', 'Write', { project: ['p1'], hours: 2 }),
    row('t2', 'tasks', 'Test', { project: ['p1'], hours: 3 }),
    row('t3', 'tasks', 'Ship', {}),
    row('p1', 'projects', 'Alpha', { tasks: ['t1', 't2'] }),
    row('p2', 'projects', 'Beta', {})
  ]
  const byId = new Map(base.map((b) => [b.id, b]))
  for (const b of overrides) byId.set(b.id, b)
  const blocks = [...byId.values()]
  return { blocks, ctx: contextOf(blocks), get: (id) => byId.get(id) as Block }
}

const prop = (schema: Schema, id: string): PropertySchema => normalizeDatabase(db('x', schema, [])).schema[id]

describe('relation values', () => {
  it('stores ids, sanitised on read and on write', () => {
    const p = prop(tasksSchema(), 'project')
    expect(getCellValue(row('r', 'tasks', 'R', { project: ['a', 'a', 7, '__proto__'] as unknown as PropertyValue }), p)).toEqual(['a'])
    expect(getCellValue(row('r', 'tasks', 'R', { project: 'a' }), p)).toEqual(['a'])
    expect(getCellValue(row('r', 'tasks', 'R'), p)).toBeNull()
    expect(sanitizeValue(p, ['a', 'b', 'a'])).toEqual(['a', 'b'])
    expect(sanitizeValue(p, [])).toBeNull()
    expect(sanitizeValue(p, 'not an id!')).toBeNull()
    const one = prop(tasksSchema('one'), 'project')
    expect(sanitizeValue(one, ['a', 'b'])).toEqual(['a'])
    expect(getCellValue(row('r', 'tasks', 'R', { project: ['a', 'b'] }), one)).toEqual(['a'])
  })

  it('formats as a count without the related rows, as titles with them', () => {
    const { ctx, get } = world()
    const p = prop(tasksSchema(), 'project')
    expect(formatValue(['a', 'b'], p)).toBe('2 pages')
    expect(formatValue(['a'], p)).toBe('1 page')
    expect(cellText(get('p1'), prop(projectsSchema(), 'tasks'), ctx)).toBe('Write, Test')
    expect(cellText(get('t3'), p, ctx)).toBe('')
  })

  it('normalises the configuration and keeps a clean property by reference', () => {
    const schema = tasksSchema()
    expect(normalizeDatabase(db('tasks', schema, [])).schema.project).toBe(schema.project)
    const broken = normalizeDatabase(
      db(
        't',
        {
          title: TITLE,
          r: { id: 'r', name: 'R', type: 'relation', relation: { databaseId: 'bad id', limit: 'many' } } as unknown as PropertySchema
        },
        []
      )
    ).schema.r
    expect(broken.relation).toBeUndefined()
    const fixed = normalizeDatabase(
      db(
        't',
        {
          title: TITLE,
          r: { id: 'r', name: 'R', type: 'relation', relation: { databaseId: 'ok', limit: 'many' } } as unknown as PropertySchema
        },
        []
      )
    ).schema.r
    expect(fixed.relation).toEqual({ databaseId: 'ok' })
    const leftover = normalizeDatabase(
      db('t', { title: TITLE, r: { id: 'r', name: 'R', type: 'text', relation: { databaseId: 'ok' } } as unknown as PropertySchema }, [])
    ).schema.r
    expect(leftover).toEqual({ id: 'r', name: 'R', type: 'text' })
  })

  it('lists the databases a schema relates to once each', () => {
    expect(
      relationTargets({ ...tasksSchema(), again: { id: 'again', name: 'Again', type: 'relation', relation: { databaseId: 'projects' } } })
    ).toEqual(['projects'])
    expect(relationTargets({ title: TITLE, none: { id: 'none', name: 'None', type: 'relation' } })).toEqual([])
  })
})

describe('what a relation cell shows', () => {
  const p = prop(projectsSchema(), 'tasks')

  it('the linked rows that exist, in the order they were linked', () => {
    const { ctx, get } = world([row('p1', 'projects', 'Alpha', { tasks: ['t2', 'gone', 't1'] })])
    expect(linkedIds(get('p1'), p, ctx)).toEqual(['t2', 't1'])
    expect(readCell(get('p1'), p, ctx)).toEqual(['t2', 't1'])
    // Without a context: every stored id.
    expect(readCell(get('p1'), p)).toEqual(['t2', 'gone', 't1'])
  })

  it('hides rows in the trash and rows moved out of the related database', () => {
    const { ctx, get } = world([row('t1', 'tasks', 'Write', {}, { trashedAt: 5 }), row('t2', 'elsewhere', 'Test')])
    expect(linkedRows(get('p1'), p, ctx)).toEqual([])
  })

  it('hides everything while the related database is deleted, in the trash, or under a trashed page', () => {
    const { blocks, get } = world()
    const without = blocks.filter((b) => b.id !== 'tasks')
    expect(linkedRows(get('p1'), p, contextOf(without, ['tasks']))).toEqual([])
    expect(relatedDatabaseState('tasks', contextOf(without, ['tasks']))).toBe('missing')
    expect(relatedDatabaseState('tasks', contextOf(without))).toBe('loading')

    const trashed = world([db('tasks', tasksSchema(), ['t1', 't2', 't3'], { trashedAt: 9 })])
    expect(relatedDatabaseState('tasks', trashed.ctx)).toBe('trashed')
    expect(linkedRows(trashed.get('p1'), p, trashed.ctx)).toEqual([])

    const under = world([{ id: 'home', type: 'page', parentId: null, content: [], props: {}, createdAt: 1, updatedAt: 1, trashedAt: 3 }])
    expect(relatedDatabaseState('tasks', under.ctx)).toBe('trashed')
  })

  it('does not follow a relation to a linked view or to something that is not a database', () => {
    const { ctx, get } = world([db('tasks', {}, [], { props: { sourceId: 'projects' } }), row('p2', 'projects', 'Beta')])
    expect(relatedDatabaseState('tasks', ctx)).toBe('missing')
    expect(linkedRows(get('p1'), p, ctx)).toEqual([])
  })

  it('offers the live rows of the related database to link to', () => {
    const { ctx } = world([row('t3', 'tasks', 'Ship', {}, { trashedAt: 1 })])
    expect(linkableRows({ databaseId: 'tasks' }, ctx).map((b) => b.id)).toEqual(['t1', 't2'])
    expect(linkableRows(undefined, ctx)).toEqual([])
  })

  it('toggles links, replacing the link under a limit of one', () => {
    expect(toggleLink(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleLink(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleLink(['a'], 'b', 'one')).toEqual(['b'])
  })
})

describe('two-way relations', () => {
  const project = prop(tasksSchema(), 'project')

  it('a one-way relation writes the row alone', () => {
    const oneWay = prop(
      { title: TITLE, project: { id: 'project', name: 'P', type: 'relation', relation: { databaseId: 'projects' } } },
      'project'
    )
    const { ctx, get } = world()
    const writes = relationWrites(get('t3'), oneWay, ['p2'], ctx)
    expect([...writes.keys()]).toEqual(['t3'])
    expect(writes.get('t3')).toEqual({ project: ['p2'] })
  })

  it('a new link shows on the other side, a removed one goes from it', () => {
    const { ctx, get } = world()
    const writes = relationWrites(get('t1'), project, ['p2'], ctx)
    expect(writes.get('t1')).toEqual({ project: ['p2'], hours: 2 })
    expect(writes.get('p1')).toEqual({ tasks: ['t2'] })
    expect(writes.get('p2')).toEqual({ tasks: ['t1'] })
  })

  it('clearing a cell removes the key and the links back', () => {
    const { ctx, get } = world()
    const writes = relationWrites(get('t2'), project, [], ctx)
    expect(writes.get('t2')).toEqual({ hours: 3 })
    expect(writes.get('p1')).toEqual({ tasks: ['t1'] })
  })

  it('writes nothing when nothing changes', () => {
    const { ctx, get } = world()
    expect(relationWrites(get('t1'), project, ['p1'], ctx).size).toBe(0)
  })

  it('a partner that holds one link gives up the previous one, on both sides', () => {
    // Tasks.project is many here; Projects.tasks holds one task only.
    const schema = tasksSchema()
    const { ctx, get } = world([
      db('projects', projectsSchema('one'), ['p1', 'p2']),
      row('p1', 'projects', 'Alpha', { tasks: ['t1'] }),
      row('t2', 'tasks', 'Test', {})
    ])
    const writes = relationWrites(get('t2'), prop(schema, 'project'), ['p1'], ctx)
    expect(writes.get('t2')).toEqual({ project: ['p1'] })
    expect(writes.get('p1')).toEqual({ tasks: ['t2'] })
    // t1 linked to p1; p1 now links to t2 only, so t1 loses p1.
    expect(writes.get('t1')).toEqual({ hours: 2 })
  })

  it('keeps a self-relation in step within one database', () => {
    const people: Schema = {
      title: TITLE,
      manager: {
        id: 'manager',
        name: 'Manager',
        type: 'relation',
        relation: { databaseId: 'people', syncedPropertyId: 'reports', limit: 'one' }
      },
      reports: { id: 'reports', name: 'Reports', type: 'relation', relation: { databaseId: 'people', syncedPropertyId: 'manager' } }
    }
    const blocks = [db('people', people, ['ann', 'bob']), row('ann', 'people', 'Ann'), row('bob', 'people', 'Bob')]
    const ctx = contextOf(blocks)
    const manager = prop(people, 'manager')
    const writes = relationWrites(blocks[2], manager, ['ann'], ctx)
    expect(writes.get('bob')).toEqual({ manager: ['ann'] })
    expect(writes.get('ann')).toEqual({ reports: ['bob'] })
    // Linking a row to itself writes both properties of that one row.
    const self = relationWrites(blocks[1], manager, ['ann'], ctx)
    expect(self.get('ann')).toEqual({ manager: ['ann'], reports: ['ann'] })
  })

  it('leaves rows it does not have alone', () => {
    const { blocks, get } = world()
    const ctx = contextOf(blocks.filter((b) => b.id !== 'p2'))
    const writes = relationWrites(get('t3'), project, ['p2'], ctx)
    expect([...writes.keys()]).toEqual(['t3'])
  })

  it('backfills the partner when a relation becomes two-way', () => {
    const { ctx, get } = world([row('p1', 'projects', 'Alpha', {}), row('t3', 'tasks', 'Ship', { project: ['p1', 'p2'] })])
    const writes = partnerBackfill([get('t1'), get('t2'), get('t3')], project, 'tasks', ctx)
    expect(writes.get('p1')).toEqual({ tasks: ['t1', 't2', 't3'] })
    expect(writes.get('p2')).toEqual({ tasks: ['t3'] })
  })

  it('names the partner after the database it comes from and points it back', () => {
    const { schema, partner } = addPartnerProperty(projectsSchema(), {
      partnerId: 'new',
      sourceDatabaseId: 'tasks',
      sourceTitle: 'Tasks',
      propertyId: 'project'
    })
    expect(partner).toEqual({
      id: 'new',
      name: 'Tasks 1',
      type: 'relation',
      relation: { databaseId: 'tasks', syncedPropertyId: 'project' }
    })
    expect(schema.new).toBe(partner)
    expect(dropPartnerLink(schema, 'new').new.relation).toEqual({ databaseId: 'tasks' })
    expect(dropPartnerLink(schema, 'title')).toBe(schema)
  })
})

describe('relation schema changes', () => {
  it('adds a relation pointing at its database, or nowhere when none is given', () => {
    const added = addProperty({ title: TITLE }, { type: 'relation', name: 'Projects', relation: { databaseId: 'projects' } })
    expect(added.property).toMatchObject({ name: 'Projects', type: 'relation', relation: { databaseId: 'projects' } })
    expect(addProperty({ title: TITLE }, { type: 'relation', relation: { databaseId: 'bad id' } }).property.relation).toBeUndefined()
  })

  it('drops the links when a relation changes type, or when something becomes one', () => {
    const rows = [row('t1', 'tasks', 'A', { project: ['p1'], hours: 2 }), row('t2', 'tasks', 'B', { hours: 3 })]
    const toText = changePropertyType(tasksSchema(), 'project', 'text', rows)
    expect(toText.schema.project).toEqual({ id: 'project', name: 'Project', type: 'text' })
    expect(toText.rowValues).toEqual({ t1: { hours: 2 } })
    const toRelation = changePropertyType(tasksSchema(), 'hours', 'relation', rows, { databaseId: 'projects' })
    expect(toRelation.schema.hours).toEqual({ id: 'hours', name: 'Hours', type: 'relation', relation: { databaseId: 'projects' } })
    expect(toRelation.rowValues).toEqual({ t1: { project: ['p1'] }, t2: {} })
  })

  it('points a relation elsewhere and sets its limit', () => {
    const schema = tasksSchema()
    const moved = setRelationTarget(schema, 'project', 'people')
    expect(moved.project.relation).toEqual({ databaseId: 'people' })
    expect(setRelationTarget(schema, 'project', 'projects')).toBe(schema)
    expect(setRelationTarget(schema, 'hours', 'people')).toBe(schema)
    expect(setRelationLimit(schema, 'project', 'one').project.relation).toEqual({
      databaseId: 'projects',
      syncedPropertyId: 'tasks',
      limit: 'one'
    })
    expect(setRelationLimit(setRelationLimit(schema, 'project', 'one'), 'project', undefined).project.relation).toEqual(
      schema.project.relation
    )
    expect(setRelationLimit(schema, 'project', undefined)).toBe(schema)
  })
})

describe('filtering and sorting by a relation', () => {
  const tasks = normalizeDatabase(world().get('tasks')).schema

  it('offers contains and emptiness, with row ids as values', () => {
    expect(operatorsOf(tasks.project)).toEqual(['contains', 'not_contains', 'is_empty', 'is_not_empty'])
    expect(filterTypeOf(tasks.project)).toBe('relation')
    expect(filterValueFor(tasks.project, 'p1')).toEqual(['p1'])
    expect(filterValueFor(tasks.project, ['bad id', 'p1'])).toEqual(['p1'])
    expect(filterValueFor(tasks.project, [])).toBeUndefined()
  })

  it('matches the rows that link to a page, and empty cells by what they show', () => {
    const { ctx, get } = world([row('p1', 'projects', 'Alpha', {}, { trashedAt: 3 })])
    const rows = ['t1', 't2', 't3'].map(get)
    const view = (filters: DatabaseView['filters']): DatabaseView => ({
      id: 'v',
      name: 'V',
      type: 'table',
      visibleProperties: [],
      filters,
      sorts: []
    })
    // p1 is in the trash: t1 and t2 show nothing, so they count as empty.
    expect(queryRows(rows, tasks, view([{ propertyId: 'project', operator: 'is_empty' }]), '', ctx).map((r) => r.id)).toEqual([
      't1',
      't2',
      't3'
    ])
    const live = world()
    const liveRows = ['t1', 't2', 't3'].map(live.get)
    expect(
      queryRows(liveRows, tasks, view([{ propertyId: 'project', operator: 'contains', value: ['p1'] }]), '', live.ctx).map((r) => r.id)
    ).toEqual(['t1', 't2'])
    expect(
      queryRows(liveRows, tasks, view([{ propertyId: 'project', operator: 'not_contains', value: 'p1' }]), '', live.ctx).map((r) => r.id)
    ).toEqual(['t3'])
    expect(matchesFilter(live.get('t3'), tasks.project, { propertyId: 'project', operator: 'is_not_empty' }, live.ctx)).toBe(false)
  })

  it('sorts by the titles of the linked rows, empty cells last', () => {
    const { ctx, get } = world([row('t3', 'tasks', 'Ship', { project: ['p2'] }), row('t2', 'tasks', 'Test', {})])
    const sorted = queryRows(
      ['t1', 't2', 't3'].map(get),
      tasks,
      { id: 'v', name: 'V', type: 'table', visibleProperties: [], filters: [], sorts: [{ propertyId: 'project', direction: 'desc' }] },
      '',
      ctx
    )
    expect(sorted.map((r) => r.id)).toEqual(['t3', 't1', 't2'])
  })

  it('gives a new row the links a contains rule asks for', () => {
    expect(defaultsFromFilters(tasks, [{ propertyId: 'project', operator: 'contains', value: ['p1'] }]).values).toEqual({ project: ['p1'] })
    expect(defaultsFromFilters(tasks, [{ propertyId: 'project', operator: 'not_contains', value: ['p1'] }]).values).toEqual({})
  })

  it('keeps relation filter rules through normalisation', () => {
    const schema = tasksSchema()
    const block = db('tasks', schema, [], {
      props: {
        schema,
        views: [
          {
            id: 'v',
            name: 'V',
            type: 'table',
            visibleProperties: ['title'],
            filters: [
              { propertyId: 'project', operator: 'contains', value: ['p1'] },
              { propertyId: 'project', operator: 'gt', value: 3 }
            ],
            sorts: []
          }
        ]
      }
    })
    expect(normalizeDatabase(block).views[0].filters).toEqual([{ propertyId: 'project', operator: 'contains', value: ['p1'] }])
  })
})
