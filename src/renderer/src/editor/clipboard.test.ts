import { describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType } from '@shared/types'
import {
  MAX_CLIP_DEPTH,
  MAX_CLIP_JSON_LENGTH,
  MAX_CLIP_NODES,
  buildCreateOps,
  cleanProps,
  cleanViews,
  nodesToText,
  parseClipNodes,
  parseClipboardBlocks,
  parseClipboardRichText,
  serializeBlocks,
  type ClipNode
} from './clipboard'

function node(type: string, props: unknown = {}, children: unknown = []): unknown {
  return { type, props, children }
}

function block(id: string, type: BlockType, parentId: string | null, content: string[] = [], props: BlockProps = {}): Block {
  return { id, type, parentId, content, props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

describe('parseClipNodes', () => {
  it('keeps well-formed blocks with their children', () => {
    const input = [node('to_do', { title: [['buy milk', [['b']]]], checked: true }, [node('text', { title: [['note']] })])]
    expect(parseClipNodes(input)).toEqual([
      {
        type: 'to_do',
        props: { title: [['buy milk', [['b']]]], checked: true },
        children: [{ type: 'text', props: { title: [['note']] }, children: [] }]
      }
    ])
  })

  it.each([
    ['null', null],
    ['a string', 'text'],
    ['a number', 7],
    ['an object', { type: 'text' }],
    ['an array-like object', { length: 1, 0: node('text') }]
  ])('returns nothing for %s', (_name, value) => {
    expect(parseClipNodes(value)).toEqual([])
  })

  it('skips malformed nodes and keeps the valid ones', () => {
    const input = [null, 'x', 3, [], node('text', { title: [['ok']] }), { props: {} }, { type: 5 }, { type: ['text'] }]
    expect(parseClipNodes(input).map((n) => n.props.title)).toEqual([[['ok']]])
  })

  it('only accepts allow-listed block types', () => {
    const types = ['page', 'database', 'script', 'iframe', '__proto__', 'constructor', 'toString', 'TEXT', 'text ', '']
    expect(parseClipNodes(types.map((t) => node(t)))).toEqual([])
    expect(parseClipNodes([node('text'), node('divider'), node('code')]).map((n) => n.type)).toEqual(['text', 'divider', 'code'])
  })

  it('never creates sub-pages or databases, even nested', () => {
    const input = [node('text', {}, [node('page', { title: [['x']] }), node('database', { schema: {} }), node('text')])]
    expect(parseClipNodes(input)[0].children.map((n) => n.type)).toEqual(['text'])
  })

  it('drops unknown and database props', () => {
    const props = {
      title: [['t']],
      schema: { a: { id: 'a', name: 'A', type: 'title' } },
      views: [{ id: 'v' }],
      values: { a: 1 },
      cover: 'https://evil.example/c.png',
      favorite: true,
      fullWidth: true,
      onclick: 'alert(1)',
      __proto__: { polluted: true },
      constructor: { prototype: { polluted: true } }
    }
    const [n] = parseClipNodes([node('text', props)])
    expect(n.props).toEqual({ title: [['t']] })
    expect(Object.keys(n.props)).toEqual(['title'])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('survives JSON carrying a __proto__ key', () => {
    const nodes = parseClipboardBlocks('[{"type":"text","__proto__":{"type":"page"},"props":{"__proto__":{"url":"javascript:alert(1)"}}}]')
    expect(nodes).toEqual([{ type: 'text', props: {}, children: [] }])
  })

  it('treats non-object props and non-array children as empty', () => {
    expect(parseClipNodes([node('text', 'title', 'kids')])).toEqual([{ type: 'text', props: {}, children: [] }])
    expect(parseClipNodes([node('text', [['title']], { 0: node('text') })])).toEqual([{ type: 'text', props: {}, children: [] }])
  })

  it('caps the nesting depth', () => {
    let deep: unknown = node('text')
    for (let i = 0; i < MAX_CLIP_DEPTH * 3; i++) deep = node('text', {}, [deep])
    let depth = 0
    for (let n: ClipNode | undefined = parseClipNodes([deep])[0]; n; n = n.children[0]) depth++
    expect(depth).toBe(MAX_CLIP_DEPTH)
  })

  it('caps the number of blocks across the whole payload', () => {
    const count = (nodes: ClipNode[]): number => nodes.reduce((n, x) => n + 1 + count(x.children), 0)
    const wide = Array.from({ length: MAX_CLIP_NODES + 500 }, () => node('text'))
    expect(count(parseClipNodes(wide))).toBe(MAX_CLIP_NODES)
    const fanOut = Array.from({ length: 100 }, () => node('text', {}, Array.from({ length: 100 }, () => node('text'))))
    expect(count(parseClipNodes(fanOut))).toBe(MAX_CLIP_NODES)
  })
})

describe('cleanProps', () => {
  it('validates rich text marks', () => {
    const title = [['a', [['b'], ['zz'], ['a', 'javascript:alert(1)'], ['h', 'x" onload="y']]], ['b', [['a', 'https://ok.dev']]], [1], 'x']
    expect(cleanProps('text', { title })).toEqual({ title: [['a', [['b']]], ['b', [['a', 'https://ok.dev']]]] })
    expect(cleanProps('text', { title: 'not rich text' })).toEqual({ title: [] })
  })

  it('only keeps props that belong to the block type', () => {
    const all = { title: [['t']], checked: true, collapsed: true, language: 'rust', icon: '🔥', url: 'https://x.dev', caption: [['c']] }
    expect(cleanProps('text', all)).toEqual({ title: [['t']] })
    expect(cleanProps('to_do', all)).toEqual({ title: [['t']], checked: true })
    expect(cleanProps('toggle', all)).toEqual({ title: [['t']], collapsed: true })
    expect(cleanProps('callout', all)).toEqual({ title: [['t']], icon: '🔥' })
    expect(cleanProps('code', all)).toEqual({ title: [['t']], language: 'rust' })
    expect(cleanProps('divider', all)).toEqual({})
    expect(cleanProps('image', all)).toEqual({ url: 'https://x.dev', caption: [['c']] })
    expect(cleanProps('bookmark', all)).toEqual({ url: 'https://x.dev' })
  })

  it('rejects wrongly typed values', () => {
    expect(cleanProps('to_do', { checked: 'yes' })).toEqual({})
    expect(cleanProps('toggle', { collapsed: 1 })).toEqual({})
    expect(cleanProps('callout', { icon: { toString: () => 'x' } })).toEqual({})
    expect(cleanProps('code', { language: ['rust'] })).toEqual({})
    expect(cleanProps('image', { url: ['https://x.dev/a.png'] })).toEqual({})
  })

  it('flattens code to plain text', () => {
    expect(cleanProps('code', { title: [['let ', [['b']]], ['x', [['a', 'https://x.dev']]]] })).toEqual({ title: [['let x']] })
  })

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['data html', 'data:text/html,<script>alert(1)</script>'],
    ['file', 'file:///etc/passwd'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['protocol-relative', '//evil.example/a.png'],
    ['traversal', 'sel-file://files/../../secret.png']
  ])('drops an image url that is not allowed (%s)', (_name, url) => {
    expect(cleanProps('image', { url })).toEqual({})
  })

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['data html', 'data:text/html,<script>alert(1)</script>'],
    ['file', 'file:///C:/Windows/System32/calc.exe'],
    ['mailto', 'mailto:me@example.com'],
    ['app file', 'sel-file://files/a.png']
  ])('drops a bookmark url that is not allowed (%s)', (_name, url) => {
    expect(cleanProps('bookmark', { url })).toEqual({})
  })

  it('normalises a bookmark url', () => {
    expect(cleanProps('bookmark', { url: ' example.com/a ' })).toEqual({ url: 'https://example.com/a' })
  })

  it('bounds free-form strings', () => {
    expect(cleanProps('callout', { icon: 'x'.repeat(500) })).toEqual({})
    expect(cleanProps('code', { language: 'x'.repeat(500) })).toEqual({})
    expect(cleanProps('code', { language: 'C++' })).toEqual({ language: 'c++' })
    expect(cleanProps('code', { language: 'plain text' })).toEqual({ language: 'plain text' })
    expect(cleanProps('code', { language: '"><img src=x onerror=alert(1)>' })).toEqual({})
  })

  it('only keeps palette colours', () => {
    expect(cleanProps('text', { color: 'red' })).toEqual({ color: 'red' })
    expect(cleanProps('divider', { color: 'blue_background' })).toEqual({ color: 'blue_background' })
    expect(cleanProps('text', { color: 'red is-selected' })).toEqual({})
    expect(cleanProps('text', { color: 'expression(alert(1))' })).toEqual({})
    expect(cleanProps('text', { color: 5 })).toEqual({})
  })
})

describe('linked database views', () => {
  const views = [{ id: 'v1', name: 'Table', type: 'table', visibleProperties: ['title', 'st'], filters: [], sorts: [] }]

  it('accepts a database node only as a linked view, with a well-formed sourceId', () => {
    expect(parseClipNodes([node('database', { sourceId: 'src-1', views })])).toEqual([
      { type: 'database', props: { sourceId: 'src-1', views }, children: [] }
    ])
    for (const sourceId of [undefined, null, 7, '', 'has spaces', "x'; DROP TABLE blocks;--", 'x'.repeat(65), ['src'], { id: 'src' }]) {
      expect(parseClipNodes([node('database', { sourceId, views })])).toEqual([])
    }
    // A sourceId does not smuggle any other container type in.
    expect(parseClipNodes([node('page', { sourceId: 'src-1' })])).toEqual([])
    expect(cleanProps('text', { sourceId: 'src-1' } as never)).toEqual({})
  })

  it('keeps the link, the views and the title / icon override, and nothing else', () => {
    const props = cleanProps('database', {
      sourceId: 'src-1',
      views,
      title: [['My ', [['b']]], ['tasks']],
      icon: '⭐',
      schema: { title: { id: 'title', name: 'Name', type: 'title' } },
      values: { st: 'o1' },
      favorite: true,
      cover: 'x',
      color: 'red',
      url: 'https://example.com'
    } as never)
    expect(props).toEqual({ sourceId: 'src-1', views, title: [['My tasks']], icon: '⭐' })
    expect(cleanProps('database', { sourceId: 'src-1', icon: 'x'.repeat(40), title: 7 } as never)).toEqual({ sourceId: 'src-1', views: [] })
  })

  it('never gives a linked view children', () => {
    const [parsed] = parseClipNodes([node('database', { sourceId: 'src-1' }, [node('page'), node('text', { title: [['row']] })])])
    expect(parsed.children).toEqual([])
  })

  it('rebuilds views from allow-listed fields only', () => {
    const cleaned = cleanViews([
      {
        id: 'a',
        name: 'x'.repeat(500),
        type: 'board',
        visibleProperties: ['title', 7, 'bad id', 'st'],
        filters: [
          { propertyId: 'st', operator: 'equals', value: 'o1', extra: true },
          { propertyId: 'st', operator: 'drop table' },
          { propertyId: 'bad id', operator: 'equals' },
          { propertyId: 'n', operator: 'gt', value: Infinity },
          { propertyId: 'd', operator: 'equals', value: { start: '2026-01-02', end: '2026-01-03', evil: 1 } },
          { propertyId: 'm', operator: 'contains', value: ['o1', 5, 'o2'] },
          'nope'
        ],
        sorts: [{ propertyId: 'st', direction: 'sideways' }, { propertyId: 'due', direction: 'desc' }, null],
        propertyWidths: { st: 120, title: '200', 'bad id': 50, n: NaN },
        groupBy: 'st',
        __proto__: { polluted: true },
        onClick: 'alert(1)'
      },
      { id: 'a', name: 'Same id', type: 'table' },
      { id: 'b', name: 'Unknown type', type: 'timeline' },
      { id: 'bad id', type: 'table' },
      null,
      'view',
      { id: 'c', type: 'list', groupBy: 9 }
    ])
    expect(cleaned).toEqual([
      {
        id: 'a',
        name: 'x'.repeat(100),
        type: 'board',
        visibleProperties: ['title', 'st'],
        filters: [
          { propertyId: 'st', operator: 'equals', value: 'o1' },
          { propertyId: 'n', operator: 'gt' },
          { propertyId: 'd', operator: 'equals', value: { start: '2026-01-02', end: '2026-01-03' } },
          { propertyId: 'm', operator: 'contains', value: ['o1', 'o2'] }
        ],
        sorts: [
          { propertyId: 'st', direction: 'asc' },
          { propertyId: 'due', direction: 'desc' }
        ],
        propertyWidths: { st: 120 },
        groupBy: 'st'
      },
      { id: 'c', name: '', type: 'list', visibleProperties: [], filters: [], sorts: [] }
    ])
    expect(Object.keys(cleaned[0])).not.toContain('onClick')
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
    for (const bad of [undefined, null, 'views', 7, { length: 3 }]) expect(cleanViews(bad)).toEqual([])
  })

  it('keeps the figures of a calculations view, and its place beside the block before it', () => {
    const calcs = [{ id: 'c1', name: 'Total', formula: 'sum(Points)', format: 'number' }]
    const cleaned = cleanViews([{ id: 'v', type: 'calc', calcs: [...calcs, { id: 'c2', name: 'No formula' }, 'junk'] }, { id: 'w', type: 'table', calcs: 'junk' }])
    expect(cleaned[0]).toEqual({ id: 'v', name: '', type: 'calc', visibleProperties: [], filters: [], sorts: [], calcs })
    expect(cleaned[1]).not.toHaveProperty('calcs')
    expect(cleanProps('database', { sourceId: 'src-1', beside: true } as never)).toEqual({ sourceId: 'src-1', views: [], beside: true })
    expect(cleanProps('database', { sourceId: 'src-1', beside: 'yes' } as never)).toEqual({ sourceId: 'src-1', views: [] })
    expect(cleanProps('text', { beside: true } as never)).toEqual({})
  })

  it('bounds the number of views and of items in a view', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `v${i}`, type: 'table' }))
    expect(cleanViews(many)).toHaveLength(50)
    const wide = cleanViews([{ id: 'v', type: 'table', visibleProperties: Array.from({ length: 500 }, (_, i) => `p${i}`) }])
    expect(wide[0].visibleProperties).toHaveLength(200)
  })

  it('copies a linked view as another view of the same source, and leaves real databases out', () => {
    const blocks = new Map<string, Block>([
      ['lv', block('lv', 'database', 'p', ['stray'], { sourceId: 'src-1', views: views as never, title: [['Mine']], schema: {} })],
      ['stray', block('stray', 'page', 'lv')],
      ['db', block('db', 'database', 'p', ['row'], { schema: {}, views: [] })],
      ['self', block('self', 'database', 'p', [], { sourceId: 'self', views: [] })],
      ['t', block('t', 'text', 'p', [], { title: [['text']] })]
    ])
    const nodes = serializeBlocks((id) => blocks.get(id), ['lv', 'db', 'self', 't'])
    expect(nodes).toEqual([
      { type: 'database', props: { sourceId: 'src-1', views, title: [['Mine']] }, children: [] },
      { type: 'text', props: { title: [['text']] }, children: [] }
    ])
    // Through the clipboard and back: unchanged.
    expect(parseClipboardBlocks(JSON.stringify(nodes))).toEqual(nodes)

    let n = 0
    const { ops, ids } = buildCreateOps(nodes, 'target', 'after-me', () => `new-${++n}`)
    expect(ids).toEqual(['new-1', 'new-2'])
    expect(ops[0]).toEqual({
      op: 'create',
      input: { id: 'new-1', type: 'database', parentId: 'target', afterId: 'after-me', props: { sourceId: 'src-1', views, title: [['Mine']] } }
    })
    // The pasted view does not share its views array with the original.
    const created = ops[0].op === 'create' ? ops[0].input.props : undefined
    expect(created?.views).not.toBe(views)
  })
})

