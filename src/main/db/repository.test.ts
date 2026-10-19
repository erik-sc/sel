import { beforeEach, describe, expect, it } from 'vitest'
import type { Block } from '../../shared/types'
import type { Repository } from './repository'
import { seedIfEmpty } from './seed'
import { openTestRepository } from './testing'

let repo: Repository

const ids = (blocks: Block[]): string[] => blocks.map((b) => b.id)
const page = (title: string, parentId: string | null = null): Block => repo.create({ type: 'page', parentId, props: { title: [[title]] } })
const text = (title: string, parentId: string, afterId?: string | null): Block =>
  repo.create({ type: 'text', parentId, props: { title: [[title]] }, afterId })

beforeEach(() => {
  repo = openTestRepository()
})

describe('create', () => {
  it('orders children by afterId: undefined appends, null prepends, id inserts after', () => {
    const p = page('P')
    const a = text('a', p.id)
    const b = text('b', p.id)
    const first = text('first', p.id, null)
    const afterA = text('after a', p.id, a.id)
    expect(repo.get(p.id)!.content).toEqual([first.id, a.id, afterA.id, b.id])
    expect(ids(repo.children(p.id))).toEqual([first.id, a.id, afterA.id, b.id])
    expect(a.parentId).toBe(p.id)
  })

  it('honours client ids and rejects duplicates, bad types and missing parents', () => {
    const p = page('P')
    const id = '6f1c0a4e-1111-4222-8333-444455556666'
    expect(repo.create({ id, type: 'text', parentId: p.id }).id).toBe(id)
    expect(() => repo.create({ id, type: 'text', parentId: p.id })).toThrow(/exists/)
    expect(() => repo.create({ type: 'nope' as never, parentId: p.id })).toThrow(/type/)
    expect(() => repo.create({ type: 'text', parentId: 'missing' })).toThrow(/not found/)
    expect(() => repo.create({ type: 'text', parentId: null })).toThrow(/root/)
    expect(() => repo.create({ id: "x'; DROP TABLE blocks;--", type: 'page', parentId: null })).toThrow(/Invalid/)
    expect(repo.get(p.id)!.content).toEqual([id])
  })

  it('keeps workspace order for root pages', () => {
    const a = page('A')
    const b = page('B')
    const c = repo.create({ type: 'page', parentId: null, afterId: null })
    const d = repo.create({ type: 'database', parentId: null, afterId: a.id })
    expect(ids(repo.listRoot())).toEqual([c.id, a.id, d.id, b.id])
    expect(d.props.schema).toBeDefined()
    expect(d.props.views).toHaveLength(1)
  })
})

describe('update', () => {
  it('shallow-merges props and removes keys set to null', () => {
    const p = page('P')
    const t = repo.create({ type: 'to_do', parentId: p.id, props: { title: [['x']], checked: true, color: 'red' } })
    const u = repo.update(t.id, { props: { checked: false, color: null } })
    expect(u.props).toEqual({ title: [['x']], checked: false })
    expect('color' in u.props).toBe(false)
    expect(repo.update(t.id, { type: 'text' }).type).toBe('text')
    expect(repo.get(t.id)!.props.title).toEqual([['x']])
    expect(u.updatedAt).toBeGreaterThan(t.updatedAt)
  })

  it('rejects unknown blocks and invalid types', () => {
    const p = page('P')
    expect(() => repo.update('missing', { props: {} })).toThrow(/not found/)
    expect(() => repo.update(p.id, { type: 'bogus' as never })).toThrow(/type/)
    expect(() => repo.update(p.id, { type: 'text' })).toThrow(/root/)
  })
})

describe('move', () => {
  it('moves between parents and reorders within one', () => {
    const p = page('P')
    const q = page('Q')
    const a = text('a', p.id)
    const b = text('b', p.id)
    const c = text('c', p.id)
    repo.move(c.id, p.id, null)
    expect(repo.get(p.id)!.content).toEqual([c.id, a.id, b.id])
    repo.move(c.id, p.id, a.id)
    expect(repo.get(p.id)!.content).toEqual([a.id, c.id, b.id])
    const moved = repo.move(a.id, q.id)
    expect(moved.parentId).toBe(q.id)
    expect(repo.get(p.id)!.content).toEqual([c.id, b.id])
    expect(repo.get(q.id)!.content).toEqual([a.id])
  })

  it('moves pages to and from the root', () => {
    const p = page('P')
    const q = page('Q')
    const sub = page('Sub', p.id)
    repo.move(sub.id, null, p.id)
    expect(ids(repo.listRoot())).toEqual([p.id, sub.id, q.id])
    expect(repo.get(p.id)!.content).toEqual([])
    repo.move(q.id, sub.id)
    expect(ids(repo.listRoot())).toEqual([p.id, sub.id])
    expect(repo.get(q.id)!.parentId).toBe(sub.id)
  })

  it('rejects cycles and leaves the tree untouched', () => {
    const p = page('P')
    const child = page('Child', p.id)
    const leaf = text('leaf', child.id)
    expect(() => repo.move(p.id, p.id)).toThrow(/itself/)
    expect(() => repo.move(p.id, leaf.id)).toThrow(/descendants/)
    expect(() => repo.move(leaf.id, null)).toThrow(/root/)
    expect(repo.get(p.id)!.parentId).toBeNull()
    expect(repo.get(p.id)!.content).toEqual([child.id])
    expect(repo.get(leaf.id)!.content).toEqual([])
    expect(ids(repo.listRoot())).toEqual([p.id])
  })
})

