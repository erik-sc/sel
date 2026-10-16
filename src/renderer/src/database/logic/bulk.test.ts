// Bulk edits, the quick search over properties and placing restored rows back.
import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema, PropertyValue } from '../../../../shared/types'
import * as L from '../logic'

const status: PropertySchema = {
  id: 'st',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'todo', name: 'To do', color: 'gray' },
    { id: 'done', name: 'Done', color: 'green' }
  ]
}
const tags: PropertySchema = {
  id: 'tags',
  name: 'Tags',
  type: 'multi_select',
  options: [
    { id: 'a', name: 'Home', color: 'red' },
    { id: 'b', name: 'Work', color: 'blue' }
  ]
}
const done: PropertySchema = { id: 'ok', name: 'Done', type: 'checkbox' }
const due: PropertySchema = { id: 'due', name: 'Due', type: 'date' }
const notes: PropertySchema = { id: 'notes', name: 'Notes', type: 'text' }
const amount: PropertySchema = { id: 'n', name: 'Amount', type: 'number' }
const title: PropertySchema = { id: 't', name: 'Name', type: 'title' }
const formula: PropertySchema = { id: 'f', name: 'F', type: 'formula', formula: { expression: '1' } }
const relation: PropertySchema = { id: 'r', name: 'Project', type: 'relation' }

describe('bulk edits', () => {
  it('only changes stored values', () => {
    expect([status, tags, done, due, notes, amount].every(L.isBulkEditable)).toBe(true)
    expect([title, formula, relation].some(L.isBulkEditable)).toBe(false)
    expect(L.bulkValue(formula, 'x', { kind: 'clear' })).toBe('x')
  })

  it('sets a select to an option that exists', () => {
    expect(L.bulkValue(status, 'todo', { kind: 'set', value: 'done' })).toBe('done')
    expect(L.bulkValue(status, null, { kind: 'set', value: 'done' })).toBe('done')
    expect(L.bulkValue(status, 'todo', { kind: 'set', value: 'gone' })).toBe('todo')
    expect(L.bulkValue(status, 'todo', { kind: 'clear' })).toBeNull()
  })

  it('adds and removes one option of a multi-select, leaving the others', () => {
    expect(L.bulkValue(tags, ['a'], { kind: 'add', optionId: 'b' })).toEqual(['a', 'b'])
    expect(L.bulkValue(tags, null, { kind: 'add', optionId: 'b' })).toEqual(['b'])
    const same: PropertyValue = ['b']
    expect(L.bulkValue(tags, same, { kind: 'add', optionId: 'b' })).toBe(same)
    expect(L.bulkValue(tags, ['a', 'b'], { kind: 'remove', optionId: 'a' })).toEqual(['b'])
    expect(L.bulkValue(tags, ['a'], { kind: 'add', optionId: 'gone' })).toEqual(['a'])
    expect(L.bulkValue(tags, ['a', 'b'], { kind: 'clear' })).toBeNull()
  })

  it('checks and unchecks', () => {
    expect(L.bulkValue(done, false, { kind: 'set', value: true })).toBe(true)
    expect(L.bulkValue(done, true, { kind: 'set', value: false })).toBe(false)
    expect(L.bulkValue(done, true, { kind: 'clear' })).toBe(false)
  })

  it('moves a date to a day, keeping its time and the length of a range', () => {
    expect(L.bulkValue(due, null, { kind: 'day', day: '2026-10-16' })).toEqual({ start: '2026-10-16' })
    expect(L.bulkValue(due, { start: '2026-10-01T09:30' }, { kind: 'day', day: '2026-10-16' })).toEqual({ start: '2026-10-16T09:30' })
    expect(L.bulkValue(due, { start: '2026-10-01', end: '2026-10-03' }, { kind: 'day', day: '2026-10-16' })).toEqual({
      start: '2026-10-16',
      end: '2026-10-18'
    })
    expect(L.bulkValue(due, { start: '2026-10-01' }, { kind: 'day', day: 'soon' })).toEqual({ start: '2026-10-01' })
    expect(L.bulkValue(due, { start: '2026-10-01' }, { kind: 'clear' })).toBeNull()
  })

  it('clears text, numbers and URLs, and sets nothing else on them', () => {
    expect(L.bulkValue(notes, 'hi', { kind: 'clear' })).toBeNull()
    expect(L.bulkValue(amount, 3, { kind: 'clear' })).toBeNull()
    expect(L.bulkValue(notes, 'hi', { kind: 'set', value: 'other' })).toBe('hi')
    expect(L.bulkValue(amount, 3, { kind: 'day', day: '2026-10-16' })).toBe(3)
  })
})