describe('clipboard strings', () => {
  it('parses valid JSON and ignores everything else', () => {
    expect(parseClipboardBlocks(JSON.stringify([node('quote', { title: [['q']] })]))).toEqual([
      { type: 'quote', props: { title: [['q']] }, children: [] }
    ])
    expect(parseClipboardBlocks('')).toEqual([])
    expect(parseClipboardBlocks('{not json')).toEqual([])
    expect(parseClipboardBlocks('"text"')).toEqual([])
    expect(parseClipboardBlocks('null')).toEqual([])
  })

  it('refuses over-sized payloads without parsing them', () => {
    const huge = `[${'{"type":"text"},'.repeat(MAX_CLIP_JSON_LENGTH / 16)}{"type":"text"}]`
    expect(huge.length).toBeGreaterThan(MAX_CLIP_JSON_LENGTH)
    expect(parseClipboardBlocks(huge)).toEqual([])
    expect(parseClipboardRichText(`[["${'a'.repeat(MAX_CLIP_JSON_LENGTH)}"]]`)).toEqual([])
  })

  it('validates inline rich text', () => {
    expect(parseClipboardRichText('[["a",[["b"],["a","javascript:alert(1)"]]],["b"],[3],"x"]')).toEqual([['a', [['b']]], ['b']])
    expect(parseClipboardRichText('<b>html</b>')).toEqual([])
    expect(parseClipboardRichText('{"0":["a"]}')).toEqual([])
  })
})