describe('delete / trash / restore', () => {
  it('hard-deletes ordinary blocks with their descendants', () => {
    const p = page('P')
    const toggle = repo.create({ type: 'toggle', parentId: p.id })
    const inner = text('inner', toggle.id)
    const deep = text('deep', inner.id)
    repo.delete(toggle.id)
    expect(repo.get(toggle.id)).toBeNull()
    expect(repo.get(inner.id)).toBeNull()
    expect(repo.get(deep.id)).toBeNull()
    expect(repo.get(p.id)!.content).toEqual([])
    expect(repo.search('inner')).toEqual([])
    expect(() => repo.delete(toggle.id)).not.toThrow()
  })

  it('trashes pages and restores them to their original parent', () => {
    const p = page('P')
    const before = text('before', p.id)
    const sub = page('Sub', p.id)
    const note = text('note', sub.id)
    repo.delete(sub.id)
    expect(repo.get(sub.id)!.trashedAt).not.toBeNull()
    expect(repo.get(note.id)).not.toBeNull()
    expect(repo.get(p.id)!.content).toEqual([before.id])
    expect(ids(repo.listTrash())).toEqual([sub.id])
    expect(repo.listChildren(p.id)).toEqual([])

    repo.restore(sub.id)
    expect(repo.get(sub.id)!.trashedAt).toBeNull()
    expect(repo.get(p.id)!.content).toEqual([before.id, sub.id])
    expect(repo.listTrash()).toEqual([])
    expect(ids(repo.children(sub.id))).toEqual([note.id])
  })

  it('restores to the root when the parent is trashed or gone', () => {
    const p = page('P')
    const sub = page('Sub', p.id)
    repo.delete(sub.id)
    repo.delete(p.id)
    expect(repo.listRoot()).toEqual([])
    repo.restore(sub.id)
    expect(repo.get(sub.id)!.parentId).toBeNull()
    expect(ids(repo.listRoot())).toEqual([sub.id])

    const q = page('Q')
    const sub2 = page('Sub2', q.id)
    repo.delete(sub2.id)
    repo.deleteForever(q.id)
    expect(repo.get(q.id)).toBeNull()
    repo.restore(sub2.id)
    expect(ids(repo.listRoot())).toEqual([sub.id, sub2.id])
  })

  it('moves pages nested in a deleted block to the trash instead of destroying them', () => {
    const p = page('P')
    const toggle = repo.create({ type: 'toggle', parentId: p.id })
    const nested = page('Nested', toggle.id)
    repo.delete(toggle.id)
    expect(repo.get(toggle.id)).toBeNull()
    expect(ids(repo.listTrash())).toEqual([nested.id])
    repo.restore(nested.id)
    expect(ids(repo.listRoot())).toEqual([p.id, nested.id])
  })

  it('deleteForever removes the whole subtree including nested pages', () => {
    const p = page('P')
    const sub = page('Sub', p.id)
    const note = text('note', sub.id)
    repo.delete(p.id)
    repo.deleteForever(p.id)
    expect(repo.getMany([p.id, sub.id, note.id])).toEqual([])
    expect(repo.listTrash()).toEqual([])
    expect(repo.listRoot()).toEqual([])
  })
})

describe('getTree', () => {
  it('stops at nested page and database boundaries but includes them', () => {
    const p = page('P')
    const a = text('a', p.id)
    const a1 = text('a1', a.id)
    const sub = page('Sub', a.id)
    const hidden = text('hidden', sub.id)
    const db = repo.create({ type: 'database', parentId: p.id })
    const row = page('Row', db.id)
    const z = text('z', p.id)

    expect(ids(repo.getTree(p.id))).toEqual([p.id, a.id, a1.id, sub.id, db.id, z.id])
    expect(ids(repo.getTree(p.id))).not.toContain(hidden.id)
    // A database root lists its rows, not their bodies.
    const body = text('row body', row.id)
    expect(ids(repo.getTree(db.id))).toEqual([db.id, row.id])
    expect(ids(repo.getTree(row.id))).toEqual([row.id, body.id])
    expect(repo.getTree('missing')).toEqual([])
    expect(ids(repo.listChildren(p.id))).toEqual([sub.id, db.id])
  })
})

