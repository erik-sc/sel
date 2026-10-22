import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema } from '../types'
import { createRowQuery, queryRows } from './query'
import { cellContext } from './resolve'
import { setValue, valuesOf, type Schema } from './values'

const STATUS: PropertySchema = {
  id: 'status',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'a', name: 'Alpha', color: 'gray' },
    { id: 'b', name: 'Beta', color: 'blue' }
  ]
}

const SCHEMA: Schema = {
  title: { id: 'title', name: 'Name', type: 'title' },
  n: { id: 'n', name: 'N', type: 'number' },
  status: STATUS,
  double: { id: 'double', name: 'Double', type: 'formula', formula: { expression: 'prop("N") * 2' } }
}

function row(i: number, n: number | null, status: string | null): Block {
  let values = setValue({}, 'n', n)
  values = setValue(values, 'status', status)
  return {
    id: `r${i}`,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: [[`Row ${i % 13}`]], values },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null
  }
}

const VIEWS: DatabaseView[] = [
  { id: 'plain', name: 'Plain', type: 'table', visibleProperties: [], filters: [], sorts: [] },
  {
    id: 'sorted',
    name: 'Sorted',
    type: 'table',
    visibleProperties: ['status'],
    filters: [{ propertyId: 'double', operator: 'gt', value: 10 }],
    sorts: [
      { propertyId: 'status', direction: 'desc' },
      { propertyId: 'double', direction: 'asc' }
    ]
  },
  {
    id: 'empty-last',
    name: 'Empty last',
    type: 'table',
    visibleProperties: [],
    filters: [{ propertyId: 'status', operator: 'is_not_empty' }],
    sorts: [{ propertyId: 'n', direction: 'desc' }]
  }
]

let seed = 3
function rnd(n: number): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed % n
}

describe('createRowQuery', () => {
  it('gives what queryRows gives, edit after edit, and the same array when nothing moved', () => {
    for (const view of VIEWS) {
      seed = 3
      let rows = Array.from({ length: 300 }, (_, i) => row(i, rnd(5) ? rnd(30) : null, rnd(4) ? (rnd(2) ? 'a' : 'b') : null))
      const db: Block = {
        id: 'db',
        type: 'database',
        parentId: null,
        content: [],
        props: { schema: SCHEMA, views: [view] },
        createdAt: 1,
        updatedAt: 1,
        trashedAt: null
      }
      const ctx = cellContext({ get: (id) => (id === 'db' ? db : rows.find((r) => r.id === id)) })
      const schema = ctx.schemaOf('db') as Schema
      const query = createRowQuery()
      let previous = query(rows, schema, view, '', ctx)
      expect(previous).toEqual(queryRows(rows, schema, view, '', ctx))
      expect(query(rows, schema, view, '', ctx)).toBe(previous)
      for (let step = 0; step < 200; step++) {
        const next = rows.slice()
        const kind = rnd(10)
        if (kind < 7) {
          // An edit to one to three rows: a number, a status, a title.
          for (let k = rnd(3) + 1; k > 0; k--) {
            const i = rnd(next.length)
            const r = next[i]
            const values = rnd(2)
              ? setValue(valuesOf(r), 'n', rnd(6) ? rnd(30) : null)
              : setValue(valuesOf(r), 'status', rnd(3) ? 'ab'[rnd(2)] : null)
            next[i] = { ...r, props: { ...r.props, values } }
          }
        } else if (kind === 7) {
          next.splice(rnd(next.length), 1)
        } else if (kind === 8) {
          next.push(row(1000 + step, rnd(30), 'a'))
        } else {
          const [moved] = next.splice(rnd(next.length), 1)
          next.splice(rnd(next.length), 0, moved)
        }
        rows = next
        const search = step % 50 > 40 ? 'row 1' : ''
        const got = query(rows, schema, view, search, ctx)
        expect(got.map((r) => r.id)).toEqual(queryRows(rows, schema, view, search, ctx).map((r) => r.id))
        expect(got).toEqual(queryRows(rows, schema, view, search, ctx))
        if (got !== previous) expect(got.length !== previous.length || got.some((r, i) => r !== previous[i])).toBe(true)
        previous = got
      }
    }
  })

  it('places an edited row again among 5,000 sorted ones without sorting them all', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row(i, (i * 37) % 1000, 'a'))
    const view = VIEWS[2]
    const query = createRowQuery()
    const first = query(rows, SCHEMA, view)
    const edited = rows.slice()
    edited[123] = row(123, 5000, 'a')
    const started = performance.now()
    const out = query(edited, SCHEMA, view)
    const took = performance.now() - started
    expect(out[0].id).toBe('r123')
    expect(out).toEqual(queryRows(edited, SCHEMA, view))
    expect(first).not.toBe(out)
    // A full query of 5,000 rows takes several ms; placing one row, well under one.
    expect(took).toBeLessThan(20)
  })
})
