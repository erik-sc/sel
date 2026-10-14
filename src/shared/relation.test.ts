import { describe, expect, it } from 'vitest'
import type { BlockProps } from './types'
import { MAX_RELATION_LINKS, isRelationId, partnerOf, relationIds, relinkDuplicate, sanitizeRelationConfig, type DuplicateCopy } from './relation'

describe('relation configuration', () => {
  it('keeps a clean configuration by reference', () => {
    const clean = { databaseId: 'db2', syncedPropertyId: 'back', limit: 'one' as const }
    expect(sanitizeRelationConfig(clean)).toBe(clean)
    expect(sanitizeRelationConfig({ databaseId: 'db2' })).toEqual({ databaseId: 'db2' })
  })

  it('drops what is malformed and refuses a configuration without a database', () => {
    expect(sanitizeRelationConfig({ databaseId: 'db2', syncedPropertyId: 7, limit: 'two' })).toEqual({ databaseId: 'db2' })
    expect(sanitizeRelationConfig({ databaseId: 'db2', syncedPropertyId: '__proto__' })).toEqual({ databaseId: 'db2' })
    expect(sanitizeRelationConfig({ databaseId: '' })).toBeUndefined()
    expect(sanitizeRelationConfig({ databaseId: 'has space' })).toBeUndefined()
    expect(sanitizeRelationConfig({ databaseId: 'constructor' })).toBeUndefined()
    expect(sanitizeRelationConfig(['db2'])).toBeUndefined()
    expect(sanitizeRelationConfig(null)).toBeUndefined()
  })

  it('accepts block ids and nothing that could reach a prototype', () => {
    expect(isRelationId('6f1c0a4e-1111-4222-8333-444455556666')).toBe(true)
    expect(isRelationId('__proto__')).toBe(false)
    expect(isRelationId('toString')).toBe(false)
    expect(isRelationId('x'.repeat(65))).toBe(false)
    expect(isRelationId(12)).toBe(false)
  })
})

describe('relation cells', () => {
  it('reads well-formed ids once each, in their order', () => {
    const clean = ['a', 'b']
    expect(relationIds(clean)).toBe(clean)
    expect(relationIds(['a', 'a', 3, null, 'b', '__proto__', 'bad id'])).toEqual(['a', 'b'])
    expect(relationIds('a')).toEqual(['a'])
    expect(relationIds({ a: 1 })).toEqual([])
    expect(relationIds(undefined)).toEqual([])
  })

  it('caps the number of links, at one under a limit of one', () => {
    const many = Array.from({ length: MAX_RELATION_LINKS + 20 }, (_, i) => `r${i}`)
    expect(relationIds(many)).toHaveLength(MAX_RELATION_LINKS)
    expect(relationIds(['b', 'a'], 'one')).toEqual(['b'])
  })
})

describe('partner of a two-way relation', () => {
  const target = {
    title: { id: 'title', name: 'Name', type: 'title' },
    back: { id: 'back', name: 'Tasks', type: 'relation', relation: { databaseId: 'tasks', syncedPropertyId: 'projects' } },
    other: { id: 'other', name: 'Other', type: 'relation', relation: { databaseId: 'elsewhere', syncedPropertyId: 'projects' } }
  }

  it('is found only when it points back at the relation', () => {
    const config = { databaseId: 'projects-db', syncedPropertyId: 'back' }
    expect(partnerOf(config, 'projects', 'tasks', target)?.id).toBe('back')
    expect(partnerOf(config, 'projects', 'not-tasks', target)).toBeUndefined()
    expect(partnerOf(config, 'another-prop', 'tasks', target)).toBeUndefined()
    expect(partnerOf({ databaseId: 'projects-db', syncedPropertyId: 'other' }, 'projects', 'tasks', target)).toBeUndefined()
    expect(partnerOf({ databaseId: 'projects-db' }, 'projects', 'tasks', target)).toBeUndefined()
    expect(partnerOf(config, 'projects', 'tasks', 'not a schema')).toBeUndefined()
  })
})

// ---- duplicating ----