describe('apply', () => {
  it('runs a batch atomically and returns the affected blocks', () => {
    const p = page('P')
    const old = text('old', p.id)
    repo.drainChanges()
    const id = 'aaaaaaaa-0000-4000-8000-000000000001'
    const affected = repo.apply([
      { op: 'create', input: { id, type: 'text', parentId: p.id, afterId: null, props: { title: [['new']] } } },
      { op: 'update', id, patch: { props: { color: 'blue' } } },
      { op: 'move', id: old.id, parentId: id },
      { op: 'delete', id: old.id }
    ])
    expect(ids(affected).sort()).toEqual([id, p.id].sort())
    expect(repo.get(p.id)!.content).toEqual([id])
    expect(repo.get(id)!.props.color).toBe('blue')
    expect(repo.get(old.id)).toBeNull()
    expect(repo.drainChanges().sort()).toEqual([id, old.id, p.id].sort())
  })

  it('rolls everything back when one op fails', () => {
    const p = page('P')
    const a = text('a', p.id)
    repo.drainChanges()
    const before = repo.get(p.id)!
    expect(() =>
      repo.apply([
        { op: 'create', input: { id: 'new-block', type: 'text', parentId: p.id, props: { title: [['zebra']] } } },
        { op: 'update', id: a.id, patch: { props: { title: [['changed']] } } },
        { op: 'delete', id: a.id },
        { op: 'update', id: 'does-not-exist', patch: { props: {} } }
      ])
    ).toThrow(/not found/)
    expect(repo.get('new-block')).toBeNull()
    expect(repo.get(a.id)!.props.title).toEqual([['a']])
    expect(repo.get(p.id)).toEqual(before)
    expect(repo.search('zebra')).toEqual([])
    expect(repo.search('changed')).toEqual([])
    expect(repo.drainChanges()).toEqual([])
    // The repository is still usable afterwards.
    expect(text('after', p.id).parentId).toBe(p.id)
  })
})

describe('search', () => {
  it('finds page titles and block text with prefix matching, pages first', () => {
    const p = repo.create({ type: 'page', parentId: null, props: { title: [['Projeto Atlas']], icon: '🗺️' } })
    const sub = page('Reuniões', p.id)
    const note = text('Discutir o orçamento do atlas com a equipe', sub.id)

    const hits = repo.search('atl')
    expect(hits.map((h) => h.id)).toEqual([p.id, note.id])
    expect(hits[0]).toMatchObject({ id: p.id, pageId: p.id, title: 'Projeto Atlas', icon: '🗺️', path: [] })
    expect(hits[0].snippet).toBeUndefined()
    expect(hits[1]).toMatchObject({ pageId: sub.id, title: 'Reuniões', path: ['Projeto Atlas'] })
    expect(hits[1].snippet).toContain('atlas')
  })

  it('ignores accents, supports multiple terms and falls back to substring matching', () => {
    const p = page('Reuniões de março')
    expect(repo.search('reunioes').map((h) => h.id)).toEqual([p.id])
    expect(repo.search('marco reun').map((h) => h.id)).toEqual([p.id])
    expect(repo.search('unknown reun')).toEqual([])
    // "niõe" is not a token prefix; only the LIKE fallback can find it.
    expect(repo.search('niõe').map((h) => h.id)).toEqual([p.id])
    expect(repo.search('"quoted* (').length).toBe(0)
    expect(repo.search('   ')).toEqual([])
  })

  it('tracks edits and excludes trashed subtrees', () => {
    const p = page('Garden')
    const sub = page('Tomatoes', p.id)
    const note = text('water twice a week', sub.id)
    repo.update(note.id, { props: { title: [['prune monthly']] } })
    expect(repo.search('water')).toEqual([])
    expect(repo.search('prune').map((h) => h.id)).toEqual([note.id])

    repo.delete(p.id)
    expect(repo.search('prune')).toEqual([])
    expect(repo.search('tomatoes')).toEqual([])
    repo.restore(p.id)
    expect(repo.search('tomatoes').map((h) => h.id)).toEqual([sub.id])
    expect(repo.search('prune', 1)).toHaveLength(1)
  })

  it('lists each page once: its title hit, or else its best block', () => {
    const log = page('Diário de bordo')
    const lines = Array.from({ length: 12 }, (_, i) => text(`Dia ${i}: conversa com o cliente`, log.id))
    const client = page('Cliente novo')
    text('O cliente pediu um orçamento', client.id)
    const other = page('Outra página')
    text('Sem nada a ver', other.id)
    const late = text('Ligar para o cliente amanhã', other.id)

    const hits = repo.search('cliente')
    expect(hits).toHaveLength(3)
    // The title hit stands for its page and comes first; block hits only add a row for pages not listed yet.
    expect(hits[0]).toMatchObject({ id: client.id, pageId: client.id })
    expect(hits[0].snippet).toBeUndefined()
    const fromLog = hits.find((h) => h.pageId === log.id)!
    expect(lines.map((b) => b.id)).toContain(fromLog.id)
    expect(fromLog.snippet).toContain('cliente')
    expect(hits.find((h) => h.pageId === other.id)).toMatchObject({ id: late.id, title: 'Outra página' })
    // The limit counts pages.
    expect(new Set(repo.search('cliente', 2).map((h) => h.pageId)).size).toBe(2)
  })

  it('keeps marking archived pages and leaving the trash out when it groups', () => {
    const kept = page('Arquivo morto')
    text('notas do arquivo', kept.id)
    repo.update(kept.id, { props: { archivedAt: Date.now() } })
    const gone = page('Lixo')
    text('arquivo velho', gone.id)
    repo.delete(gone.id)

    const hits = repo.search('arquivo')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: kept.id, archived: true })
  })
})

