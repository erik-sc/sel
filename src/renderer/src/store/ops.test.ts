import { describe, expect, it } from 'vitest'
import type { Block, BlockType } from '../../../shared/types'
import { applyOpsToMap, type BlockMap } from './ops'

function block(id: string, type: BlockType, parentId: string | null, content: string[] = []): Block {
  return { id, type, parentId, content, props: {}, createdAt: 1, updatedAt: 1, trashedAt: null }
}

function fixture(): BlockMap {
  return {
    p: block('p', 'page', null, ['a', 'b', 'c']),
    a: block('a', 'text', 'p'),
    b: block('b', 'toggle', 'p', ['b1', 'sub']),
    b1: block('b1', 'text', 'b'),
    sub: block('sub', 'page', 'b', ['s1']),
    s1: block('s1', 'text', 'sub'),
    c: block('c', 'text', 'p'),
    q: block('q', 'page', null, [])
  }
}

describe('applyOpsToMap', () => {
  it('does not mutate the input map and keeps untouched blocks identical', () => {
    const map = fixture()
    const snapshot = JSON.stringify(map)
    const result = applyOpsToMap(map, [{ op: 'update', id: 'a', patch: { props: { checked: true } } }], 5)
    expect(JSON.stringify(map)).toBe(snapshot)
    expect(result.map.a).not.toBe(map.a)
    expect(result.map.c).toBe(map.c)
    expect(result.map.p).toBe(map.p)
  })

  it('create appends, prepends or inserts after a sibling', () => {
    const map = fixture()
    const result = applyOpsToMap(
      map,
      [
        { op: 'create', input: { id: 'n1', type: 'text', parentId: 'p' } },
        { op: 'create', input: { id: 'n2', type: 'text', parentId: 'p', afterId: null } },
        { op: 'create', input: { id: 'n3', type: 'text', parentId: 'p', afterId: 'a' } },
        { op: 'create', input: { id: 'n4', type: 'text', parentId: 'p', afterId: 'missing' } }
      ],
      9
    )
    expect(result.map.p.content).toEqual(['n2', 'a', 'n3', 'b', 'c', 'n1', 'n4'])
    expect(result.map.n1).toMatchObject({ parentId: 'p', content: [], createdAt: 9, trashedAt: null })
    expect(result.affected).toEqual(expect.arrayContaining(['p', 'n1', 'n2', 'n3', 'n4']))
  })

  it('create requires an id and tolerates a missing/null parent', () => {
    expect(() => applyOpsToMap({}, [{ op: 'create', input: { type: 'page', parentId: null } }])).toThrow()
    const result = applyOpsToMap({}, [
      { op: 'create', input: { id: 'r', type: 'page', parentId: null, props: { icon: 'x' } } },
      { op: 'create', input: { id: 'o', type: 'text', parentId: 'unknown' } }
    ])
    expect(result.map.r.props.icon).toBe('x')
    expect(result.map.o.parentId).toBe('unknown')
  })

  it('update merges props, removes null keys and changes type', () => {
    const map = fixture()
    map.a = { ...map.a, props: { title: [['hi']], color: 'red' } }
    const result = applyOpsToMap(map, [{ op: 'update', id: 'a', patch: { type: 'to_do', props: { color: null, checked: true } } }], 7)
    expect(result.map.a.type).toBe('to_do')
    expect(result.map.a.props).toEqual({ title: [['hi']], checked: true })
    expect(result.map.a.updatedAt).toBe(7)
    expect(applyOpsToMap(map, [{ op: 'update', id: 'nope', patch: {} }]).affected).toEqual([])
  })

  it('move re-parents and reorders', () => {
    const map = fixture()
    const result = applyOpsToMap(map, [
      { op: 'move', id: 'c', parentId: 'p', afterId: null },
      { op: 'move', id: 'a', parentId: 'b', afterId: 'b1' },
      { op: 'move', id: 'sub', parentId: null }
    ])
    expect(result.map.p.content).toEqual(['c', 'b'])
    expect(result.map.b.content).toEqual(['b1', 'a'])
    expect(result.map.a.parentId).toBe('b')
    expect(result.map.sub.parentId).toBeNull()
  })

  it('move rejects cycles', () => {
    const map = fixture()
    expect(() => applyOpsToMap(map, [{ op: 'move', id: 'b', parentId: 'sub' }])).toThrow()
    expect(() => applyOpsToMap(map, [{ op: 'move', id: 'b', parentId: 'b' }])).toThrow()
  })

  it('delete trashes pages and keeps them in place', () => {
    const result = applyOpsToMap(fixture(), [{ op: 'delete', id: 'sub' }], 42)
    expect(result.map.sub.trashedAt).toBe(42)
    expect(result.map.b.content).toEqual(['b1', 'sub'])
    expect(result.removed).toEqual([])
  })

  it('delete removes ordinary blocks with descendants but not nested pages', () => {
    const result = applyOpsToMap(fixture(), [{ op: 'delete', id: 'b' }])
    expect(result.map.b).toBeUndefined()
    expect(result.map.b1).toBeUndefined()
    expect(result.map.sub).toBeDefined()
    expect(result.map.s1).toBeDefined()
    expect(result.map.p.content).toEqual(['a', 'c'])
    expect(result.removed.sort()).toEqual(['b', 'b1'])
    expect(result.affected).toContain('p')
    expect(result.affected).not.toContain('b')
  })

  it('delete removes a linked database view for good and leaves its source alone', () => {
    const map: BlockMap = {
      ...fixture(),
      p: block('p', 'page', null, ['a', 'b', 'c', 'db', 'lv']),
      db: block('db', 'database', 'p', ['r1']),
      r1: block('r1', 'page', 'db'),
      lv: { ...block('lv', 'database', 'p'), props: { sourceId: 'db', views: [] } }
    }
    const result = applyOpsToMap(map, [{ op: 'delete', id: 'lv' }], 42)
    expect(result.map.lv).toBeUndefined()
    expect(result.removed).toEqual(['lv'])
    expect(result.map.p.content).toEqual(['a', 'b', 'c', 'db'])
    // The source and its rows are the very same objects: nothing about them changed.
    expect(result.map.db).toBe(map.db)
    expect(result.map.r1).toBe(map.r1)
    expect(result.affected).toEqual(['p'])
    // Deleting the source still sends it to the trash, in place.
    const trashed = applyOpsToMap(map, [{ op: 'delete', id: 'db' }], 42)
    expect(trashed.map.db.trashedAt).toBe(42)
    expect(trashed.map.lv).toBe(map.lv)
    expect(trashed.removed).toEqual([])
  })

  it('delete takes a nested linked view with the block that holds it', () => {
    const map: BlockMap = {
      ...fixture(),
      b: block('b', 'toggle', 'p', ['b1', 'sub', 'lv']),
      lv: { ...block('lv', 'database', 'b'), props: { sourceId: 'q', views: [] } }
    }
    const result = applyOpsToMap(map, [{ op: 'delete', id: 'b' }])
    expect(result.removed.sort()).toEqual(['b', 'b1', 'lv'])
    expect(result.map.sub).toBeDefined()
  })

  it('handles create followed by delete in the same batch', () => {
    const result = applyOpsToMap(fixture(), [
      { op: 'create', input: { id: 'tmp', type: 'text', parentId: 'q' } },
      { op: 'delete', id: 'tmp' }
    ])
    expect(result.map.tmp).toBeUndefined()
    expect(result.map.q.content).toEqual([])
  })

  it('treats ids named like Object.prototype members as plain, absent ids', () => {
    const map = fixture()
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const result = applyOpsToMap(map, [
        { op: 'update', id, patch: { props: { checked: true } } },
        { op: 'move', id, parentId: 'p' },
        { op: 'delete', id },
        { op: 'move', id: 'a', parentId: id }
      ])
      expect(result.removed).toEqual([])
      expect(Object.getPrototypeOf(result.map)).toBe(Object.prototype)
      expect(Object.keys(result.map).sort()).toEqual(Object.keys(map).sort())
    }
    // Creating a block called `constructor` is odd but harmless; `__proto__` would replace the map's prototype.
    const created = applyOpsToMap(map, [{ op: 'create', input: { id: 'constructor', type: 'text', parentId: 'p' } }])
    expect(Object.hasOwn(created.map, 'constructor')).toBe(true)
    expect(created.map.p.content).toContain('constructor')
    expect(() => applyOpsToMap(map, [{ op: 'create', input: { id: '__proto__', type: 'text', parentId: 'p' } }])).toThrow()
    expect(({} as Record<string, unknown>).type).toBeUndefined()
  })
})
