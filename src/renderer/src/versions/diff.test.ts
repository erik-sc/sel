import { describe, expect, it } from 'vitest'
import type { BlockProps, BlockType } from '@shared/types'
import type { SnapshotBlock, SnapshotContent, SnapshotRow } from '@shared/versions'
import { diffSnapshots, summarize, tokenize, wordDiff, WORD_DIFF_LIMITS, type WordOp } from './diff'

const compact = (ops: WordOp[] | null): string | null =>
  ops === null ? null : ops.map((op) => (op.kind === 'equal' ? op.text : op.kind === 'insert' ? `{+${op.text}+}` : `[-${op.text}-]`)).join('')
const side = (ops: WordOp[], drop: WordOp['kind']): string =>
  ops
    .filter((op) => op.kind !== drop)
    .map((op) => op.text)
    .join('')

describe('tokenize', () => {
  it('splits into words, spaces and punctuation, and loses nothing', () => {
    expect(tokenize('Hello, wide  world!')).toEqual(['Hello', ',', ' ', 'wide', '  ', 'world', '!'])
    expect(tokenize('')).toEqual([])
    for (const text of ['a\nb\tc', 'ação naïve Ünïcödé', '日本語のテキスト', "don't stop", 'x=1;y=2']) {
      expect(tokenize(text).join('')).toBe(text)
    }
  })

  it('keeps accented letters in their word and emoji sequences whole', () => {
    expect(tokenize('ação e reação')).toEqual(['ação', ' ', 'e', ' ', 'reação'])
    const family = '👨‍👩‍👧‍👦'
    const flag = '🇧🇷'
    const thumbs = '👍🏽'
    const tokens = tokenize(`a ${family} b ${flag}${thumbs}`)
    expect(tokens).toContain(family)
    expect(tokens).toContain(flag)
    expect(tokens).toContain(thumbs)
    // A combining mark stays with its base letter.
    expect(tokenize('été')).toEqual(['été'])
  })
})