describe('backlinks', () => {
  const linkTo = (words: string, target: string, parentId: string, before = 'veja ', hash = ''): Block =>
    repo.create({
      type: 'text',
      parentId,
      props: { title: [[before], [words, [['a', `sel://page/${target}${hash}`]]], [' depois']] }
    })

  it('lists each page that links here once, with the text around the link', () => {
    const target = page('Orçamento')
    const plan = repo.create({ type: 'page', parentId: null, props: { title: [['Planejamento']], icon: '🗺️' } })
    const sub = page('Reunião', plan.id)
    const first = linkTo('o orçamento', target.id, sub.id)
    linkTo('de novo', target.id, sub.id)
    const other = page('Ideias')
    linkTo('um bloco dele', target.id, other.id, 'e ', '#b-1')

    const found = repo.backlinks(target.id)
    expect(found.map((r) => r.pageId).sort()).toEqual([sub.id, other.id].sort())
    expect(found.find((r) => r.pageId === sub.id)).toMatchObject({
      id: first.id,
      title: 'Reunião',
      path: ['Planejamento'],
      snippet: 'veja o orçamento depois'
    })
  })

  it('leaves out the page itself, the trash, other targets and plain text', () => {
    const target = page('Alvo')
    linkTo('aqui mesmo', target.id, target.id)
    const prefixed = repo.create({ id: `${target.id}x`, type: 'page', parentId: null, props: { title: [['Outro']] } })
    const elsewhere = page('Em outro lugar')
    linkTo('outro alvo', prefixed.id, elsewhere.id)
    text(`sel://page/${target.id} escrito sem link`, elsewhere.id)
    const trashed = page('Lixo')
    linkTo('no lixo', target.id, trashed.id)
    repo.delete(trashed.id)

    expect(repo.backlinks(target.id)).toEqual([])
    expect(repo.backlinks(prefixed.id).map((r) => r.pageId)).toEqual([elsewhere.id])
    expect(repo.backlinks('not an id!')).toEqual([])
  })

  it('marks a linking page that is archived, as search does', () => {
    const target = page('Alvo')
    const old = page('Antigo')
    linkTo('alvo', target.id, old.id)
    repo.update(old.id, { props: { archivedAt: Date.now() } })
    expect(repo.backlinks(target.id)).toMatchObject([{ pageId: old.id, archived: true }])
  })
})