function row(id: string, name: string, values: Record<string, PropertyValue> = {}): Block {
  return { id, type: 'page', parentId: 'db', content: [], props: { title: [[name]], values }, createdAt: 1, updatedAt: 1, trashedAt: null }
}

describe('quick search', () => {
  const schema: L.Schema = { t: title, st: status, tags, notes, n: amount, url: { id: 'url', name: 'Link', type: 'url' } }
  const rows = [
    row('r1', 'Buy apples', { st: 'todo', tags: ['a'], notes: 'from the market' }),
    row('r2', 'Call Ana', { st: 'done', tags: ['b'], n: 1250 }),
    row('r3', 'Renew passport', { url: 'https://example.org/Passport' })
  ]
  const view = (visible: string[]): DatabaseView => ({ id: 'v', name: 'T', type: 'table', visibleProperties: visible, filters: [], sorts: [] })
  const ids = (search: string, visible = Object.keys(schema)): string[] => L.queryRows(rows, schema, view(visible), search).map((r) => r.id)

  it('finds rows by the title, as before', () => {
    expect(ids('apples')).toEqual(['r1'])
    expect(ids('  CALL ')).toEqual(['r2'])
  })

  it('finds rows by the text, numbers, links and option names the view shows', () => {
    expect(ids('market')).toEqual(['r1'])
    expect(ids('work')).toEqual(['r2'])
    expect(ids('Done')).toEqual(['r2'])
    expect(ids('125')).toEqual(['r2'])
    expect(ids('example.org')).toEqual(['r3'])
  })

  it('leaves out properties the view hides, and option ids', () => {
    expect(ids('market', ['t', 'st'])).toEqual([])
    expect(ids('todo')).toEqual([])
  })

  it('keeps every row for an empty search', () => {
    expect(L.applySearch(rows, '  ', [notes])).toBe(rows)
  })
})

describe('restoreMoves', () => {
  const apply = (content: string[], moves: { id: string; afterId: string | null }[]): string[] => {
    const out = content.slice()
    for (const { id, afterId } of moves) {
      out.splice(out.indexOf(id), 1)
      out.splice(afterId === null ? 0 : out.indexOf(afterId) + 1, 0, id)
    }
    return out
  }

  it('puts restored rows back where they were', () => {
    const order = ['a', 'b', 'c', 'd', 'e']
    const content = ['a', 'c', 'e', 'b', 'd']
    const moves = L.restoreMoves(order, ['b', 'd'], content)
    expect(apply(content, moves)).toEqual(order)
  })

  it('places a row that was first back first, and after neighbours that went since', () => {
    expect(apply(['b', 'c', 'a'], L.restoreMoves(['a', 'b', 'c'], ['a'], ['b', 'c', 'a']))).toEqual(['a', 'b', 'c'])
    // 'b' was deleted for good meanwhile; 'c' goes after 'a', and a new row 'x' stays where it is.
    expect(apply(['a', 'x', 'c'], L.restoreMoves(['a', 'b', 'c'], ['c'], ['a', 'x', 'c']))).toEqual(['a', 'c', 'x'])
  })

  it('makes no move for rows already in place or that did not come back', () => {
    expect(L.restoreMoves(['a', 'b', 'c'], ['c'], ['a', 'b', 'c'])).toEqual([])
    expect(L.restoreMoves(['a', 'b', 'c'], ['b'], ['a', 'c'])).toEqual([])
  })
})

describe('date formatting reuses its formatters', () => {
  it('keeps each locale and kind apart', () => {
    expect(L.formatDay('2026-10-16', { locale: 'en-US' })).toBe('Oct 16, 2026')
    expect(L.formatDay('2026-10-16', { locale: 'pt-BR' })).toMatch(/^16 /)
    expect(L.formatDay('2026-10-17', { locale: 'en-US' })).toBe('Oct 17, 2026')
    expect(L.formatTime('14:05', { locale: 'en-US' })).toBe('2:05 PM')
    expect(L.formatTime('14:05', { locale: 'pt-BR' })).toBe('14:05')
    expect(L.monthLabel(2026, 9, 'en-US')).toBe('October 2026')
    expect(L.bucketLabel('2026-10-01', 'month', { locale: 'en-US' })).toBe('Oct 2026')
  })

  it('falls back to the ISO day for a locale Intl does not take', () => {
    expect(L.formatDay('2026-10-16', { locale: 'not a locale!' })).toBe('2026-10-16')
    expect(L.formatDay('2026-10-16', { locale: 'not a locale!' })).toBe('2026-10-16')
  })
})
