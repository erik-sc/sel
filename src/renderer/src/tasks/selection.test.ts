import { describe, expect, it } from 'vitest'
import { actsOnMany, extend, NO_SELECTION, prune, rangeBetween, selectAll, selectRange } from './selection'

const ORDER = ['a', 'b', 'c', 'd', 'e']

describe('the selection of a list', () => {
  it('takes the range between two rows, either way round', () => {
    expect(rangeBetween(ORDER, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeBetween(ORDER, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeBetween(ORDER, 'b', 'zzz')).toEqual([])
  })

  it('extends from the focused row, one row at a time', () => {
    const first = extend(NO_SELECTION, ORDER, 'b', 1)
    expect(first).toEqual({ selection: { anchor: 'b', ids: ['b', 'c'] }, focus: 'c' })
    const second = extend(first.selection, ORDER, first.focus, 1)
    expect(second.selection.ids).toEqual(['b', 'c', 'd'])
    expect(second.focus).toBe('d')
  })

  it('shrinks back when it goes the other way, and grows upwards past the anchor', () => {
    const down = extend(extend(NO_SELECTION, ORDER, 'b', 1).selection, ORDER, 'c', 1)
    const back = extend(down.selection, ORDER, 'd', -1)
    expect(back.selection.ids).toEqual(['b', 'c'])
    const one = extend(back.selection, ORDER, 'c', -1)
    expect(one.selection.ids).toEqual(['b'])
    const up = extend(one.selection, ORDER, 'b', -1)
    expect(up.selection).toEqual({ anchor: 'b', ids: ['a', 'b'] })
    expect(up.focus).toBe('a')
  })

  it('stays on the end row of the list and selects it', () => {
    expect(extend(NO_SELECTION, ORDER, 'e', 1)).toEqual({ selection: { anchor: 'e', ids: ['e'] }, focus: 'e' })
    expect(extend(NO_SELECTION, ORDER, 'a', -1).focus).toBe('a')
  })

  it('starts again from the focused row when the selection does not hold it', () => {
    const elsewhere = { anchor: 'a', ids: ['a', 'b'] }
    expect(extend(elsewhere, ORDER, 'd', 1).selection).toEqual({ anchor: 'd', ids: ['d', 'e'] })
  })

  it('leaves the selection alone for a row that is not in the list', () => {
    const selection = { anchor: 'a', ids: ['a', 'b'] }
    expect(extend(selection, ORDER, 'zzz', 1)).toEqual({ selection, focus: 'zzz' })
  })

  it('selects a range on Shift+click, from the anchor or from the row last focused', () => {
    expect(selectRange(NO_SELECTION, ORDER, 'd', 'b')).toEqual({ anchor: 'b', ids: ['b', 'c', 'd'] })
    const held = { anchor: 'c', ids: ['c', 'd'] }
    expect(selectRange(held, ORDER, 'a', 'e')).toEqual({ anchor: 'c', ids: ['a', 'b', 'c'] })
    expect(selectRange(NO_SELECTION, ORDER, 'd', null)).toEqual({ anchor: 'd', ids: ['d'] })
  })

  it('selects every row of the list', () => {
    expect(selectAll(ORDER).ids).toEqual(ORDER)
    expect(selectAll([])).toBe(NO_SELECTION)
  })

  it('lets a row that leaves the list drop out, and ends when none is left', () => {
    const selection = { anchor: 'b', ids: ['b', 'c', 'd'] }
    expect(prune(selection, ['a', 'b', 'd', 'e'])).toEqual({ anchor: 'b', ids: ['b', 'd'] })
    expect(prune(selection, ['a', 'c', 'e'])).toEqual({ anchor: 'c', ids: ['c'] })
    expect(prune(selection, ['a', 'e'])).toBe(NO_SELECTION)
    expect(prune(selection, ORDER)).toBe(selection)
  })

  it('acts on the rows together only from two, and only from a row in it', () => {
    const selection = { anchor: 'b', ids: ['b', 'c'] }
    expect(actsOnMany(selection, 'c')).toBe(true)
    expect(actsOnMany(selection, 'a')).toBe(false)
    expect(actsOnMany({ anchor: 'b', ids: ['b'] }, 'b')).toBe(false)
  })
})