describe('duplicate', () => {
  it('deep-copies with fresh ids next to the original', () => {
    const p = page('P')
    const src = repo.create({ type: 'page', parentId: p.id, props: { title: [['Doc']], favorite: true } })
    const last = text('last', p.id)
    const a = text('a', src.id)
    const a1 = text('a1', a.id)
    const sub = page('Sub', src.id)
    const subNote = text('sub note', sub.id)

    const copy = repo.duplicate(src.id)
    expect(copy.id).not.toBe(src.id)
    expect(copy.parentId).toBe(p.id)
    expect(copy.props.title).toEqual([['Doc'], [' (copy)']])
    expect(copy.props.favorite).toBeUndefined()
    expect(repo.get(p.id)!.content).toEqual([src.id, copy.id, last.id])

    const original = new Set([src.id, a.id, a1.id, sub.id, subNote.id])
    const [ca, csub] = repo.children(copy.id)
    expect(ca.props.title).toEqual([['a']])
    expect(ca.parentId).toBe(copy.id)
    const [ca1] = repo.children(ca.id)
    expect(ca1.props.title).toEqual([['a1']])
    const [csubNote] = repo.children(csub.id)
    expect(csubNote.props.title).toEqual([['sub note']])
    for (const b of [copy, ca, ca1, csub, csubNote]) expect(original.has(b.id)).toBe(false)

    // Independent copies: editing one leaves the other alone, and both are searchable.
    repo.update(ca.id, { props: { title: [['edited']] } })
    expect(repo.get(a.id)!.props.title).toEqual([['a']])
    expect(repo.search('sub note')).toHaveLength(2)
  })

  it('duplicates root pages into the workspace order', () => {
    const a = page('A')
    const b = page('B')
    const copy = repo.duplicate(a.id)
    expect(ids(repo.listRoot())).toEqual([a.id, copy.id, b.id])
  })
})

describe('page lists', () => {
  it('lists favorites, recents and ancestors', () => {
    const a = page('A')
    const b = page('B')
    const sub = page('Sub', a.id)
    const toggle = repo.create({ type: 'toggle', parentId: sub.id })
    const leaf = text('leaf', toggle.id)
    repo.update(b.id, { props: { favorite: true } })
    repo.update(sub.id, { props: { favorite: true } })
    expect(ids(repo.listFavorites())).toEqual([b.id, sub.id])
    expect(ids(repo.ancestors(leaf.id))).toEqual([a.id, sub.id])
    expect(repo.ancestors(a.id)).toEqual([])

    // Editing a block makes its page the most recent one.
    repo.update(leaf.id, { props: { title: [['edited']] } })
    expect(ids(repo.listRecent())[0]).toBe(sub.id)
    repo.update(b.id, { props: { icon: '⭐' } })
    expect(ids(repo.listRecent(2))).toEqual([b.id, sub.id])

    repo.delete(a.id)
    expect(ids(repo.listFavorites())).toEqual([b.id])
    expect(ids(repo.listRecent())).toEqual([b.id])
  })
})

describe('settings, seed and persistence', () => {
  it('stores JSON settings and deletes on null', () => {
    expect(repo.getSetting('theme')).toBeNull()
    repo.setSetting('theme', 'dark')
    repo.setSetting('obj', { a: [1, 2] })
    expect(repo.getSetting('theme')).toBe('dark')
    expect(repo.getSetting('obj')).toEqual({ a: [1, 2] })
    repo.setSetting('theme', null)
    expect(repo.getSetting('theme')).toBeNull()
  })

  it('seeds a getting-started page with an example database exactly once', () => {
    const id = seedIfEmpty(repo)
    expect(id).not.toBeNull()
    expect(seedIfEmpty(repo)).toBeNull()
    const [root] = repo.listRoot()
    expect(root.id).toBe(id)
    const tree = repo.getTree(root.id)
    const types = new Set(tree.map((b) => b.type))
    for (const t of ['heading_2', 'to_do', 'bulleted_list', 'numbered_list', 'toggle', 'quote', 'code', 'callout', 'divider']) {
      expect(types.has(t as never)).toBe(true)
    }
    const db = tree.find((b) => b.type === 'database')!
    expect(db.props.views![0].type).toBe('table')
    const kinds = Object.values(db.props.schema!).map((s) => s.type)
    expect(kinds).toEqual(expect.arrayContaining(['title', 'select', 'date', 'checkbox']))
    expect(repo.children(db.id)).toHaveLength(3)
    expect(repo.search('getting')[0].id).toBe(id)
    expect(repo.drainChanges()).toEqual([])
    // Emptying the workspace must not bring the sample content back.
    repo.deleteForever(root.id)
    expect(seedIfEmpty(repo)).toBeNull()
  })
})