describe('serializeBlocks / buildCreateOps', () => {
  const world = new Map<string, Block>(
    [
      block('page', 'page', null, ['a', 'sub', 'db']),
      block('a', 'toggle', 'page', ['a1', 'inner'], { title: [['A']], collapsed: true, color: 'red' }),
      block('a1', 'to_do', 'a', [], { title: [['A1']], checked: true }),
      block('inner', 'page', 'a', [], { title: [['Inner page']] }),
      block('sub', 'page', 'page', [], { title: [['Sub']], cover: 'var(--c-blue-bg)', favorite: true }),
      block('db', 'database', 'page', [], { title: [['DB']], schema: {}, views: [] })
    ].map((b) => [b.id, b])
  )
  const get = (id: string): Block | undefined => world.get(id)

  it('snapshots blocks with their children, leaving sub-pages and databases out', () => {
    expect(serializeBlocks(get, ['a', 'sub', 'db', 'missing'])).toEqual([
      {
        type: 'toggle',
        props: { title: [['A']], collapsed: true, color: 'red' },
        children: [{ type: 'to_do', props: { title: [['A1']], checked: true }, children: [] }]
      }
    ])
  })

  it('round-trips through JSON and the validator unchanged', () => {
    const nodes = serializeBlocks(get, ['a'])
    expect(parseClipboardBlocks(JSON.stringify(nodes))).toEqual(nodes)
  })

  it('creates the subtree with fresh ids, parents before children', () => {
    let n = 0
    const { ops, ids } = buildCreateOps(serializeBlocks(get, ['a']), 'page', 'a', () => `new${++n}`)
    expect(ids).toEqual(['new1'])
    expect(ops).toEqual([
      { op: 'create', input: { id: 'new1', type: 'toggle', parentId: 'page', afterId: 'a', props: { title: [['A']], collapsed: true, color: 'red' } } },
      { op: 'create', input: { id: 'new2', type: 'to_do', parentId: 'new1', afterId: null, props: { title: [['A1']], checked: true } } }
    ])
  })

  it('chains top-level nodes after one another and does not share props with the source', () => {
    const nodes: ClipNode[] = [
      { type: 'text', props: { title: [['x']] }, children: [] },
      { type: 'text', props: { title: [['y']] }, children: [] }
    ]
    let n = 0
    const { ops, ids } = buildCreateOps(nodes, 'page', null, () => `n${++n}`)
    expect(ids).toEqual(['n1', 'n2'])
    expect(ops.map((op) => (op.op === 'create' ? op.input.afterId : undefined))).toEqual([null, 'n1'])
    const first = ops[0]
    expect(first.op === 'create' && first.input.props).not.toBe(nodes[0].props)
  })
})

describe('nodesToText', () => {
  it('writes Markdown-ish text with numbering and indentation', () => {
    const nodes: ClipNode[] = [
      { type: 'heading_1', props: { title: [['Title']] }, children: [] },
      { type: 'numbered_list', props: { title: [['one']] }, children: [{ type: 'bulleted_list', props: { title: [['sub']] }, children: [] }] },
      { type: 'numbered_list', props: { title: [['two']] }, children: [] },
      { type: 'to_do', props: { title: [['done']], checked: true }, children: [] },
      { type: 'code', props: { title: [['x = 1']], language: 'python' }, children: [] },
      { type: 'divider', props: {}, children: [] }
    ]
    expect(nodesToText(nodes)).toEqual(['# Title', '1. one', '  - sub', '2. two', '- [x] done', '```python', 'x = 1', '```', '---'])
  })
})
