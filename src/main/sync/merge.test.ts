import { describe, expect, it } from 'vitest'
import {
  checkWorkspace,
  diffWorkspace,
  emptyWorkspace,
  isPageLike,
  mergeLists,
  mergeWorkspace,
  normalizeWorkspace,
  type SyncBlock,
  type Workspace
} from './merge'

// ------------------------------------------------------------------ helpers

type Props = Record<string, unknown>

/** A workspace under construction, and the edits a device makes to its copy. */
class Device {
  ws: Workspace
  constructor(
    from?: Workspace,
    public clock = 1000
  ) {
    this.ws = from ? clone(from) : emptyWorkspace()
  }

  private tick(): number {
    return ++this.clock
  }

  get(id: string): SyncBlock {
    const block = this.ws.blocks.get(id)
    if (!block) throw new Error(`no block ${id}`)
    return block
  }

  private list(parent: string | null): string[] {
    return parent === null ? this.ws.root : this.get(parent).content
  }

  private touch(id: string | null): void {
    if (id !== null) this.get(id).updatedAt = this.tick()
    else this.ws.rootAt = this.tick()
  }

  add(id: string, type: string, parent: string | null, props: Props = {}, index?: number): this {
    const now = this.tick()
    this.ws.blocks.set(id, { id, type, parentId: parent, content: [], props, createdAt: now, updatedAt: now, trashedAt: null })
    const list = this.list(parent)
    list.splice(index ?? list.length, 0, id)
    this.touch(parent)
    return this
  }

  page(id: string, parent: string | null = null, props: Props = {}): this {
    return this.add(id, 'page', parent, { title: [[id]], ...props })
  }

  text(id: string, parent: string, text = id, index?: number): this {
    return this.add(id, 'text', parent, { title: [[text]] }, index)
  }

  edit(id: string, patch: Props): this {
    const block = this.get(id)
    const props = { ...block.props }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete props[key]
      else props[key] = value
    }
    block.props = props
    block.updatedAt = this.tick()
    return this
  }

  retype(id: string, type: string): this {
    this.get(id).type = type
    this.get(id).updatedAt = this.tick()
    return this
  }

  move(id: string, parent: string | null, index?: number): this {
    const block = this.get(id)
    const from = this.list(block.parentId)
    from.splice(from.indexOf(id), 1)
    this.touch(block.parentId)
    block.parentId = parent
    block.updatedAt = this.tick()
    const to = this.list(parent)
    to.splice(index ?? to.length, 0, id)
    this.touch(parent)
    return this
  }

  reorder(parent: string | null, order: string[]): this {
    if (parent === null) {
      this.ws.root = [...order]
      this.ws.rootAt = this.tick()
    } else {
      this.get(parent).content = [...order]
      this.touch(parent)
    }
    return this
  }

  /** Removes a block and everything below it for good. */
  remove(id: string): this {
    const block = this.get(id)
    if (block.trashedAt === null) {
      const list = this.list(block.parentId)
      list.splice(list.indexOf(id), 1)
      if (block.parentId !== null) this.touch(block.parentId)
    }
    const drop = (x: string): void => {
      const b = this.ws.blocks.get(x)
      if (!b) return
      for (const child of b.content) drop(child)
      this.ws.blocks.delete(x)
    }
    drop(id)
    for (const b of this.ws.blocks.values()) if (b.trashedAt !== null && b.parentId !== null && !this.ws.blocks.has(b.parentId)) b.parentId = null
    return this
  }

  trash(id: string): this {
    const block = this.get(id)
    const list = this.list(block.parentId)
    list.splice(list.indexOf(id), 1)
    this.touch(block.parentId)
    block.trashedAt = block.updatedAt = this.tick()
    return this
  }

  restore(id: string): this {
    const block = this.get(id)
    const parent = block.parentId !== null && this.ws.blocks.has(block.parentId) ? block.parentId : null
    block.parentId = parent
    block.trashedAt = null
    block.updatedAt = this.tick()
    this.list(parent).push(id)
    this.touch(parent)
    return this
  }
}

function clone(ws: Workspace): Workspace {
  const blocks = new Map<string, SyncBlock>()
  for (const [id, b] of ws.blocks) blocks.set(id, { ...b, content: [...b.content], props: structuredClone(b.props) })
  return { blocks, root: [...ws.root], rootAt: ws.rootAt ?? 0 }
}

function text(ws: Workspace, id: string): unknown {
  return (ws.blocks.get(id)?.props['title'] as [string][] | undefined)?.[0]?.[0]
}

/** Merges, and checks on the way what must hold for every merge. */
function merge(base: Workspace, local: Workspace, remote: Workspace): ReturnType<typeof mergeWorkspace> {
  const out = mergeWorkspace(base, local, remote)
  expect(checkWorkspace(out.result)).toEqual([])
  // Same outcome whichever device does the merging.
  const mirrored = mergeWorkspace(base, remote, local)
  expect(describeDiff(out.result, mirrored.result)).toEqual([])
  // Merging the result again changes nothing.
  expect(describeDiff(out.result, mergeWorkspace(base, out.result, remote).result)).toEqual([])
  expect(describeDiff(out.result, mergeWorkspace(base, local, out.result).result)).toEqual([])
  expect(describeDiff(out.result, mergeWorkspace(remote, out.result, remote).result)).toEqual([])
  expect(mergeWorkspace(out.result, out.result, out.result).conflicts).toEqual([])
  return out
}

function sameWorkspace(a: Workspace, b: Workspace): boolean {
  const diff = diffWorkspace(a, b)
  return diff.put.length === 0 && diff.remove.length === 0 && !diff.rootChanged
}

function describeDiff(a: Workspace, b: Workspace): string[] {
  if (sameWorkspace(a, b)) return []
  const diff = diffWorkspace(a, b)
  const out = diff.put.map((block) => `${block.id}: ${JSON.stringify(a.blocks.get(block.id) ?? null)} -> ${JSON.stringify(block)}`)
  for (const id of diff.remove) out.push(`${id}: removed`)
  if (diff.rootChanged) out.push(`root: ${a.root.join(',')}@${a.rootAt} -> ${b.root.join(',')}@${b.rootAt}`)
  return out
}

/** A page with three paragraphs and a to-do, shared by two devices. */
function scene(): { base: Workspace; a: Device; b: Device } {
  const d = new Device()
  d.page('p').text('t1', 'p').text('t2', 'p').text('t3', 'p').add('todo', 'to_do', 'p', { title: [['buy milk']], checked: false })
  const base = clone(d.ws)
  // The devices' clocks interleave: A's edits are odd, B's are even and a little later.
  return { base, a: new Device(base, 2000), b: new Device(base, 3000) }
}

// -------------------------------------------------------------------- lists