describe('robustness', () => {
  it('survives corrupt rows instead of crashing', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { Repository: Repo } = await import('./repository')
    const db = new DatabaseSync(':memory:')
    const r = new Repo(db)
    const p = r.create({ type: 'page', parentId: null, props: { title: [['Fine']] } })
    const a = r.create({ type: 'text', parentId: p.id, props: { title: [['a']] } })
    const b = r.create({ type: 'text', parentId: p.id, props: { title: [['b']] } })
    const c = r.create({ type: 'text', parentId: p.id })
    db.prepare("UPDATE blocks SET props = '{not json', content = 'nope' WHERE id = ?").run(a.id)
    db.prepare(`UPDATE blocks SET props = '[1,2]', content = '{"a":1}', type = 'martian' WHERE id = ?`).run(b.id)
    db.prepare(`UPDATE blocks SET props = '{"title":[null,5,["ok"],[7],"x"],"caption":{"a":1}}' WHERE id = ?`).run(c.id)
    db.prepare('UPDATE blocks SET content = ? WHERE id = ?').run(JSON.stringify([a.id, 5, null, b.id, c.id, 'ghost']), p.id)
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('rootOrder', '{oops'), ('theme', 'x{')").run()

    expect(r.get(a.id)).toMatchObject({ props: {}, content: [] })
    expect(r.get(b.id)).toMatchObject({ type: 'text', props: {}, content: [] })
    expect(ids(r.getTree(p.id))).toEqual([p.id, a.id, b.id, c.id])
    expect(ids(r.listRoot())).toEqual([p.id])
    expect(r.getSetting('theme')).toBeNull()
    expect(() => r.search('ok')).not.toThrow()
    // Mutations on a damaged block still work and repair it.
    expect(r.update(c.id, { props: { title: [['fixed']] } }).props.title).toEqual([['fixed']])
    expect(() => r.duplicate(p.id)).not.toThrow()
    r.close()
  })

  it('createTree inserts a whole tree atomically, in order', () => {
    const parent = page('Parent')
    const first = text('first', parent.id)
    const root = repo.createTree(
      {
        type: 'page',
        props: { title: [['Imported']] },
        children: [
          { type: 'text', props: { title: [['one']] } },
          { type: 'bulleted_list', props: { title: [['two']] }, children: [{ type: 'text', props: { title: [['nested']] } }] },
          { type: 'database', children: [{ type: 'page', props: { title: [['row']] } }] }
        ]
      },
      parent.id,
      first.id
    )
    expect(repo.get(parent.id)?.content).toEqual([first.id, root.id])
    const tree = repo.getTree(root.id)
    expect(tree.map((b) => b.type)).toEqual(['page', 'text', 'bulleted_list', 'text', 'database'])
    expect(tree[3].parentId).toBe(tree[2].id)
    expect(tree[4].props.schema).toBeTruthy()
    expect(repo.children(tree[4].id).map((b) => b.props.title)).toEqual([[['row']]])
    expect(repo.search('nested')[0]?.pageId).toBe(root.id)
    expect(repo.drainChanges()).toContain(root.id)

    const before = repo.listRoot().length
    expect(() => repo.createTree({ type: 'page', children: [{ type: 'bogus' as never }] }, null)).toThrow('Invalid block type')
    expect(() => repo.createTree({ type: 'text' }, null)).toThrow()
    expect(() => repo.createTree({ type: 'page' }, 'missing')).toThrow('Block not found')
    expect(repo.listRoot()).toHaveLength(before)
    expect(repo.drainChanges()).toEqual([])
  })

  it('checkpoints the WAL on close and reopens without re-running migrations', async () => {
    const { mkdtempSync, existsSync, statSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'sel-db-'))
    const file = join(dir, 'test.db')
    try {
      const first = openTestRepository(file)
      const p = first.create({ type: 'page', parentId: null, props: { title: [['Kept']] } })
      first.close()
      const wal = `${file}-wal`
      expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true)
      const second = openTestRepository(file)
      expect(second.get(p.id)?.props.title).toEqual([['Kept']])
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('batches that reorder one parent many times', () => {
  it('ends with the same child list and timestamps as the same ops applied one by one', () => {
    const run = (batch: boolean): { order: string[]; newest: string[]; titles: unknown[] } => {
      const r = openTestRepository()
      const p = r.create({ id: 'p', type: 'page', parentId: null, props: { title: [['P']] } })
      const q = r.create({ id: 'q', type: 'page', parentId: null, props: { title: [['Q']] } })
      r.create({ id: 'old', type: 'text', parentId: p.id, props: { title: [['old']] } })
      const ops: Parameters<Repository['apply']>[0] = [
        { op: 'create', input: { id: 'a', type: 'text', parentId: 'p', props: { title: [['a']] } } },
        { op: 'create', input: { id: 'b', type: 'toggle', parentId: 'p', afterId: null, props: { title: [['b']] } } },
        { op: 'create', input: { id: 'c', type: 'text', parentId: 'b', props: { title: [['c']] } } },
        { op: 'update', id: 'p', patch: { props: { icon: 'x' } } },
        { op: 'move', id: 'a', parentId: 'b', afterId: null },
        { op: 'create', input: { id: 'd', type: 'page', parentId: 'p', afterId: 'old', props: { title: [['d']] } } },
        { op: 'delete', id: 'old' },
        { op: 'move', id: 'd', parentId: 'q' },
        // Same id again after its row was removed: nothing of the old block may leak into it.
        { op: 'delete', id: 'b' },
        { op: 'create', input: { id: 'b', type: 'toggle', parentId: 'p', props: { title: [['b2']] } } },
        { op: 'create', input: { id: 'e', type: 'text', parentId: 'b', props: { title: [['e']] } } }
      ]
      if (batch) r.apply(ops)
      else for (const op of ops) r.apply([op])
      const out = {
        order: ['p', 'q', 'b'].map((id) => `${id}:${r.get(id)?.content.join(',')}`),
        newest: ids(r.listRecent()),
        titles: r.getTree('p').map((b) => b.props.title)
      }
      expect(r.get('a')).toBeNull()
      expect(r.get('c')).toBeNull()
      r.close()
      return out
    }
    const batched = run(true)
    expect(batched.order).toEqual(['p:b', 'q:d', 'b:e'])
    expect(batched).toEqual(run(false))
  })

  it('returns blocks with their final child lists and leaves nothing behind when the batch fails', () => {
    const p = page('P')
    const first = text('first', p.id)
    const made = repo.apply([
      { op: 'create', input: { id: 'x1', type: 'text', parentId: p.id } },
      { op: 'create', input: { id: 'x2', type: 'text', parentId: p.id, afterId: first.id } }
    ])
    expect(made.find((b) => b.id === p.id)?.content).toEqual([first.id, 'x2', 'x1'])
    expect(repo.get(p.id)?.content).toEqual([first.id, 'x2', 'x1'])
    repo.drainChanges()

    expect(() =>
      repo.apply([
        { op: 'create', input: { id: 'x3', type: 'text', parentId: p.id, afterId: null } },
        { op: 'delete', id: 'x1' },
        { op: 'update', id: 'missing', patch: {} }
      ])
    ).toThrow('Block not found')
    expect(repo.get(p.id)?.content).toEqual([first.id, 'x2', 'x1'])
    expect(repo.drainChanges()).toEqual([])
    // The next transaction starts from what is stored, not from the abandoned child list.
    repo.create({ id: 'x4', type: 'text', parentId: p.id })
    expect(repo.get(p.id)?.content).toEqual([first.id, 'x2', 'x1', 'x4'])
  })
})

describe('query plans', () => {
  it('answers every repository query from an index (no scan of the blocks table)', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { Repository: Repo } = await import('./repository')
    const db = new DatabaseSync(':memory:')
    // Record every statement the repository prepares while each of its methods runs once.
    const seen = new Set<string>()
    const r = new Repo({
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        seen.add(sql)
        return db.prepare(sql)
      },
      close: () => db.close()
    })
    const root = r.create({ type: 'page', parentId: null, props: { title: [['Root']], favorite: true } })
    const sub = r.create({ type: 'page', parentId: root.id, props: { title: [['Sub']] } })
    const a = r.create({ type: 'text', parentId: sub.id, props: { title: [['alpha beta']] } })
    const b = r.create({ type: 'toggle', parentId: sub.id, props: { title: [['gamma']] } })
    r.createTree({ type: 'page', children: [{ type: 'text', props: { title: [['imported']] } }] }, root.id)
    r.update(a.id, { props: { title: [['alpha delta']] } })
    r.update(a.id, { type: 'quote' })
    r.move(a.id, b.id)
    r.apply([{ op: 'create', input: { type: 'text', parentId: b.id } }])
    r.get(a.id)
    r.getMany([a.id, b.id])
    r.getTree(root.id)
    r.children(sub.id)
    r.listRoot()
    r.listChildren(root.id)
    r.listFavorites()
    r.listRecent()
    r.ancestors(a.id)
    r.search('alpha')
    r.search('lph')
    const source = r.create({ type: 'database', parentId: sub.id })
    const linked = r.create({ type: 'database', parentId: root.id, props: { sourceId: source.id } })
    r.update(linked.id, { props: { sourceId: source.id, title: [['Linked']] } })
    r.listDatabases()
    r.databaseLocations(source.id)
    r.delete(linked.id)
    r.duplicate(sub.id)
    r.delete(b.id)
    r.delete(sub.id)
    r.listTrash()
    r.restore(sub.id)
    r.delete(sub.id)
    r.deleteForever(sub.id)
    r.setSetting('k', 1)
    r.getSetting('k')
    r.isEmpty()

    const plans = new Map<string, string>()
    for (const sql of seen) {
      if (!/^\s*(WITH|SELECT|UPDATE|DELETE|INSERT)\b/i.test(sql)) continue
      const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]
      plans.set(sql.replace(/\s+/g, ' ').trim(), rows.map((p) => p.detail).join(' | '))
    }
    expect(plans.size).toBeGreaterThan(25)
    // SEL_PLANS=1 prints every statement with its plan.
    if (process.env['SEL_PLANS'] === '1') {
      process.stdout.write([...plans].map(([sql, plan]) => `${sql}\n    => ${plan}`).join('\n') + '\n')
    }

    // The only statement allowed to walk a whole table ("SCAN x" without "USING ... INDEX")
    // is the substring fallback of search, which has no index to use by design.
    const scans = [...plans].filter(([, plan]) => /\bSCAN (blocks|b|c|p|blocks_fts_content)\b(?! USING)/.test(plan)).map(([sql]) => sql)
    expect(scans).toEqual(["SELECT c0 AS id FROM blocks_fts_content WHERE c1 LIKE ? ESCAPE '\\' LIMIT ?"])

    const planOf = (fragment: string): string => {
      const hit = [...plans].find(([sql]) => sql.includes(fragment))
      if (!hit) throw new Error(`no statement contains: ${fragment}`)
      return hit[1]
    }
    // Recent pages come straight off the partial index, newest first, without a sort.
    expect(planOf('ORDER BY updated_at DESC')).toContain('blocks_pages_recent_idx')
    expect(planOf('ORDER BY updated_at DESC')).not.toContain('TEMP B-TREE')
    // Favourites only look at live pages and databases, never at ordinary blocks.
    expect(planOf("json_extract(props, '$.favorite')")).toContain('blocks_pages_recent_idx')
    // So do the list of source databases (already in recency order) and the views of one source.
    expect(planOf("json_extract(props, '$.sourceId') IS NULL")).toContain('blocks_pages_recent_idx')
    expect(planOf("json_extract(props, '$.sourceId') IS NULL")).not.toContain('TEMP B-TREE')
    expect(planOf("json_extract(props, '$.sourceId') = ?")).toContain('blocks_pages_recent_idx')
    expect(planOf('trashed_at IS NOT NULL ORDER BY trashed_at DESC')).toContain('blocks_trashed_idx')
    expect(planOf('trashed_at IS NOT NULL ORDER BY trashed_at DESC')).not.toContain('TEMP B-TREE')
    // The workspace root, the children lookup of delete, and both recursive walks use parent_id / id.
    expect(planOf('parent_id IS NULL AND trashed_at IS NULL')).toContain('blocks_parent_idx')
    expect(planOf('FROM blocks WHERE parent_id = ?')).toContain('blocks_parent_idx')
    expect(planOf('WITH RECURSIVE tree')).toContain('blocks_parent_idx')
    expect(planOf('WITH RECURSIVE up')).toContain('sqlite_autoindex_blocks_1')
    expect(planOf('FROM json_each(?) j CROSS JOIN blocks b')).toContain('sqlite_autoindex_blocks_1')
    r.close()
  })

  it('migrates a version-1 database to the current indexes without touching its rows', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { Repository: Repo } = await import('./repository')
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE blocks (rid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, parent_id TEXT,
        content TEXT NOT NULL DEFAULT '[]', props TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, trashed_at INTEGER);
      CREATE INDEX blocks_parent_idx ON blocks(parent_id);
      CREATE INDEX blocks_trashed_idx ON blocks(trashed_at) WHERE trashed_at IS NOT NULL;
      CREATE INDEX blocks_type_updated_idx ON blocks(type, updated_at);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE VIRTUAL TABLE blocks_fts USING fts5(id UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2');
      INSERT INTO blocks (id, type, props, created_at, updated_at) VALUES ('old', 'page', '{"title":[["Old page"]]}', 1, 2);
      INSERT INTO blocks_fts (rowid, id, text) VALUES (1, 'old', 'Old page');
      PRAGMA user_version = 1;
    `)
    const r = new Repo(db)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(5)
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((x) => x.name)
    expect(names).toContain('blocks_pages_recent_idx')
    // Migration 3: the version history table, empty.
    expect(names).toContain('page_versions_page_idx')
    expect(r.versionStats()).toEqual({ count: 0, bytes: 0, damaged: 0 })
    expect(names).not.toContain('blocks_type_updated_idx')
    expect(ids(r.listRecent())).toEqual(['old'])
    expect(r.search('old')[0]?.id).toBe('old')
    r.close()
  })
})