describe('wordDiff', () => {
  it('marks inserted and deleted words', () => {
    expect(compact(wordDiff('the quick brown fox', 'the slow brown fox jumps'))).toBe('the [-quick-]{+slow+} brown fox{+ jumps+}')
    expect(compact(wordDiff('one two three', 'one three'))).toBe('one [-two -]three')
    expect(compact(wordDiff('a b', 'a x y b'))).toBe('a {+x y +}b')
  })

  it('handles the trivial cases', () => {
    expect(wordDiff('', '')).toEqual([])
    expect(wordDiff('same text', 'same text')).toEqual([{ kind: 'equal', text: 'same text' }])
    expect(wordDiff('', 'new')).toEqual([{ kind: 'insert', text: 'new' }])
    expect(wordDiff('old', '')).toEqual([{ kind: 'delete', text: 'old' }])
    expect(compact(wordDiff('completely different', 'nothing alike here'))).toBe('[-completely different-]{+nothing alike here+}')
  })

  it('joins edits that only a space separates, without losing the space on either side', () => {
    const ops = wordDiff('and ask Ana to check the seats.', 'and send the confirmation to Ana.')!
    expect(compact(ops)).toBe('and [-ask Ana-]{+send the confirmation+} to [-check the seats-]{+Ana+}.')
    expect(side(ops, 'insert')).toBe('and ask Ana to check the seats.')
    expect(side(ops, 'delete')).toBe('and send the confirmation to Ana.')
    // A word that stays between two edits keeps them apart.
    expect(compact(wordDiff('red big car', 'blue big bike'))).toBe('[-red-]{+blue+} big [-car-]{+bike+}')
    expect(compact(wordDiff('a b c', 'a c'))).toBe('a [-b -]c')
    expect(compact(wordDiff('x\ny', 'p\nq'))).toBe('[-x\ny-]{+p\nq+}')
  })

  it('always reproduces both texts exactly', () => {
    const samples: [string, string][] = [
      ['The plan is to ship on Friday.', 'The new plan is to ship next Friday, maybe.'],
      ['a a a a b a a', 'a b a a a a a'],
      ['x', 'y'],
      ['line one\nline two\nline three', 'line one\nline 2\nline three\nline four'],
      ['tabs\tand  spaces', 'tabs and spaces'],
      ['ação naïve café', 'acção naive café com leite'],
      ['price: 10€ (ten)', 'price: 12€ (twelve!)']
    ]
    for (const [from, to] of samples) {
      const ops = wordDiff(from, to)!
      expect(side(ops, 'insert'), `${from} -> ${to}`).toBe(from)
      expect(side(ops, 'delete'), `${from} -> ${to}`).toBe(to)
      // Neighbouring operations are merged, and nothing is empty.
      ops.forEach((op, index) => {
        expect(op.text.length).toBeGreaterThan(0)
        if (index > 0) expect(op.kind).not.toBe(ops[index - 1].kind)
      })
    }
  })

  it('finds a minimal script on a known case', () => {
    // Myers' own example, letter by letter with spaces as separators.
    const ops = wordDiff('A B C A B B A', 'C B A B A C')!
    const edits = ops.filter((op) => op.kind !== 'equal').reduce((n, op) => n + tokenize(op.text).filter((t) => t.trim()).length, 0)
    expect(side(ops, 'insert')).toBe('A B C A B B A')
    expect(side(ops, 'delete')).toBe('C B A B A C')
    expect(edits).toBeLessThanOrEqual(5)
  })

  it('never cuts an emoji or a combined character in two', () => {
    const from = 'Team 👨‍👩‍👧 ships 🚀 on día 1 🇧🇷'
    const to = 'Team 👨‍👩‍👦 ships 🛳️ on día 2 🇵🇹'
    const ops = wordDiff(from, to)!
    expect(side(ops, 'insert')).toBe(from)
    expect(side(ops, 'delete')).toBe(to)
    expect(compact(ops)).toBe('Team [-👨‍👩‍👧-]{+👨‍👩‍👦+} ships [-🚀-]{+🛳️+} on día [-1 🇧🇷-]{+2 🇵🇹+}')
    for (const op of ops) {
      // No lone surrogate, no text starting with a joiner or a modifier.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(op.text)).toBe(false)
      expect(/^[‍️\u{1F3FB}-\u{1F3FF}]/u.test(op.text)).toBe(false)
    }
    expect(compact(wordDiff('café au lait', 'cafe au lait'))).toBe('[-café-]{+cafe+} au lait')
  })

  it('gives up on texts that are too large or too different, instead of taking forever', () => {
    const big = 'word '.repeat(WORD_DIFF_LIMITS.chars / 10 + 1)
    expect(wordDiff(big, big + 'x')).toBeNull()
    const many = Array.from({ length: 4100 }, (_, i) => `w${i}`).join(' ')
    expect(wordDiff(many, many.replace('w7 ', ''))).toBeNull()
    // Within the size limits but with more edits than the search allows.
    const left = Array.from({ length: 900 }, (_, i) => `a${i}`).join(' ')
    const right = Array.from({ length: 900 }, (_, i) => `b${i}`).join(' ')
    const started = performance.now()
    expect(wordDiff(left, right)).toBeNull()
    expect(performance.now() - started).toBeLessThan(2000)
    // A long text with a small change is still compared: the common ends are skipped first.
    const long = 'lorem ipsum dolor sit amet '.repeat(300)
    expect(compact(wordDiff(long + 'end', long + 'the end'))!.endsWith('{+the +}end')).toBe(true)
    expect(wordDiff('a b c', 'a x c', { chars: 4, tokens: 100, edits: 100 })).toBeNull()
    expect(wordDiff('a b c', 'a x c', { chars: 100, tokens: 4, edits: 100 })).toBeNull()
    expect(wordDiff('a b c d e', 'v w x y z', { chars: 100, tokens: 100, edits: 3 })).toBeNull()
  })
})