describe('mergeLists', () => {
  const all = (): boolean => true
  it('keeps the order of the side that reordered and places the other side\'s additions by their neighbours', () => {
    expect(mergeLists(['a', 'b', 'c'], ['c', 'b', 'a'], ['a', 'x', 'b', 'c', 'y'], false, all)).toEqual(['c', 'y', 'b', 'a', 'x'])
    expect(mergeLists(['a', 'b', 'c'], ['a', 'x', 'b', 'c', 'y'], ['c', 'b', 'a'], true, all)).toEqual(['c', 'y', 'b', 'a', 'x'])
  })

  it('inserts additions of both sides and never repeats an id', () => {
    expect(mergeLists(['a', 'b'], ['a', 'x', 'b'], ['a', 'y', 'b'], true, all)).toEqual(['a', 'y', 'x', 'b'])
    expect(mergeLists(['a', 'b'], ['a', 'y', 'b'], ['a', 'x', 'b'], false, all)).toEqual(['a', 'y', 'x', 'b'])
    expect(mergeLists(['a'], ['a', 'a', 'x', 'x'], ['x', 'a'], true, all)).toEqual(['a', 'x'])
  })

  it('puts an addition at the very start before its following neighbour', () => {
    expect(mergeLists(['a', 'b'], ['a', 'b'], ['x', 'a', 'b'], true, all)).toEqual(['x', 'a', 'b'])
    expect(mergeLists([], [], ['x', 'y'], true, all)).toEqual(['x', 'y'])
  })

  it('leaves out what the caller does not keep', () => {
    expect(mergeLists(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'c'], true, (id) => id !== 'b')).toEqual(['a', 'c'])
  })
})

// ------------------------------------------------------------------- fields

