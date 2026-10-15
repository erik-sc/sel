import { beforeEach, describe, expect, it } from 'vitest'
import type { Block } from '../../shared/types'
import { isSystemBlock, isSystemKind, systemKindOf } from '../../shared/system'
import type { Repository } from './repository'
import { openTestRepository } from './testing'

let repo: Repository

const page = (title: string, parentId: string | null = null): Block => repo.create({ type: 'page', parentId, props: { title: [[title]] } })
const tasks = (): Block => repo.create({ type: 'database', parentId: null, props: { title: [['Tasks']], system: 'tasks' } })

beforeEach(() => {
  repo = openTestRepository()
})

describe('shared helpers', () => {
  it('recognise only known kinds on pages and databases', () => {
    expect(isSystemKind('tasks')).toBe(true)
    expect(isSystemKind('notes')).toBe(false)
    expect(systemKindOf({ type: 'database', props: { system: 'tasks' } })).toBe('tasks')
    expect(systemKindOf({ type: 'text', props: { system: 'tasks' } })).toBeNull()
    expect(systemKindOf({ type: 'database', props: { system: 'other' } })).toBeNull()
    expect(isSystemBlock({ type: 'database', props: null })).toBe(false)
    expect(isSystemBlock(null)).toBe(false)
  })
})

describe('built-in databases', () => {
  it('are created at the root, as pages or databases, with a known kind', () => {
    const db = tasks()
    expect(db.props.system).toBe('tasks')
    expect(db.props.schema).toBeDefined()
    const parent = page('Inbox')
    expect(() => repo.create({ type: 'database', parentId: parent.id, props: { system: 'tasks' } })).toThrow(/workspace root/)
    expect(() => repo.create({ type: 'database', parentId: null, props: { system: 'anything' as never } })).toThrow(/Invalid built-in kind/)
  })

  it('cannot be deleted, trashed for good or moved into a page', () => {
    const db = tasks()
    const other = page('Other')
    expect(() => repo.delete(db.id)).toThrow(/cannot be deleted/)
    expect(() => repo.apply([{ op: 'delete', id: db.id }])).toThrow(/cannot be deleted/)
    expect(() => repo.deleteForever(db.id)).toThrow(/cannot be deleted/)
    expect(() => repo.move(db.id, other.id)).toThrow(/cannot be moved/)
    const after = repo.get(db.id)
    expect(after?.trashedAt).toBeNull()
    expect(after?.parentId).toBeNull()
  })

  it('may be reordered among the root pages', () => {
    const first = page('First')
    const db = tasks()
    repo.move(db.id, null, null)
    expect(repo.get(db.id)?.parentId).toBeNull()
    repo.move(first.id, null, db.id)
    expect(repo.get(first.id)?.parentId).toBeNull()
  })

  it('keep their kind and their type', () => {
    const db = tasks()
    expect(() => repo.update(db.id, { props: { system: null } })).toThrow(/stop being one/)
    expect(() => repo.update(db.id, { type: 'page' })).toThrow(/change its type/)
    expect(() => repo.update(db.id, { type: 'text' })).toThrow()
    expect(repo.get(db.id)?.type).toBe('database')
    expect(repo.get(db.id)?.props.system).toBe('tasks')
    // Ordinary edits go through.
    repo.update(db.id, { props: { title: [['My tasks']], system: 'tasks' } })
    expect(repo.get(db.id)?.props.title).toEqual([['My tasks']])
  })

  it('cannot be made out of an existing block', () => {
    const plain = page('Plain')
    expect(() => repo.update(plain.id, { props: { system: 'tasks' } })).toThrow(/cannot become/)
    expect(repo.get(plain.id)?.props.system).toBeUndefined()
  })

  it('leave a failed batch without a trace', () => {
    const db = tasks()
    const other = page('Other')
    expect(() =>
      repo.apply([
        { op: 'update', id: other.id, patch: { props: { title: [['Renamed']] } } },
        { op: 'delete', id: db.id }
      ])
    ).toThrow()
    expect(repo.get(other.id)?.props.title).toEqual([['Other']])
  })

  it('duplicate into an ordinary database', () => {
    const db = tasks()
    const copy = repo.duplicate(db.id)
    expect(copy.props.system).toBeUndefined()
    expect(() => repo.delete(copy.id)).not.toThrow()
  })

  it('are never planted by a tree (imports, proposals)', () => {
    const made = repo.createTree({ type: 'database', props: { title: [['Imported']], system: 'tasks' } }, null)
    expect(made.props.system).toBeUndefined()
  })

  it('leave their rows free to come and go', () => {
    const db = tasks()
    const row = repo.create({ type: 'page', parentId: db.id, props: { title: [['Buy milk']] } })
    repo.delete(row.id)
    expect(repo.get(row.id)?.trashedAt).not.toBeNull()
  })
})
