import { describe, expect, it } from 'vitest'
import type { Block } from '../../../shared/types'
import { MAX_BESIDE, besideChoice, canShareRow, rowsOf, sitsBeside } from './layout'

const block = (id: string, type: Block['type'], beside = false): Block =>
  ({ id, type, parentId: 'p', content: [], props: beside ? { beside: true } : {}, createdAt: 0, updatedAt: 0, trashedAt: null }) as Block

const ids = (rows: Block[][]): string[][] => rows.map((row) => row.map((b) => b.id))

describe('blocks side by side', () => {
  it('only lets database blocks share a row', () => {
    expect(canShareRow(block('a', 'database'))).toBe(true)
    expect(canShareRow(block('a', 'text', true))).toBe(false)
    expect(canShareRow(undefined)).toBe(false)
    expect(sitsBeside(block('b', 'database', true), block('a', 'database'))).toBe(true)
    expect(sitsBeside(block('b', 'database'), block('a', 'database'))).toBe(false)
    expect(sitsBeside(block('b', 'database', true), block('a', 'text'))).toBe(false)
    expect(sitsBeside(block('b', 'database', true), undefined)).toBe(false)
    expect(sitsBeside(block('b', 'image', true), block('a', 'database'))).toBe(false)
  })

  it('puts a database block beside the one before it when it asks to', () => {
    const blocks = [
      block('t', 'text'),
      block('a', 'database'),
      block('b', 'database', true),
      block('c', 'database', true),
      block('u', 'text'),
      block('d', 'database')
    ]
    expect(ids(rowsOf(blocks))).toEqual([['t'], ['a', 'b', 'c'], ['u'], ['d']])
  })

  it('ignores the wish of a block that has nothing to sit beside', () => {
    expect(ids(rowsOf([block('a', 'database', true), block('t', 'text'), block('b', 'database', true)]))).toEqual([['a'], ['t'], ['b']])
    expect(ids(rowsOf([block('a', 'database'), block('b', 'database')]))).toEqual([['a'], ['b']])
    expect(rowsOf([])).toEqual([])
  })

  it('starts a new row once one is full', () => {
    const many = Array.from({ length: MAX_BESIDE + 2 }, (_, i) => block(`d${i}`, 'database', true))
    const rows = rowsOf(many)
    expect(rows.map((row) => row.length)).toEqual([MAX_BESIDE, 2])
    // The block that could not fit leads the next row, and the one after it sits beside it.
    expect(rows[1][0].id).toBe(`d${MAX_BESIDE}`)
  })
})

describe('the choice the block menu offers', () => {
  it('offers to join the row before, to leave a row, or nothing', () => {
    const blocks = [
      block('t', 'text'),
      block('a', 'database'),
      block('b', 'database', true),
      block('c', 'database'),
      block('u', 'text', true)
    ]
    expect(besideChoice(blocks, 'b')).toBe('below')
    expect(besideChoice(blocks, 'c')).toBe('beside')
    // The first database has nothing to sit beside; text never shares a row.
    expect(besideChoice(blocks, 'a')).toBeNull()
    expect(besideChoice(blocks, 't')).toBeNull()
    expect(besideChoice(blocks, 'u')).toBeNull()
    expect(besideChoice(blocks, 'missing')).toBeNull()
  })

  it('offers nothing when the row before is full', () => {
    const full = Array.from({ length: MAX_BESIDE }, (_, i) => block(`d${i}`, 'database', i > 0))
    expect(besideChoice([...full, block('e', 'database')], 'e')).toBeNull()
    // Marked, but pushed into a row of its own: there is nothing to undo either.
    expect(besideChoice([...full, block('e', 'database', true)], 'e')).toBeNull()
  })
})