describe('mergeWorkspace: fields', () => {
  it('returns the workspace unchanged when nobody changed anything', () => {
    const { base } = scene()
    const out = merge(base, clone(base), clone(base))
    expect(sameWorkspace(out.result, normalizeWorkspace(base))).toBe(true)
    expect(out.conflicts).toEqual([])
  })

  it('takes the side that changed a block', () => {
    const { base, a, b } = scene()
    a.edit('t1', { title: [['from A']] })
    b.edit('t2', { title: [['from B']] })
    const out = merge(base, a.ws, b.ws)
    expect(text(out.result, 't1')).toBe('from A')
    expect(text(out.result, 't2')).toBe('from B')
    expect(out.result.blocks.get('t1')?.updatedAt).toBe(a.get('t1').updatedAt)
    expect(out.result.blocks.get('t2')?.updatedAt).toBe(b.get('t2').updatedAt)
    expect(out.conflicts).toEqual([])
  })

  it('keeps both changes when the two sides changed different keys of one block', () => {
    const { base, a, b } = scene()
    a.edit('todo', { checked: true })
    b.edit('todo', { title: [['buy oat milk']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('todo')?.props).toEqual({ checked: true, title: [['buy oat milk']] })
    expect(out.result.blocks.get('todo')?.updatedAt).toBe(Math.max(a.get('todo').updatedAt, b.get('todo').updatedAt))
    expect(out.conflicts).toEqual([])
  })

  it('lets the later edit win when both changed the same key, and reports it', () => {
    const { base, a, b } = scene()
    a.edit('t1', { title: [['A says']] })
    b.edit('t1', { title: [['B says']] })
    const out = merge(base, a.ws, b.ws)
    expect(text(out.result, 't1')).toBe('B says')
    expect(out.conflicts).toEqual([{ blockId: 't1', field: 'props.title', winner: 'remote', localPage: 'p', remotePage: 'p' }])
    // Seen from the other device, the same block wins and it is the local one.
    expect(mergeWorkspace(base, b.ws, a.ws).conflicts[0]).toMatchObject({ winner: 'local' })
  })

  it('still keeps the untouched keys of the losing side in a same-key conflict', () => {
    const { base, a, b } = scene()
    a.edit('todo', { title: [['A text']], checked: true })
    b.edit('todo', { title: [['B text']], color: 'red' })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('todo')?.props).toEqual({ title: [['B text']], checked: true, color: 'red' })
    expect(out.conflicts.map((c) => c.field)).toEqual(['props.title'])
  })

  it('does not call it a conflict when both sides made the same change', () => {
    const { base, a, b } = scene()
    a.edit('t1', { title: [['same']] })
    b.edit('t1', { title: [['same']] })
    const out = merge(base, a.ws, b.ws)
    expect(text(out.result, 't1')).toBe('same')
    expect(out.conflicts).toEqual([])
  })

  it('breaks a tie between equal clocks the same way on both devices', () => {
    const { base } = scene()
    const a = new Device(base, 5000)
    const b = new Device(base, 5000)
    a.edit('t1', { title: [['alpha']] })
    b.edit('t1', { title: [['beta']] })
    const one = merge(base, a.ws, b.ws)
    const two = merge(base, b.ws, a.ws)
    expect(text(one.result, 't1')).toBe(text(two.result, 't1'))
    expect(one.conflicts[0].winner).not.toBe(two.conflicts[0].winner)
  })

  it('merges a removed key against an untouched one, and a type change against a text change', () => {
    const { base, a, b } = scene()
    a.edit('todo', { checked: null })
    a.retype('t2', 'heading_1')
    b.edit('t2', { title: [['bigger']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('todo')?.props).toEqual({ title: [['buy milk']] })
    expect(out.result.blocks.get('t2')).toMatchObject({ type: 'heading_1', props: { title: [['bigger']] } })
    expect(out.conflicts).toEqual([])
  })

  it('resolves two different type changes by the later one', () => {
    const { base, a, b } = scene()
    a.retype('t1', 'quote')
    b.retype('t1', 'callout')
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('t1')?.type).toBe('callout')
    expect(out.conflicts.map((c) => c.field)).toEqual(['type'])
  })
})

// -------------------------------------------------------- deleting, editing

describe('mergeWorkspace: delete against edit', () => {
  it('deletes what one side deleted and the other left alone', () => {
    const { base, a, b } = scene()
    a.remove('t2')
    b.edit('t1', { title: [['x']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.has('t2')).toBe(false)
    expect(out.result.blocks.get('p')?.content).toEqual(['t1', 't3', 'todo'])
  })

  it('keeps a block one side deleted when the other side edited it (remote edit)', () => {
    const { base, a, b } = scene()
    a.remove('t2')
    b.edit('t2', { title: [['still needed']] })
    const out = merge(base, a.ws, b.ws)
    expect(text(out.result, 't2')).toBe('still needed')
    expect(out.result.blocks.get('p')?.content).toEqual(['t1', 't2', 't3', 'todo'])
    expect(out.stats.kept).toBe(1)
    expect(out.conflicts).toEqual([])
  })

  it('keeps a block one side deleted when the other side edited it (local edit)', () => {
    const { base, a, b } = scene()
    a.edit('t2', { title: [['still needed']] })
    b.remove('t2')
    const out = merge(base, a.ws, b.ws)
    expect(text(out.result, 't2')).toBe('still needed')
    expect(out.result.blocks.get('p')?.content).toEqual(['t1', 't2', 't3', 'todo'])
  })

  it('forgets a block both sides deleted', () => {
    const { base, a, b } = scene()
    a.remove('t2')
    b.remove('t2')
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.has('t2')).toBe(false)
  })

  it('moves an edited block to the end of its page when its parent block was deleted', () => {
    const d = new Device()
    d.page('p').add('toggle', 'toggle', 'p').text('in1', 'toggle').text('in2', 'toggle').text('after', 'p')
    const base = clone(d.ws)
    const a = new Device(base, 2000)
    const b = new Device(base, 3000)
    a.remove('toggle')
    b.edit('in2', { title: [['edited inside']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.has('toggle')).toBe(false)
    expect(out.result.blocks.has('in1')).toBe(false)
    expect(out.result.blocks.get('p')?.content).toEqual(['after', 'in2'])
    expect(out.result.blocks.get('in2')?.parentId).toBe('p')
    expect(out.stats.reattached).toBe(1)
  })

  it('brings a page back when it was deleted for good on one side and a block in it was edited on the other', () => {
    const d = new Device()
    d.page('home').page('sub', 'home').text('s1', 'sub').text('s2', 'sub').text('h1', 'home')
    const base = clone(d.ws)
    const a = new Device(base, 2000)
    const b = new Device(base, 3000)
    a.remove('sub')
    b.edit('s2', { title: [['important']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('sub')).toMatchObject({ parentId: 'home', content: ['s2'], trashedAt: null })
    expect(out.result.blocks.get('home')?.content).toEqual(['sub', 'h1'])
    expect(out.result.blocks.has('s1')).toBe(false)
    expect(out.stats.resurrected).toBe(1)
  })

  it('brings a root page back to the root for a block that was added to it on the other side', () => {
    const d = new Device()
    d.page('one').page('two').text('x', 'two')
    const base = clone(d.ws)
    const a = new Device(base, 2000)
    const b = new Device(base, 3000)
    a.remove('two')
    b.text('fresh', 'two')
    const out = merge(base, a.ws, b.ws)
    expect(out.result.root).toEqual(['one', 'two'])
    expect(out.result.blocks.get('two')?.content).toEqual(['fresh'])
  })

  it('keeps a row whose database was deleted on the other side, as a page of the page above', () => {
    const d = new Device()
    d.page('home').add('db', 'database', 'home', { schema: { title: { id: 'title', name: 'Name', type: 'title' } }, views: [] }).page('row1', 'db').page('row2', 'db')
    const base = clone(d.ws)
    const a = new Device(base, 2000)
    const b = new Device(base, 3000)
    a.remove('db')
    b.edit('row2', { values: { status: 'done' } })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.has('db')).toBe(false)
    expect(out.result.blocks.get('row2')).toMatchObject({ parentId: 'home' })
    expect(out.result.blocks.get('home')?.content).toEqual(['row2'])
  })
})

// ---------------------------------------------------------------- structure

describe('mergeWorkspace: structure', () => {
  it('inserts blocks both sides added between the same two siblings', () => {
    const { base, a, b } = scene()
    a.text('a1', 'p', 'a1', 1).text('a2', 'p', 'a2', 2)
    b.text('b1', 'p', 'b1', 1)
    const out = merge(base, a.ws, b.ws)
    const content = out.result.blocks.get('p')?.content ?? []
    expect([...content].sort()).toEqual(['a1', 'a2', 'b1', 't1', 't2', 't3', 'todo'])
    expect(content.indexOf('a1')).toBeLessThan(content.indexOf('a2'))
    expect(content[0]).toBe('t1')
    expect(content.slice(-3)).toEqual(['t2', 't3', 'todo'])
  })

  it('keeps a reorder and adds what the other side added', () => {
    const { base, a, b } = scene()
    a.reorder('p', ['todo', 't3', 't2', 't1'])
    b.text('new', 'p', 'new', 1)
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('p')?.content).toEqual(['todo', 't3', 't2', 't1', 'new'])
  })

  it('settles two different reorders on the later one', () => {
    const { base, a, b } = scene()
    a.reorder('p', ['t3', 't2', 't1', 'todo'])
    b.reorder('p', ['todo', 't1', 't2', 't3'])
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('p')?.content).toEqual(['todo', 't1', 't2', 't3'])
  })

  it('follows a move made on one side', () => {
    const d = new Device()
    d.page('p').page('q').text('x', 'p').text('y', 'p')
    const base = clone(d.ws)
    const a = new Device(base, 2000)
    const b = new Device(base, 3000)
    a.move('x', 'q')
    b.edit('x', { title: [['moved and edited']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('x')).toMatchObject({ parentId: 'q', props: { title: [['moved and edited']] } })
    expect(out.result.blocks.get('p')?.content).toEqual(['y'])
    expect(out.result.blocks.get('q')?.content).toEqual(['x'])
  })

  it('puts a block moved to two different places where the later move put it, once', () => {
    const d = new Device()
    d.page('p').page('q').page('r').text('x', 'p')
    const base = clone(d.ws)
    const a = new Device(base, 2000)
    const b = new Device(base, 3000)
    a.move('x', 'q')
    b.move('x', 'r')
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('x')?.parentId).toBe('r')
    expect(out.result.blocks.get('q')?.content).toEqual([])
    expect(out.result.blocks.get('r')?.content).toEqual(['x'])
    expect(out.result.blocks.get('p')?.content).toEqual([])
  })

  it('keeps a block that was moved into a parent the other side deleted, under the page', () => {
    const d = new Device()
    d.page('p').add('toggle', 'toggle', 'p').text('inside', 'toggle').text('x', 'p').text('z', 'p')
    const base = clone(d.ws)
    const a = new Device(base, 2000)
    const b = new Device(base, 3000)
    a.move('x', 'toggle')
    b.remove('toggle')
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.has('toggle')).toBe(false)
    // Where the deleting side still had it.
    expect(out.result.blocks.get('x')?.parentId).toBe('p')
    expect(out.result.blocks.get('p')?.content).toEqual(['x', 'z'])
  })

  it('keeps a sub-page that was moved into a page the other side deleted for good', () => {
    const d = new Device()
    d.page('home').page('target', 'home').page('sub', 'home')
    const base = clone(d.ws)
    const a = new Device(base, 2000)
    const b = new Device(base, 3000)
    a.move('sub', 'target')
    b.remove('target')
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('sub')?.parentId).toBe('home')
    expect(out.result.blocks.get('home')?.content).toEqual(['sub'])
  })

  it('breaks the cycle when each side moved a page into the other', () => {
    const d = new Device()
    d.page('a').page('b')
    const base = clone(d.ws)
    const one = new Device(base, 2000)
    const two = new Device(base, 3000)
    one.move('a', 'b')
    two.move('b', 'a')
    const out = merge(base, one.ws, two.ws)
    // The later move stands: b is inside a, and a is back at the root.
    expect(out.result.root).toEqual(['a'])
    expect(out.result.blocks.get('a')?.content).toEqual(['b'])
    expect(out.result.blocks.get('b')?.content).toEqual([])
    expect(out.stats.cyclesBroken).toBe(1)
  })

  it('breaks a cycle among ordinary blocks inside a page', () => {
    const d = new Device()
    d.page('p').add('t1', 'toggle', 'p').add('t2', 'toggle', 'p').text('leaf', 't2')
    const base = clone(d.ws)
    const one = new Device(base, 2000)
    const two = new Device(base, 3000)
    one.move('t1', 't2')
    two.move('t2', 't1')
    const out = merge(base, one.ws, two.ws)
    expect(out.result.blocks.size).toBe(4)
    expect(out.result.blocks.get('t1')?.parentId).toBe('p')
    expect(out.result.blocks.get('t2')?.parentId).toBe('t1')
  })

  it('merges the order of the workspace root', () => {
    const d = new Device()
    d.page('one').page('two').page('three')
    const base = clone(d.ws)
    const a = new Device(base, 2000)
    const b = new Device(base, 3000)
    a.reorder(null, ['three', 'two', 'one'])
    b.page('four')
    b.move('four', null, 0)
    const out = merge(base, a.ws, b.ws)
    // A's order stands; B's new page sits before the page it preceded there.
    expect(out.result.root).toEqual(['three', 'two', 'four', 'one'])
  })

  it('makes a union of two workspaces that share nothing (first sync)', () => {
    const a = new Device(undefined, 2000)
    a.page('mine').text('m1', 'mine')
    const b = new Device(undefined, 3000)
    b.page('theirs').text('r1', 'theirs').page('theirs2')
    const out = merge(emptyWorkspace(), a.ws, b.ws)
    expect([...out.result.root].sort()).toEqual(['mine', 'theirs', 'theirs2'])
    expect(out.result.blocks.size).toBe(5)
    expect(out.conflicts).toEqual([])
  })

  it('merges two copies that share ids without a base (reconnecting a device)', () => {
    const { base, a, b } = scene()
    a.edit('t1', { title: [['A']] })
    b.text('extra', 'p')
    const out = merge(emptyWorkspace(), a.ws, b.ws)
    expect(out.result.blocks.size).toBe(base.blocks.size + 1)
    expect(text(out.result, 't1')).toBe('A')
    expect(out.result.blocks.get('p')?.content).toContain('extra')
  })
})

// -------------------------------------------------------------------- trash

describe('mergeWorkspace: trash', () => {
  const pages = (): { base: Workspace; a: Device; b: Device } => {
    const d = new Device()
    d.page('home').page('sub', 'home').text('s1', 'sub').text('h1', 'home')
    const base = clone(d.ws)
    return { base, a: new Device(base, 2000), b: new Device(base, 3000) }
  }

  it('trashes a page on both devices and keeps what the other side wrote in it', () => {
    const { base, a, b } = pages()
    a.trash('sub')
    b.edit('s1', { title: [['late edit']] }).text('s2', 'sub')
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('sub')).toMatchObject({ trashedAt: a.get('sub').trashedAt, parentId: 'home', content: ['s1', 's2'] })
    expect(out.result.blocks.get('home')?.content).toEqual(['h1'])
    expect(text(out.result, 's1')).toBe('late edit')
  })

  it('restores a page on both devices', () => {
    const { base: before, a: setup } = pages()
    setup.trash('sub')
    void before
    const base = clone(setup.ws)
    const a = new Device(base, 4000)
    const b = new Device(base, 5000)
    a.restore('sub')
    b.edit('h1', { title: [['x']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('sub')).toMatchObject({ trashedAt: null, parentId: 'home' })
    expect(out.result.blocks.get('home')?.content).toEqual(['h1', 'sub'])
  })

  it('lets the later device win when one restored a page and the other deleted it for good', () => {
    const { a: setup } = pages()
    setup.trash('sub')
    const base = clone(setup.ws)
    const a = new Device(base, 4000)
    const b = new Device(base, 5000)
    a.restore('sub')
    b.remove('sub')
    const out = merge(base, a.ws, b.ws)
    // Restoring changed the page, so the deletion does not take it.
    expect(out.result.blocks.get('sub')).toMatchObject({ trashedAt: null, parentId: 'home' })
    expect(out.result.blocks.get('s1')).toBeUndefined()
  })

  it('reports a page trashed on one side and trashed-then-restored state changed on the other as a trash conflict', () => {
    const { a: setup } = pages()
    setup.trash('sub')
    const base = clone(setup.ws)
    const a = new Device(base, 4000)
    const b = new Device(base, 5000)
    a.restore('sub')
    // B trashes it again at another moment: the field changed on both sides.
    b.get('sub').trashedAt = 5001
    b.get('sub').updatedAt = 5001
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('sub')?.trashedAt).toBe(5001)
    expect(out.conflicts.map((c) => c.field)).toEqual(['trashed'])
    expect(out.result.blocks.get('home')?.content).toEqual(['h1'])
  })

  it('keeps one trash date when both devices trashed the page', () => {
    const { base, a, b } = pages()
    a.trash('sub')
    b.trash('sub')
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('sub')?.trashedAt).toBe(b.get('sub').trashedAt)
    expect(out.conflicts).toEqual([])
  })

  it('forgets where a trashed page was once that parent is gone', () => {
    const { base, a, b } = pages()
    a.trash('sub')
    b.remove('home')
    const out = merge(base, a.ws, b.ws)
    // `sub` changed (it went to the trash), so it survives the deletion of its parent.
    expect(out.result.blocks.get('sub')).toMatchObject({ parentId: null })
    expect(out.result.blocks.get('sub')?.trashedAt).not.toBeNull()
    expect(out.result.blocks.has('home')).toBe(false)
    expect(out.result.root).toEqual([])
  })
})

// ---------------------------------------------------------------- databases

describe('mergeWorkspace: databases', () => {
  const view = (id: string, extra: Props = {}): Props => ({ id, name: id, type: 'table', visibleProperties: ['title', 'status'], filters: [], sorts: [], ...extra })
  const db = (): { base: Workspace; a: Device; b: Device } => {
    const d = new Device()
    d.page('home')
      .add('db', 'database', 'home', {
        title: [['Tasks']],
        schema: {
          title: { id: 'title', name: 'Name', type: 'title' },
          status: { id: 'status', name: 'Status', type: 'select', options: [{ id: 'o1', name: 'Todo', color: 'gray' }] },
          due: { id: 'due', name: 'Due', type: 'date' }
        },
        views: [view('v1'), view('v2', { type: 'chart', chart: { kind: 'bar', x: 'status', y: { aggregate: 'count' }, showLegend: true } })]
      })
      .page('row1', 'db', { values: { status: 'o1', due: { start: '2026-01-01' } } })
      .page('row2', 'db', { values: {} })
      .add('linked', 'database', 'home', { sourceId: 'db', views: [view('lv1')] })
    const base = clone(d.ws)
    return { base, a: new Device(base, 2000), b: new Device(base, 3000) }
  }
  const schema = (ws: Workspace): Record<string, Props> => ws.blocks.get('db')?.props['schema'] as Record<string, Props>
  const views = (ws: Workspace, id = 'db'): Props[] => ws.blocks.get(id)?.props['views'] as Props[]

  it('merges row values per property', () => {
    const { base, a, b } = db()
    a.edit('row1', { values: { status: 'o1', due: { start: '2026-02-02' } } })
    b.edit('row1', { values: { status: 'o2', due: { start: '2026-01-01' } } })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('row1')?.props['values']).toEqual({ status: 'o2', due: { start: '2026-02-02' } })
    expect(out.conflicts).toEqual([])
  })

  it('reports a conflict only for the property both changed, and never mixes the halves of a date', () => {
    const { base, a, b } = db()
    a.edit('row1', { values: { status: 'a', due: { start: '2026-03-01', end: '2026-03-05' } } })
    b.edit('row1', { values: { status: 'o1', due: { start: '2026-04-01' } }, title: [['renamed']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('row1')?.props).toEqual({ title: [['renamed']], values: { status: 'a', due: { start: '2026-04-01' } } })
    expect(out.conflicts.map((c) => c.field)).toEqual(['props.values.due'])
  })

  it('merges a value set on one side against one cleared on the other', () => {
    const { base, a, b } = db()
    a.edit('row2', { values: { status: 'o1' } })
    b.edit('row1', { values: { due: { start: '2026-01-01' } } })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('row2')?.props['values']).toEqual({ status: 'o1' })
    expect(out.result.blocks.get('row1')?.props['values']).toEqual({ due: { start: '2026-01-01' } })
  })

  it('merges relation links as a set, so both halves of a two-way relation keep every link', () => {
    const { a } = db()
    a.edit('row1', { values: { status: 'o1', due: { start: '2026-01-01' }, project: ['p1'] } })
    const both = clone(a.ws)
    const left = new Device(both, 4000)
    const right = new Device(both, 5000)
    // One device links row1 to p2 and unlinks p1; the other links it to p3.
    left.edit('row1', { values: { status: 'o1', due: { start: '2026-01-01' }, project: ['p2'] } })
    right.edit('row1', { values: { status: 'o1', due: { start: '2026-01-01' }, project: ['p1', 'p3'] } })
    const out = merge(both, left.ws, right.ws)
    expect([...((out.result.blocks.get('row1')?.props['values'] as Props)['project'] as string[])].sort()).toEqual(['p2', 'p3'])
    expect(out.conflicts).toEqual([])
    // Swapping the sides gives the same links.
    expect([...((merge(both, right.ws, left.ws).result.blocks.get('row1')?.props['values'] as Props)['project'] as string[])].sort()).toEqual(['p2', 'p3'])
    // Cleared on one side while the other added a link: the added link stays.
    const cleared = new Device(both, 6000).edit('row1', { values: { status: 'o1', due: { start: '2026-01-01' } } })
    const added = new Device(both, 7000).edit('row1', { values: { status: 'o1', due: { start: '2026-01-01' }, project: ['p1', 'p4'] } })
    expect((merge(both, cleared.ws, added.ws).result.blocks.get('row1')?.props['values'] as Props)['project']).toEqual(['p4'])
    // Both removed every link: the cell is gone rather than an empty list.
    const none1 = new Device(both, 8000).edit('row1', { values: { status: 'o1', due: { start: '2026-01-01' }, project: [] } })
    const none2 = new Device(both, 9000).edit('row1', { values: { status: 'o1', due: { start: '2026-01-01' } } })
    expect(merge(both, none1.ws, none2.ws).result.blocks.get('row1')?.props['values']).toEqual({ status: 'o1', due: { start: '2026-01-01' } })
  })

  it('merges the schema per property, keeping the order of the properties', () => {
    const { base, a, b } = db()
    const s = base.blocks.get('db')?.props['schema'] as Record<string, Props>
    a.edit('db', { schema: { title: s['title'], status: { ...s['status'], name: 'State' }, due: s['due'], notes: { id: 'notes', name: 'Notes', type: 'text' } } })
    b.edit('db', { schema: { title: s['title'], due: { ...s['due'], name: 'Deadline' }, status: s['status'], price: { id: 'price', name: 'Price', type: 'number' } } })
    const out = merge(base, a.ws, b.ws)
    const merged = schema(out.result)
    // B's order stands; A's new property follows the one it followed there.
    expect(Object.keys(merged)).toEqual(['title', 'due', 'notes', 'status', 'price'])
    expect(merged['status']['name']).toBe('State')
    expect(merged['due']['name']).toBe('Deadline')
    expect(out.conflicts).toEqual([])
  })

  it('merges a formula as one value, apart from a rename of the property it reads', () => {
    const d = db()
    const s = d.base.blocks.get('db')?.props['schema'] as Record<string, Props>
    const withFormula: Record<string, Props> = { ...s, total: { id: 'total', name: 'Total', type: 'formula', formula: { expression: 'dateAdd(prop("due"), 1, "days")' } } }
    const start = new Device(d.base, 1500).edit('db', { schema: withFormula }).ws
    // One device renames the date the formula reads (references are ids: the formula is untouched), the other edits the formula.
    const a = new Device(start, 2000).edit('db', { schema: { ...withFormula, due: { ...withFormula.due, name: 'Deadline' } } })
    const b = new Device(start, 3000).edit('db', {
      schema: { ...withFormula, total: { ...withFormula.total, formula: { expression: 'dateAdd(prop("due"), 2, "days")' } } }
    })
    const out = merge(start, a.ws, b.ws)
    expect(schema(out.result)['due']['name']).toBe('Deadline')
    expect(schema(out.result)['total']['formula']).toEqual({ expression: 'dateAdd(prop("due"), 2, "days")' })
    expect(out.conflicts).toEqual([])
    // Both edit the formula: the later edit wins whole, never a mix of the two texts.
    const c = new Device(start, 4000).edit('db', { schema: { ...withFormula, total: { ...withFormula.total, formula: { expression: '1' } } } })
    const e = new Device(start, 5000).edit('db', { schema: { ...withFormula, total: { ...withFormula.total, formula: { expression: '2' } } } })
    const both = merge(start, c.ws, e.ws)
    expect(schema(both.result)['total']['formula']).toEqual({ expression: '2' })
    expect(both.conflicts.map((conflict) => conflict.field)).toEqual(['props.schema.total.formula'])
  })

  it('merges select options added on both sides and a rename against a new option', () => {
    const { base, a, b } = db()
    const s = base.blocks.get('db')?.props['schema'] as Record<string, Props>
    const o1 = { id: 'o1', name: 'Todo', color: 'gray' }
    a.edit('db', { schema: { ...s, status: { ...s['status'], options: [{ ...o1, name: 'To do' }, { id: 'oa', name: 'Doing', color: 'blue' }] } } })
    b.edit('db', { schema: { ...s, status: { ...s['status'], options: [{ ...o1, color: 'red' }, { id: 'ob', name: 'Done', color: 'green' }] } } })
    const out = merge(base, a.ws, b.ws)
    const options = schema(out.result)['status']['options'] as Props[]
    expect(options.map((o) => o['id']).sort()).toEqual(['o1', 'oa', 'ob'])
    expect(options.find((o) => o['id'] === 'o1')).toEqual({ id: 'o1', name: 'To do', color: 'red' })
    expect(out.conflicts).toEqual([])
  })

  it('keeps a property one side deleted when the other side changed it, and deletes it otherwise', () => {
    const { base, a, b } = db()
    const s = base.blocks.get('db')?.props['schema'] as Record<string, Props>
    a.edit('db', { schema: { title: s['title'] } })
    b.edit('db', { schema: { ...s, due: { ...s['due'], name: 'When' } } })
    const out = merge(base, a.ws, b.ws)
    expect(Object.keys(schema(out.result))).toEqual(['title', 'due'])
    expect(schema(out.result)['due']['name']).toBe('When')
  })

  it('merges views per id: a new view on each side, a rename, and a deleted view', () => {
    const { base, a, b } = db()
    const v = base.blocks.get('db')?.props['views'] as Props[]
    a.edit('db', { views: [{ ...v[0], name: 'All tasks' }, v[1], view('va')] })
    b.edit('db', { views: [v[0], view('vb')] })
    const out = merge(base, a.ws, b.ws)
    expect(views(out.result).map((x) => x['id'])).toEqual(['v1', 'va', 'vb'])
    expect(views(out.result)[0]['name']).toBe('All tasks')
    expect(out.conflicts).toEqual([])
  })

  it('merges a chart configuration key by key', () => {
    const { base, a, b } = db()
    const v = base.blocks.get('db')?.props['views'] as Props[]
    const chart = v[1]['chart'] as Props
    a.edit('db', { views: [v[0], { ...v[1], chart: { ...chart, kind: 'line', y: { aggregate: 'sum', property: 'price' } } }] })
    b.edit('db', { views: [v[0], { ...v[1], chart: { ...chart, showLegend: false, y: { aggregate: 'count' }, stacked: true } }] })
    const out = merge(base, a.ws, b.ws)
    expect(views(out.result)[1]['chart']).toEqual({ kind: 'line', x: 'status', y: { aggregate: 'sum', property: 'price' }, showLegend: false, stacked: true })
    expect(out.conflicts).toEqual([])
  })

  it('merges the figures of a calculations view per id', () => {
    const { base } = db()
    const v = base.blocks.get('db')?.props['views'] as Props[]
    const calcView = (calcs: Props[]): Props => ({ ...v[1], type: 'calc', calcs })
    const total = { id: 'c1', name: 'Total', formula: 'count()' }
    const first = new Device(base)
    first.edit('db', { views: [v[0], calcView([total])] })
    const start = first.ws
    const a = new Device(start, 2000)
    const b = new Device(start, 3000)
    a.edit('db', { views: [v[0], calcView([{ ...total, name: 'Rows' }, { id: 'ca', name: 'A', formula: '1' }])] })
    b.edit('db', { views: [v[0], calcView([{ ...total, formula: 'count(Status)' }, { id: 'cb', name: 'B', formula: '2' }])] })
    const out = merge(start, a.ws, b.ws)
    const calcs = views(out.result)[1]['calcs'] as Props[]
    expect(calcs.map((c) => c['id']).sort()).toEqual(['c1', 'ca', 'cb'])
    expect(calcs.find((c) => c['id'] === 'c1')).toEqual({ id: 'c1', name: 'Rows', formula: 'count(Status)' })
    expect(out.conflicts).toEqual([])
  })

  it('reports a chart key both changed, and merges visible columns and widths', () => {
    const { base, a, b } = db()
    const v = base.blocks.get('db')?.props['views'] as Props[]
    a.edit('db', { views: [{ ...v[0], visibleProperties: ['status', 'title', 'due'], propertyWidths: { title: 300 } }, { ...v[1], chart: { ...(v[1]['chart'] as Props), kind: 'pie' } }] })
    b.edit('db', { views: [{ ...v[0], visibleProperties: ['title'], propertyWidths: { status: 120 } }, { ...v[1], chart: { ...(v[1]['chart'] as Props), kind: 'donut' } }] })
    const out = merge(base, a.ws, b.ws)
    expect(views(out.result)[0]['visibleProperties']).toEqual(['title', 'due'])
    expect(views(out.result)[0]['propertyWidths']).toEqual({ title: 300, status: 120 })
    expect((views(out.result)[1]['chart'] as Props)['kind']).toBe('donut')
    expect(out.conflicts.map((c) => c.field)).toEqual(['props.views[v2].chart.kind'])
  })

  it('merges the views of a linked view and keeps what it points at', () => {
    const { base, a, b } = db()
    const v = base.blocks.get('linked')?.props['views'] as Props[]
    a.edit('linked', { views: [{ ...v[0], name: 'Mine' }] })
    b.edit('linked', { title: [['Tasks here']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.get('linked')?.props).toMatchObject({ sourceId: 'db', title: [['Tasks here']] })
    expect(views(out.result, 'linked')[0]['name']).toBe('Mine')
    expect(out.result.blocks.get('linked')?.content).toEqual([])
  })

  it('keeps a linked view whose source the other side deleted for good', () => {
    const { base, a, b } = db()
    a.remove('db')
    b.edit('linked', { title: [['Still here']] })
    const out = merge(base, a.ws, b.ws)
    expect(out.result.blocks.has('db')).toBe(false)
    expect(out.result.blocks.get('linked')?.props['sourceId']).toBe('db')
  })

  it('adds rows from both sides and never puts an ordinary block among the rows', () => {
    const { base, a, b } = db()
    a.page('rowA', 'db')
    b.page('rowB', 'db')
    b.remove('row1')
    a.text('note', 'row1')
    const out = merge(base, a.ws, b.ws)
    const rows = out.result.blocks.get('db')?.content ?? []
    expect([...rows].sort()).toEqual(['row1', 'row2', 'rowA', 'rowB'])
    for (const id of rows) expect(out.result.blocks.get(id)?.type).toBe('page')
    expect(out.result.blocks.get('note')?.parentId).toBe('row1')
  })
})

// ----------------------------------------------------------- several devices

describe('mergeWorkspace: three devices in sequence', () => {
  it('converges when three devices take turns syncing through one remote', () => {
    const { base } = scene()
    let remote = clone(base)
    const devices = [new Device(base, 10_000), new Device(base, 20_000), new Device(base, 30_000)]
    const bases = [clone(base), clone(base), clone(base)]
    const sync = (i: number): void => {
      const out = merge(bases[i], devices[i].ws, remote)
      devices[i].ws = clone(out.result)
      remote = clone(out.result)
      bases[i] = clone(out.result)
    }
    devices[0].edit('t1', { title: [['zero']] }).text('n0', 'p')
    devices[1].edit('t1', { title: [['one']] }).remove('t3')
    devices[2].edit('todo', { checked: true }).move('t2', 'p', 0)
    sync(0)
    sync(1)
    sync(2)
    devices[0].edit('t3', { title: [['kept by zero']] })
    sync(0)
    sync(1)
    sync(2)
    sync(0)
    sync(1)
    for (const device of devices) expect(describeDiff(device.ws, remote)).toEqual([])
    expect(text(remote, 't1')).toBe('one')
    expect(text(remote, 't3')).toBe('kept by zero')
    expect(remote.blocks.get('todo')?.props['checked']).toBe(true)
    expect(remote.blocks.get('p')?.content[0]).toBe('t2')
    expect(remote.blocks.has('n0')).toBe(true)
  })
})

// --------------------------------------------------------------- randomised

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KEYS = ['title', 'checked', 'color', 'icon']

/** Makes `count` random edits a user could make, keeping the copy a valid tree. */
function randomEdits(device: Device, rand: () => number, count: number, tag: string): { added: string[]; edited: string[] } {
  const added: string[] = []
  const edited: string[] = []
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]
  const liveIds = (): string[] => {
    // What a user can reach: not inside the trash.
    const out: string[] = []
    const walk = (ids: string[]): void => {
      for (const id of ids) {
        out.push(id)
        walk(device.get(id).content)
      }
    }
    walk(device.ws.root)
    return out
  }
  const isUnder = (id: string, ancestor: string): boolean => {
    let cur: string | null = id
    while (cur !== null) {
      if (cur === ancestor) return true
      cur = device.get(cur).parentId
    }
    return false
  }
  let serial = 0
  for (let i = 0; i < count; i++) {
    const ids = liveIds()
    const roll = rand()
    if (!ids.length || roll < 0.2) {
      const id = `${tag}${serial++}`
      const asPage = !ids.length || rand() < 0.3
      const parents = ids.filter((x) => device.get(x).type !== 'database')
      const parent = asPage && (rand() < 0.3 || !parents.length) ? null : pick(parents)
      if (parent === null) device.page(id)
      else {
        const list = device.get(parent).content
        device.add(id, asPage ? 'page' : pick(['text', 'toggle', 'to_do']), parent, { title: [[id]] }, Math.floor(rand() * (list.length + 1)))
      }
      added.push(id)
    } else if (roll < 0.5) {
      const id = pick(ids)
      const key = pick(KEYS)
      device.edit(id, { [key]: rand() < 0.15 ? null : key === 'title' ? [[`${tag}-${i}`]] : `${tag}${Math.floor(rand() * 3)}` })
      edited.push(id)
    } else if (roll < 0.65) {
      const id = pick(ids)
      const block = device.get(id)
      const targets = ids.filter((x) => !isUnder(x, id) && device.get(x).type !== 'database')
      const parent = isPageLike(block.type) && rand() < 0.25 ? null : targets.length ? pick(targets) : null
      if (parent === null && !isPageLike(block.type)) continue
      const size = parent === null ? device.ws.root.length : device.get(parent).content.length
      device.move(id, parent, Math.floor(rand() * (size + 1)))
    } else if (roll < 0.78) {
      device.remove(pick(ids))
    } else if (roll < 0.86) {
      const pagesLive = ids.filter((x) => isPageLike(device.get(x).type))
      if (pagesLive.length) device.trash(pick(pagesLive))
    } else if (roll < 0.92) {
      const bin = [...device.ws.blocks.values()].filter((b) => b.trashedAt !== null)
      if (bin.length) {
        const page = pick(bin)
        // Like the app: back where it was when that is still alive, at the root otherwise.
        const parentAlive = page.parentId !== null && liveIds().includes(page.parentId)
        if (!parentAlive) page.parentId = null
        device.restore(page.id)
      }
    } else {
      const parents: (string | null)[] = [null, ...ids.filter((x) => device.get(x).content.length > 1)]
      const parent = pick(parents)
      const list = [...(parent === null ? device.ws.root : device.get(parent).content)]
      for (let k = list.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1))
        ;[list[k], list[j]] = [list[j], list[k]]
      }
      device.reorder(parent, list)
    }
  }
  return { added, edited }
}

function randomBase(rand: () => number, size: number): Workspace {
  const device = new Device(undefined, 100)
  randomEdits(device, () => rand() * 0.5, size, 'b')
  return normalizeWorkspace(device.ws)
}

describe('mergeWorkspace: randomised', () => {
  it('keeps every invariant over many random pairs of edit sessions', () => {
    let merges = 0
    let withConflicts = 0
    for (let seed = 1; seed <= 1500; seed++) {
      const rand = mulberry32(seed)
      const base = randomBase(rand, 4 + Math.floor(rand() * (seed % 3 === 0 ? 60 : 16)))
      expect(checkWorkspace(base)).toEqual([])
      // Equal clocks on some seeds, so that ties are exercised too.
      const a = new Device(base, 10_000)
      const b = new Device(base, seed % 5 === 0 ? 10_000 : 20_000)
      const did = [randomEdits(a, rand, Math.floor(rand() * 25), 'a'), randomEdits(b, rand, Math.floor(rand() * 25), 'c')]
      expect(checkWorkspace(normalizeWorkspace(a.ws)), `seed ${seed}: device a`).toEqual([])
      expect(checkWorkspace(normalizeWorkspace(b.ws)), `seed ${seed}: device b`).toEqual([])

      const out = mergeWorkspace(base, a.ws, b.ws)
      merges++
      if (out.conflicts.length) withConflicts++
      const where = `seed ${seed}`
      // Every block is reachable exactly once and nothing dangles.
      expect(checkWorkspace(out.result), where).toEqual([])
      expect(out.stats.dropped, where).toBe(0)
      // Both devices arrive at the same workspace.
      expect(describeDiff(out.result, mergeWorkspace(base, b.ws, a.ws).result), where).toEqual([])
      // Merging again changes nothing, from either device's point of view.
      expect(describeDiff(out.result, mergeWorkspace(base, out.result, b.ws).result), where).toEqual([])
      expect(describeDiff(out.result, mergeWorkspace(base, a.ws, out.result).result), where).toEqual([])
      expect(describeDiff(out.result, mergeWorkspace(b.ws, out.result, b.ws).result), where).toEqual([])
      expect(describeDiff(out.result, mergeWorkspace(a.ws, out.result, a.ws).result), where).toEqual([])
      // Nothing either device created or edited is lost, unless that same device removed it again.
      for (const [device, session] of [
        [a, did[0]],
        [b, did[1]]
      ] as const) {
        for (const id of [...session.added, ...session.edited]) {
          const mine = device.ws.blocks.get(id)
          if (!mine) continue
          // An "edit" that left the block as it was (clearing a key it did not have) protects nothing.
          const before = base.blocks.get(id)
          if (before && JSON.stringify(before.props) === JSON.stringify(mine.props) && (before.trashedAt === null) === (mine.trashedAt === null)) continue
          expect(out.result.blocks.has(id), `${where}: ${id}`).toBe(true)
        }
      }
      // Blocks neither device has do not come back.
      for (const id of out.result.blocks.keys()) expect(a.ws.blocks.has(id) || b.ws.blocks.has(id), `${where}: ${id}`).toBe(true)
    }
    expect(merges).toBe(1500)
    expect(withConflicts).toBeGreaterThan(100)
  })

  it('merges random schema, option, view and chart edits to the same database on both devices', () => {
    type Rec = Record<string, unknown>
    const shuffle = <T>(list: T[], rand: () => number): T[] => {
      const out = [...list]
      for (let k = out.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1))
        ;[out[k], out[j]] = [out[j], out[k]]
      }
      return out
    }
    const mutate = (device: Device, rand: () => number, tag: string): void => {
      const props = structuredClone(device.get('db').props) as { schema: Record<string, Rec>; views: Rec[] }
      const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]
      for (let i = 0; i < 1 + Math.floor(rand() * 5); i++) {
        const keys = Object.keys(props.schema)
        const roll = rand()
        if (roll < 0.15) props.schema[`${tag}p${i}`] = { id: `${tag}p${i}`, name: tag, type: 'select', options: [] }
        else if (roll < 0.25 && keys.length > 1) delete props.schema[pick(keys.filter((key) => key !== 'title'))]
        else if (roll < 0.4) props.schema[pick(keys)]['name'] = `${tag}${i}`
        else if (roll < 0.5) props.schema = Object.fromEntries(shuffle(Object.entries(props.schema), rand))
        else if (roll < 0.6) {
          const property = props.schema[pick(keys)]
          const options = (property['options'] as Rec[] | undefined) ?? []
          property['options'] = rand() < 0.5 ? [...options, { id: `${tag}o${i}`, name: tag, color: 'red' }] : shuffle(options, rand).slice(0, Math.max(0, options.length - (rand() < 0.3 ? 1 : 0)))
        } else if (roll < 0.7) props.views.splice(Math.floor(rand() * (props.views.length + 1)), 0, { id: `${tag}v${i}`, name: tag, type: 'table', visibleProperties: keys, filters: [], sorts: [] })
        else if (roll < 0.76 && props.views.length > 1) props.views.splice(Math.floor(rand() * props.views.length), 1)
        else if (roll < 0.84) props.views = shuffle(props.views, rand)
        else if (props.views.length) {
          const target = pick(props.views)
          if (rand() < 0.5) target['chart'] = { ...(target['chart'] as Rec | undefined), kind: pick(['bar', 'line', 'pie']), [pick(['stacked', 'showGrid', 'showLegend'])]: rand() < 0.5, y: { aggregate: pick(['count', 'sum']) } }
          else target['visibleProperties'] = shuffle(target['visibleProperties'] as string[], rand).slice(0, 1 + Math.floor(rand() * 3))
        }
      }
      device.edit('db', props)
    }
    for (let seed = 1; seed <= 600; seed++) {
      const rand = mulberry32(seed * 31)
      const d = new Device()
      d.page('home').add('db', 'database', 'home', {
        schema: { title: { id: 'title', name: 'Name', type: 'title' }, s: { id: 's', name: 'S', type: 'select', options: [{ id: 'o1', name: 'One', color: 'gray' }] }, n: { id: 'n', name: 'N', type: 'number' } },
        views: [
          { id: 'v1', name: 'Table', type: 'table', visibleProperties: ['title', 's', 'n'], filters: [], sorts: [] },
          { id: 'v2', name: 'Chart', type: 'chart', visibleProperties: ['title'], filters: [], sorts: [], chart: { kind: 'bar', y: { aggregate: 'count' } } }
        ]
      })
      const base = clone(d.ws)
      const a = new Device(base, 5000)
      const b = new Device(base, seed % 3 === 0 ? 5000 : 6000)
      mutate(a, rand, 'a')
      mutate(b, rand, 'c')
      const where = `seed ${seed}`
      const out = mergeWorkspace(base, a.ws, b.ws)
      expect(describeDiff(out.result, mergeWorkspace(base, b.ws, a.ws).result), where).toEqual([])
      expect(describeDiff(out.result, mergeWorkspace(base, out.result, b.ws).result), where).toEqual([])
      expect(describeDiff(out.result, mergeWorkspace(base, a.ws, out.result).result), where).toEqual([])
      expect(describeDiff(out.result, mergeWorkspace(a.ws, out.result, a.ws).result), where).toEqual([])
      const props = out.result.blocks.get('db')?.props as { schema: Record<string, Rec>; views: Rec[] }
      expect(Object.keys(props.schema), where).toContain('title')
      const viewIds = props.views.map((v) => v['id'])
      expect(new Set(viewIds).size, where).toBe(viewIds.length)
      for (const [key, property] of Object.entries(props.schema)) {
        expect(property['id'], where).toBe(key)
        const optionIds = ((property['options'] as Rec[] | undefined) ?? []).map((o) => o['id'])
        expect(new Set(optionIds).size, where).toBe(optionIds.length)
      }
      // What only one device added is there.
      for (const key of Object.keys((a.get('db').props as { schema: Rec }).schema)) if (key.startsWith('a')) expect(Object.keys(props.schema), where).toContain(key)
      for (const v of (b.get('db').props as { views: Rec[] }).views) if (String(v['id']).startsWith('c')) expect(viewIds, where).toContain(v['id'])
    }
  })

  it('takes the other side exactly when only one device changed anything', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rand = mulberry32(seed * 7919)
      const base = randomBase(rand, 30)
      const a = new Device(base, 10_000)
      randomEdits(a, rand, 10, 'a')
      const local = normalizeWorkspace(a.ws)
      expect(describeDiff(local, mergeWorkspace(base, a.ws, base).result), `seed ${seed}`).toEqual([])
      expect(describeDiff(local, mergeWorkspace(base, base, a.ws).result), `seed ${seed}`).toEqual([])
      expect(mergeWorkspace(base, base, a.ws).conflicts).toEqual([])
    }
  })

  it('converges when three devices sync in random order', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed * 104729)
      const start = randomBase(rand, 25)
      let remote = clone(start)
      const devices = [0, 1, 2].map((i) => new Device(start, 10_000 * (i + 1)))
      const bases = devices.map(() => clone(start))
      const sync = (i: number): void => {
        const out = mergeWorkspace(bases[i], devices[i].ws, remote)
        expect(checkWorkspace(out.result), `seed ${seed}`).toEqual([])
        devices[i].ws = clone(out.result)
        remote = clone(out.result)
        bases[i] = clone(out.result)
      }
      for (let round = 0; round < 6; round++) {
        const i = Math.floor(rand() * 3)
        randomEdits(devices[i], rand, Math.floor(rand() * 6), `d${i}r${round}x`)
        devices[i].clock += 100_000
        sync(i)
        if (rand() < 0.5) sync(Math.floor(rand() * 3))
      }
      for (const i of [0, 1, 2, 0, 1, 2]) sync(i)
      for (const device of devices) expect(describeDiff(device.ws, remote), `seed ${seed}`).toEqual([])
    }
  })
})

describe('normalizeWorkspace', () => {
  it('drops what nothing lists, repairs parents and removes repeated ids', () => {
    const d = new Device()
    d.page('p').text('a', 'p').text('b', 'p')
    d.ws.blocks.set('stray', { id: 'stray', type: 'text', parentId: 'p', content: [], props: {}, createdAt: 1, updatedAt: 1, trashedAt: null })
    d.get('p').content = ['a', 'a', 'missing', 'b']
    d.get('b').parentId = 'elsewhere'
    d.ws.root = ['p', 'p', 'ghost']
    const clean = normalizeWorkspace(d.ws)
    expect(checkWorkspace(clean)).toEqual([])
    expect([...clean.blocks.keys()].sort()).toEqual(['a', 'b', 'p'])
    expect(clean.blocks.get('p')?.content).toEqual(['a', 'b'])
    expect(clean.root).toEqual(['p'])
    // The input is left as it was.
    expect(d.get('p').content).toHaveLength(4)
  })
})