// ---- tree diff

const blk = (id: string, title: string, content: string[] = [], extra: Partial<SnapshotBlock> & { p?: BlockProps } = {}): SnapshotBlock => ({
  id,
  type: (extra.type ?? 'text') as BlockType,
  parentId: null,
  content,
  props: { title: title ? [[title]] : [], ...(extra.p ?? {}) },
  createdAt: 1
})

function snap(blocks: SnapshotBlock[], more: Partial<SnapshotContent> = {}): SnapshotContent {
  const [root, ...rest] = blocks
  return { rootId: root.id, blocks: [{ ...root, type: more.rows ? 'database' : root.type === 'text' ? 'page' : root.type }, ...rest], refs: [], ...more }
}

describe('diffSnapshots', () => {
  it('reports nothing for equal snapshots', () => {
    const a = snap([blk('p', 'Page', ['a', 'b']), blk('a', 'one'), blk('b', 'two')])
    const d = diffSnapshots(a, structuredClone(a))
    expect(d.identical).toBe(true)
    expect(d.counts).toEqual({ added: 0, removed: 0, changed: 0, moved: 0 })
    expect([...d.blocks.values()].every((b) => b.status === 'same' && !b.moved)).toBe(true)
    expect(d.children.get('p')).toEqual(['a', 'b'])
    expect(summarize(d.counts)).toBe('No differences')
  })

  it('finds added, removed and changed blocks by id, and shows removed ones in place', () => {
    const current = snap([blk('p', 'Page', ['a', 'gone1', 'b', 'gone2']), blk('a', 'hello world'), blk('gone1', 'x'), blk('b', 'same'), blk('gone2', 'y')])
    const version = snap([blk('p', 'Page', ['new', 'a', 'b']), blk('new', 'fresh'), blk('a', 'hello there world'), blk('b', 'same')])
    const d = diffSnapshots(current, version)
    expect(d.counts).toEqual({ added: 1, removed: 2, changed: 1, moved: 0 })
    expect(d.blocks.get('new')!.status).toBe('added')
    expect(d.blocks.get('gone1')!.status).toBe('removed')
    expect(d.blocks.get('b')).toMatchObject({ status: 'same', moved: false })
    expect(compact(d.blocks.get('a')!.text!)).toBe('hello {+there +}world')
    expect(d.children.get('p')).toEqual(['new', 'a', 'gone1', 'b', 'gone2'])
    expect(summarize(d.counts)).toBe('1 block changed, 1 added, 2 removed')
    expect(d.identical).toBe(false)
  })

  it('keeps the children of a removed block under it, and puts a removed first child first', () => {
    const current = snap([blk('p', 'P', ['first', 'a', 't']), blk('first', 'f'), blk('a', 'a'), blk('t', 'toggle', ['k1', 'k2'], { type: 'toggle' }), blk('k1', '1'), blk('k2', '2')])
    const version = snap([blk('p', 'P', ['a']), blk('a', 'a')])
    const d = diffSnapshots(current, version)
    expect(d.children.get('p')).toEqual(['first', 'a', 't'])
    expect(d.children.get('t')).toEqual(['k1', 'k2'])
    expect(d.counts.removed).toBe(4)
  })

  it('marks blocks that moved to another parent or another place', () => {
    const current = snap([blk('p', 'P', ['a', 'b', 'c', 't']), blk('a', 'a'), blk('b', 'b'), blk('c', 'c'), blk('t', 't', ['d'], { type: 'toggle' }), blk('d', 'd')])
    const version = snap([blk('p', 'P', ['c', 'a', 'b', 't', 'd']), blk('c', 'c'), blk('a', 'a'), blk('b', 'b'), blk('t', 't', [], { type: 'toggle' }), blk('d', 'd')])
    const d = diffSnapshots(current, version)
    // One block jumped over two: only that one is marked, not the two it passed.
    expect(d.blocks.get('c')).toMatchObject({ status: 'same', moved: true })
    expect(d.blocks.get('a')!.moved).toBe(false)
    expect(d.blocks.get('b')!.moved).toBe(false)
    expect(d.blocks.get('d')).toMatchObject({ status: 'same', moved: true })
    expect(d.counts).toEqual({ added: 0, removed: 0, changed: 0, moved: 2 })
    expect(summarize(d.counts)).toBe('2 blocks moved')
  })

  it('lists changed properties in words: to-dos, toggles, type, colour, formatting', () => {
    const current = snap([
      blk('p', 'P', ['todo', 'tog', 'type', 'fmt', 'code']),
      blk('todo', 'buy milk', [], { type: 'to_do', p: { checked: true } }),
      blk('tog', 'details', [], { type: 'toggle', p: { collapsed: true } }),
      blk('type', 'title', [], { type: 'heading_1', p: { color: 'red_background' } }),
      { ...blk('fmt', ''), props: { title: [['bold', [['b']]], [' text']] } },
      blk('code', 'x = 1', [], { type: 'code', p: { language: 'python' } })
    ])
    const version = snap([
      blk('p', 'P', ['todo', 'tog', 'type', 'fmt', 'code']),
      blk('todo', 'buy milk', [], { type: 'to_do' }),
      blk('tog', 'details', [], { type: 'toggle' }),
      blk('type', 'title', [], { type: 'text' }),
      blk('fmt', 'bold text'),
      blk('code', 'x = 1', [], { type: 'code' })
    ])
    const d = diffSnapshots(current, version)
    expect(d.blocks.get('todo')!.props).toEqual([{ label: 'To-do', from: 'Checked', to: 'Unchecked' }])
    expect(d.blocks.get('tog')!.props).toEqual([{ label: 'Toggle', from: 'Collapsed', to: 'Open' }])
    expect(d.blocks.get('type')!.props).toEqual([
      { label: 'Type', from: 'Heading 1', to: 'Text' },
      { label: 'Colour', from: 'Red background', to: 'Default' }
    ])
    expect(d.blocks.get('fmt')!.props).toEqual([{ label: 'Formatting', from: 'Current formatting', to: 'Formatting of this version' }])
    expect(d.blocks.get('fmt')!.text).toBeUndefined()
    expect(d.blocks.get('code')!.props).toEqual([{ label: 'Language', from: 'python', to: 'Plain text' }])
    expect(d.counts.changed).toBe(5)
  })

  it('falls back to "changed" without word marks for a very large text', () => {
    const huge = 'word '.repeat(WORD_DIFF_LIMITS.chars / 5)
    const d = diffSnapshots(snap([blk('p', 'P', ['a']), blk('a', huge)]), snap([blk('p', 'P', ['a']), blk('a', huge + 'more')]))
    expect(d.blocks.get('a')).toMatchObject({ status: 'changed', textTooLarge: true })
    expect(d.blocks.get('a')!.text).toBeUndefined()
  })

  it('compares the page itself: title, icon, cover', () => {
    const current = snap([{ ...blk('p', 'New title'), type: 'page', props: { title: [['New title']], icon: '🔥', cover: 'var(--c-red-bg)' } }])
    const version = snap([{ ...blk('p', 'Old title'), type: 'page', props: { title: [['Old title']] } }])
    const root = diffSnapshots(current, version).blocks.get('p')!
    expect(root.status).toBe('changed')
    expect(compact(root.text!)).toBe('[-New-]{+Old+} title')
    expect(root.props).toEqual([
      { label: 'Icon', from: 'Set', to: 'None' },
      { label: 'Cover', from: 'Set', to: 'None' }
    ])
  })

  it('treats nested pages as references: one the page lost is added back, one made since is kept at the end', () => {
    const current = snap([blk('p', 'P', ['young', 'a']), blk('a', 'a')], { refs: [{ id: 'young', type: 'page', title: 'Young' }] })
    const version = snap([blk('p', 'P', ['a', 'old']), blk('a', 'a')], { refs: [{ id: 'old', type: 'page', title: 'Old' }] })
    const d = diffSnapshots(current, version)
    expect(d.blocks.get('old')!.status).toBe('added')
    // Never "removed": a restore does not delete sub-pages.
    expect(d.blocks.get('young')).toMatchObject({ status: 'same', moved: true })
    expect(d.children.get('p')).toEqual(['a', 'old', 'young'])
    expect(d.counts).toEqual({ added: 1, removed: 0, changed: 0, moved: 1 })
  })

  it('compares the rows of a database cell by cell, and its schema and views', () => {
    const row = (id: string, title: string, values: SnapshotRow['values'], icon?: string): SnapshotRow => ({ id, title: [[title]], values, createdAt: 1, ...(icon ? { icon } : {}) })
    const schema = (extra: object = {}): BlockProps['schema'] =>
      ({
        title: { id: 'title', name: 'Name', type: 'title' },
        n: { id: 'n', name: 'Points', type: 'number' },
        s: { id: 's', name: 'Status', type: 'select', options: [{ id: 'o1', name: 'Done', color: 'green' }] },
        ...extra
      }) as BlockProps['schema']
    const view = (name: string) => ({ id: 'v', name, type: 'table' as const, visibleProperties: ['title'], filters: [], sorts: [] })
    const current = snap([{ ...blk('d', 'Tasks'), type: 'database', content: ['r3', 'r1', 'r2', 'new'], props: { title: [['Tasks']], schema: schema({ x: { id: 'x', name: 'Extra', type: 'text' } }), views: [view('Board')] } }], {
      rows: [row('r3', 'three', { n: 3 }), row('r1', 'one!', { n: 10, s: 'o1' }, '🔥'), row('r2', 'two', { n: 2, s: '' }), row('new', 'made later', {})]
    })
    const version = snap([{ ...blk('d', 'Tasks'), type: 'database', content: ['r1', 'r2', 'r3', 'r4'], props: { title: [['Tasks']], schema: schema(), views: [view('Table')] } }], {
      rows: [row('r1', 'one', { n: 1, s: 'o1' }), row('r2', 'two', { n: 2 }), row('r3', 'three', { n: 3 }), row('r4', 'four', { n: 4 })]
    })
    const d = diffSnapshots(current, version)
    const r1 = d.rows.get('r1')!
    expect(r1.status).toBe('changed')
    expect(compact(r1.title!)).toBe('one[-!-]')
    expect(r1.iconChanged).toBe(true)
    expect(r1.cells).toEqual([{ propertyId: 'n', from: 10, to: 1 }])
    // An empty text and an unset cell are the same empty cell.
    expect(d.rows.get('r2')).toMatchObject({ status: 'same', cells: [] })
    expect(d.rows.get('r3')).toMatchObject({ status: 'same', moved: true })
    expect(d.rows.get('r4')!.status).toBe('added')
    expect(d.rows.get('new')).toMatchObject({ status: 'same', moved: false })
    expect(d.rowOrder).toEqual(['r1', 'r2', 'r3', 'r4', 'new'])
    expect(d.schema).toEqual([
      { label: 'Property', from: 'Extra', to: 'Not there' },
      { label: 'Views', from: 'Board', to: 'Table' }
    ])
    expect(d.blocks.get('d')!.status).toBe('changed')
    expect(d.counts).toEqual({ added: 1, removed: 0, changed: 2, moved: 1 })
    expect(summarize(d.counts, 'row')).toBe('2 rows changed, 1 added, 1 moved')
  })

  it('words a single change in the singular', () => {
    expect(summarize({ added: 1, removed: 0, changed: 0, moved: 0 })).toBe('1 block added')
    expect(summarize({ added: 0, removed: 1, changed: 0, moved: 0 })).toBe('1 block removed')
    expect(summarize({ added: 2, removed: 0, changed: 1, moved: 0 })).toBe('1 block changed, 2 added')
  })
})