interface Stored {
  id: string
  type: string
  parentId: string | null
  props: BlockProps
}

const TITLE = { id: 'title', name: 'Name', type: 'title' as const }

function lookup(blocks: Stored[]): { get: (id: string) => Stored | undefined } {
  const byId = new Map(blocks.map((b) => [b.id, b]))
  return { get: (id) => byId.get(id) }
}

function copyOfAll(pairs: [string, string][]): Map<string, string> {
  return new Map(pairs)
}

describe('relinkDuplicate', () => {
  // Tasks (with "Project", two-way with Projects.Tasks) and Projects.
  const tasks: Stored = {
    id: 'tasks',
    type: 'database',
    parentId: null,
    props: {
      schema: {
        title: TITLE,
        project: { id: 'project', name: 'Project', type: 'relation', relation: { databaseId: 'projects', syncedPropertyId: 'tasks' } }
      }
    }
  }
  const projects: Stored = {
    id: 'projects',
    type: 'database',
    parentId: null,
    props: {
      schema: {
        title: TITLE,
        tasks: { id: 'tasks', name: 'Tasks', type: 'relation', relation: { databaseId: 'tasks', syncedPropertyId: 'project' } }
      }
    }
  }
  const p1: Stored = { id: 'p1', type: 'page', parentId: 'projects', props: { values: { tasks: ['t1'] } } }
  const t1: Stored = { id: 't1', type: 'page', parentId: 'tasks', props: { values: { project: ['p1'] } } }

  it('adds a duplicated row to the other side of its two-way relations', () => {
    const copy: DuplicateCopy = { id: 't1-copy', type: 'page', parentId: 'tasks', props: { values: { project: ['p1'] } } }
    const updates = relinkDuplicate([copy], copyOfAll([['t1', 't1-copy']]), lookup([tasks, projects, p1, t1]))
    expect(copy.props.values).toEqual({ project: ['p1'] })
    expect(updates.get('p1')).toEqual({ tasks: ['t1', 't1-copy'] })
    expect(updates.size).toBe(1)
  })

  it('gives up a link the other side can hold only once', () => {
    const oneProjects: Stored = {
      ...projects,
      props: {
        schema: {
          title: TITLE,
          tasks: { id: 'tasks', name: 'Tasks', type: 'relation', relation: { databaseId: 'tasks', syncedPropertyId: 'project', limit: 'one' } }
        }
      }
    }
    const copy: DuplicateCopy = { id: 't1-copy', type: 'page', parentId: 'tasks', props: { values: { project: ['p1'], note: 'kept' } } }
    const updates = relinkDuplicate([copy], copyOfAll([['t1', 't1-copy']]), lookup([tasks, oneProjects, p1, t1]))
    expect(updates.size).toBe(0)
    expect(copy.props.values).toEqual({ note: 'kept' })
  })

  it('leaves one-way relations and rows that are not linked back alone', () => {
    const oneWayTasks: Stored = {
      ...tasks,
      props: { schema: { title: TITLE, project: { id: 'project', name: 'Project', type: 'relation', relation: { databaseId: 'projects' } } } }
    }
    const copy: DuplicateCopy = { id: 't1-copy', type: 'page', parentId: 'tasks', props: { values: { project: ['p1', 'gone'] } } }
    expect(relinkDuplicate([copy], copyOfAll([['t1', 't1-copy']]), lookup([oneWayTasks, projects, p1, t1])).size).toBe(0)
    expect(copy.props.values).toEqual({ project: ['p1', 'gone'] })
  })

  it('points a copied self-relation at the copied rows', () => {
    const people: Stored = {
      id: 'people',
      type: 'database',
      parentId: null,
      props: { schema: { title: TITLE, knows: { id: 'knows', name: 'Knows', type: 'relation', relation: { databaseId: 'people' } } } }
    }
    const dbCopy: DuplicateCopy = { id: 'people-copy', type: 'database', parentId: null, props: JSON.parse(JSON.stringify(people.props)) }
    const aCopy: DuplicateCopy = { id: 'a-copy', type: 'page', parentId: 'people-copy', props: { values: { knows: ['b', 'trashed-one'] } } }
    const bCopy: DuplicateCopy = { id: 'b-copy', type: 'page', parentId: 'people-copy', props: { values: { knows: ['a'] } } }
    const map = copyOfAll([
      ['people', 'people-copy'],
      ['a', 'a-copy'],
      ['b', 'b-copy']
    ])
    const updates = relinkDuplicate([aCopy, bCopy, dbCopy], map, lookup([people]))
    expect(updates.size).toBe(0)
    expect((dbCopy.props.schema as Record<string, { relation: unknown }>).knows.relation).toEqual({ databaseId: 'people-copy' })
    // A link to a row that was not copied (in the trash) cannot be a row of the copy.
    expect(aCopy.props.values).toEqual({ knows: ['b-copy'] })
    expect(bCopy.props.values).toEqual({ knows: ['a-copy'] })
  })

  it('makes a copied two-way relation to a database that was not copied one-way', () => {
    const dbCopy: DuplicateCopy = { id: 'tasks-copy', type: 'database', parentId: null, props: JSON.parse(JSON.stringify(tasks.props)) }
    const rowCopy: DuplicateCopy = { id: 't1-copy', type: 'page', parentId: 'tasks-copy', props: { values: { project: ['p1'] } } }
    const updates = relinkDuplicate(
      [rowCopy, dbCopy],
      copyOfAll([
        ['tasks', 'tasks-copy'],
        ['t1', 't1-copy']
      ]),
      lookup([tasks, projects, p1, t1])
    )
    expect((dbCopy.props.schema as Record<string, { relation: unknown }>).project.relation).toEqual({ databaseId: 'projects' })
    // The copy still links to the same project; the project does not link back to the copy.
    expect(rowCopy.props.values).toEqual({ project: ['p1'] })
    expect(updates.size).toBe(0)
  })

  it('keeps both halves of a two-way relation when both databases are copied', () => {
    const tasksCopy: DuplicateCopy = { id: 'tasks-copy', type: 'database', parentId: 'page-copy', props: JSON.parse(JSON.stringify(tasks.props)) }
    const projectsCopy: DuplicateCopy = { id: 'projects-copy', type: 'database', parentId: 'page-copy', props: JSON.parse(JSON.stringify(projects.props)) }
    const t1Copy: DuplicateCopy = { id: 't1-copy', type: 'page', parentId: 'tasks-copy', props: { values: { project: ['p1'] } } }
    const p1Copy: DuplicateCopy = { id: 'p1-copy', type: 'page', parentId: 'projects-copy', props: { values: { tasks: ['t1'] } } }
    const updates = relinkDuplicate(
      [t1Copy, tasksCopy, p1Copy, projectsCopy],
      copyOfAll([
        ['tasks', 'tasks-copy'],
        ['projects', 'projects-copy'],
        ['t1', 't1-copy'],
        ['p1', 'p1-copy']
      ]),
      lookup([tasks, projects, p1, t1])
    )
    expect(updates.size).toBe(0)
    expect((tasksCopy.props.schema as Record<string, { relation: unknown }>).project.relation).toEqual({ databaseId: 'projects-copy', syncedPropertyId: 'tasks' })
    expect((projectsCopy.props.schema as Record<string, { relation: unknown }>).tasks.relation).toEqual({ databaseId: 'tasks-copy', syncedPropertyId: 'project' })
    expect(t1Copy.props.values).toEqual({ project: ['p1-copy'] })
    expect(p1Copy.props.values).toEqual({ tasks: ['t1-copy'] })
  })

  it('ignores malformed schemas and values', () => {
    const broken: Stored = { id: 'broken', type: 'database', parentId: null, props: { schema: 'nope' as never } }
    const copy: DuplicateCopy = { id: 'c', type: 'page', parentId: 'broken', props: { values: { project: 'p1' } } }
    expect(relinkDuplicate([copy], copyOfAll([['x', 'c']]), lookup([broken])).size).toBe(0)
    expect(copy.props.values).toEqual({ project: 'p1' })
  })
})
