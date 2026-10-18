import { beforeEach, describe, expect, it } from 'vitest'
import { plainText } from '../shared/richtext'
import type { Repository } from './db/repository'
import { openTestRepository } from './db/testing'
import { importMarkdownText, inlineToMarkdown, pageToMarkdown, parseInline, parseMarkdown, safeFileName } from './markdown'

let repo: Repository

beforeEach(() => {
  repo = openTestRepository()
})

describe('inline marks', () => {
  it('serializes marks and escapes markdown syntax', () => {
    expect(
      inlineToMarkdown([
        ['plain *star* '],
        ['bold ', [['b']]],
        ['both', [['b'], ['i']]],
        [' '],
        ['gone', [['s']]],
        [' '],
        ['a_b()', [['c']]],
        [' '],
        ['site', [['a', 'https://example.com/a b']]],
        ['u', [['u']]]
      ])
    ).toBe('plain \\*star\\* **bold** ***both*** ~~gone~~ `a_b()` [site](https://example.com/a%20b)<u>u</u>')
  })

  it('parses marks back', () => {
    expect(parseInline('a **b** *i* _i2_ ~~s~~ `c*d` [l](https://x.dev) snake_case 2 * 3')).toEqual([
      ['a '],
      ['b', [['b']]],
      [' '],
      ['i', [['i']]],
      [' '],
      ['i2', [['i']]],
      [' '],
      ['s', [['s']]],
      [' '],
      ['c*d', [['c']]],
      [' '],
      ['l', [['a', 'https://x.dev']]],
      [' snake_case 2 * 3']
    ])
    expect(parseInline('***x*** and **a *b* c**')).toEqual([
      ['x', [['b'], ['i']]],
      [' and '],
      ['a ', [['b']]],
      ['b', [['b'], ['i']]],
      [' c', [['b']]]
    ])
    expect(parseInline('\\*not\\* \\[link\\]')).toEqual([['*not* [link]']])
  })
})

describe('export', () => {
  it('writes blocks, nesting and a database table', () => {
    const p = repo.create({ type: 'page', parentId: null, props: { title: [['My Page']] } })
    const add = (type: Parameters<Repository['create']>[0]['type'], props = {}, parentId = p.id): string =>
      repo.create({ type, parentId, props }).id
    add('heading_2', { title: [['Section']] })
    add('text', { title: [['Hello '], ['world', [['b']]]] })
    const li = add('bulleted_list', { title: [['one']] })
    add('to_do', { title: [['nested']], checked: true }, li)
    add('bulleted_list', { title: [['two']] })
    add('numbered_list', { title: [['first']] })
    add('numbered_list', { title: [['second']] })
    add('quote', { title: [['wise\nwords']] })
    add('code', { title: [['let a = `1`\n```']], language: 'js' })
    add('divider')
    add('image', { url: 'sel-file://files/abc.png', caption: [['cap']] })
    add('text', { title: [['# not a heading']] })
    const sub = add('page', { title: [['Child']] })
    const db = add('database', {
      title: [['Tasks']],
      schema: {
        title: { id: 'title', name: 'Name', type: 'title' },
        st: { id: 'st', name: 'Status', type: 'select', options: [{ id: 'o1', name: 'Done', color: 'green' }] },
        ok: { id: 'ok', name: 'OK', type: 'checkbox' },
        d: { id: 'd', name: 'When', type: 'date' }
      },
      views: [{ id: 'v', name: 'T', type: 'table', visibleProperties: ['title', 'st', 'ok', 'd'], filters: [], sorts: [] }]
    })
    add('page', { title: [['Row | A']], values: { st: 'o1', ok: true, d: { start: '2026-01-02' } } }, db)

    expect(pageToMarkdown(repo, p.id)).toEqual({
      title: 'My Page',
      markdown: [
        '# My Page',
        '',
        '## Section',
        '',
        'Hello **world**',
        '',
        '- one',
        '    - [x] nested',
        '- two',
        '1. first',
        '2. second',
        '',
        '> wise  ',
        '> words',
        '',
        '````js',
        'let a = `1`',
        '```',
        '````',
        '',
        '---',
        '',
        '![cap](sel-file://files/abc.png)',
        '',
        '\\# not a heading',
        '',
        `[Child](sel://page/${sub})`,
        '',
        '**Tasks**',
        '',
        '| Name | Status | OK | When |',
        '| --- | --- | --- | --- |',
        '| Row \\| A | Done | ☑ | 2026-01-02 |',
        ''
      ].join('\n')
    })
  })
})

describe('import', () => {
  const source = [
    '---',
    'tags: x',
    '---',
    '# Imported *Title*',
    '',
    'First paragraph',
    'continues here.',
    '',
    '## Heading',
    '#### Deep',
    '- item **one**',
    '  - child',
    '    1. grandchild',
    '- [x] done',
    '- [ ] todo',
    '',
    '> quoted',
    '> text',
    '',
    '```ts',
    'const a = 1',
    '  indented()',
    '```',
    '***',
    '![alt text](https://example.com/i.png)',
    '![bad](javascript:alert(1))',
    '',
    '| Name | Qty |',
    '|------|----:|',
    '| Apple | 3 |',
    '| Pear | |'
  ].join('\r\n')

  it('parses a practical subset into blocks', () => {
    const { title, nodes } = parseMarkdown(source)
    expect(title).toBe('Imported Title')
    expect(nodes.map((n) => n.type)).toEqual([
      'text',
      'heading_2',
      'heading_3',
      'bulleted_list',
      'to_do',
      'to_do',
      'quote',
      'code',
      'divider',
      'image',
      'text',
      'database'
    ])
    expect(nodes[0].props.title).toEqual([['First paragraph continues here.']])
    expect(nodes[3].props.title).toEqual([['item '], ['one', [['b']]]])
    expect(nodes[3].children[0].type).toBe('bulleted_list')
    expect(nodes[3].children[0].children[0]).toMatchObject({ type: 'numbered_list', props: { title: [['grandchild']] } })
    expect(nodes[4].props.checked).toBe(true)
    expect(nodes[5].props.checked).toBe(false)
    expect(plainText(nodes[6].props.title)).toBe('quoted\ntext')
    expect(nodes[7].props).toEqual({ title: [['const a = 1\n  indented()']], language: 'ts' })
    expect(nodes[9].props).toEqual({ url: 'https://example.com/i.png', caption: [['alt text']] })
    expect(nodes[11].children.map((r) => [plainText(r.props.title), r.props.values])).toEqual([
      ['Apple', { col1: '3' }],
      ['Pear', {}]
    ])
  })

  it('creates a page atomically and falls back to the file name for the title', () => {
    const parent = repo.create({ type: 'page', parentId: null })
    const page = importMarkdownText(repo, source, parent.id)
    expect(plainText(page.props.title)).toBe('Imported Title')
    expect(page.parentId).toBe(parent.id)
    expect(repo.get(parent.id)!.content).toEqual([page.id])
    expect(repo.children(page.id)).toHaveLength(12)
    const db = repo.children(page.id)[11]
    expect(repo.children(db.id).map((r) => plainText(r.props.title))).toEqual(['Apple', 'Pear'])

    const untitled = importMarkdownText(repo, 'just text', null, 'notes')
    expect(plainText(untitled.props.title)).toBe('notes')
    expect(repo.listRoot().map((b) => b.id)).toEqual([parent.id, untitled.id])
  })

  it('round-trips an exported page', () => {
    const p = importMarkdownText(repo, source, null)
    const once = pageToMarkdown(repo, p.id).markdown
    const again = pageToMarkdown(repo, importMarkdownText(repo, once, null).id).markdown
    expect(again).toBe(once)
  })
})

describe('equation blocks', () => {
  const tex = '\\begin{aligned}\n  a &= b + c \\\\\n  d &= \\frac{e}{f}\n\\end{aligned}'

  it('export as display math between $$ lines', () => {
    const p = repo.create({ type: 'page', parentId: null, props: { title: [['Math']] } })
    repo.create({ type: 'equation', parentId: p.id, props: { title: [[tex]] } })
    repo.create({ type: 'equation', parentId: p.id, props: { title: [] } })
    repo.create({ type: 'text', parentId: p.id, props: { title: [['after']] } })
    expect(pageToMarkdown(repo, p.id).markdown).toBe(`# Math\n\n$$\n${tex}\n$$\n\nafter\n`)
  })

  it('import from $$ lines, one-line $$…$$ and inside a list', () => {
    const { nodes } = parseMarkdown('$$\nx^2\n$$\n\n$$ E = mc^2 $$\n\n- item\n\n    $$\n    \\sum_i i\n    $$\n\ncost $$5 and $$6')
    expect(nodes.map((n) => [n.type, plainText(n.props.title)])).toEqual([
      ['equation', 'x^2'],
      ['equation', 'E = mc^2'],
      ['bulleted_list', 'item'],
      ['text', 'cost $$5 and $$6']
    ])
    expect(nodes[2].children.map((n) => [n.type, plainText(n.props.title)])).toEqual([['equation', '\\sum_i i']])
  })

  it('leave an unclosed $$ as text', () => {
    const { nodes } = parseMarkdown('$$ no end\n\nmore')
    expect(nodes.map((n) => n.type)).toEqual(['text', 'text'])
  })

  it('round-trip through export and import', () => {
    const p = repo.create({ type: 'page', parentId: null, props: { title: [['Math']] } })
    repo.create({ type: 'equation', parentId: p.id, props: { title: [[tex]] } })
    repo.create({ type: 'text', parentId: p.id, props: { title: [['between']] } })
    repo.create({ type: 'equation', parentId: p.id, props: { title: [['e^{i\\pi} + 1 = 0']] } })
    const once = pageToMarkdown(repo, p.id).markdown
    const copy = importMarkdownText(repo, once, null)
    expect(repo.children(copy.id).map((b) => [b.type, plainText(b.props.title)])).toEqual([
      ['equation', tex],
      ['text', 'between'],
      ['equation', 'e^{i\\pi} + 1 = 0']
    ])
    expect(pageToMarkdown(repo, copy.id).markdown).toBe(once)
  })
})

describe('hostile input', () => {
  const within = (ms: number, fn: () => void): void => {
    const start = performance.now()
    fn()
    expect(performance.now() - start).toBeLessThan(ms)
  }
  const spaces = ' '.repeat(200_000)

  // Quadratic before the parser was hardened: regex backtracking, or a rescan of the paragraph per delimiter.
  it.each([
    ['unclosed emphasis', '*a '.repeat(150_000)],
    ['unclosed underscores', '_a '.repeat(150_000)],
    ['unclosed strike', '~~a '.repeat(100_000)],
    ['unclosed code spans', '`a `` '.repeat(80_000)],
    ['unclosed links', '['.repeat(300_000)],
    ['links without a target', '[a]('.repeat(100_000)],
    ['unclosed <u>', '<u>'.repeat(100_000)],
    ['heading with a long whitespace run', `# a${spaces}b`],
    ['table divider with a long whitespace run', `a | b\n---${spaces}x`],
    ['fence info with a stray backtick', '```' + 'a'.repeat(200_000) + '`'],
    ['paragraph with a long whitespace run', `a${spaces}b\n\nc`],
    ['quote with a long whitespace run', `> a${spaces}b`],
    ['many tiny blocks', 'a\n\n'.repeat(60_000)]
  ])('parses %s in bounded time', (_name, source) => {
    within(5000, () => parseMarkdown(source))
  })

  it('stays linear when exporting text with long whitespace runs', () => {
    const p = repo.create({ type: 'page', parentId: null, props: { title: [[`T${'.'.repeat(100_000)}x`]] } })
    repo.create({ type: 'text', parentId: p.id, props: { title: [[`a${spaces}b`, [['b']]]] } })
    within(5000, () => pageToMarkdown(repo, p.id))
    within(1000, () => safeFileName(`a${'.'.repeat(1_000_000)}b`))
    expect(safeFileName('a/b\\c:d*e?"<>|.. ')).toBe('a b c d e')
    expect(safeFileName('CON')).toBe('Untitled')
    expect(safeFileName('../../etc/passwd')).toBe('.. .. etc passwd')
    expect(inlineToMarkdown([['  bold  ', [['b']]]])).toBe('  **bold**  ')
    expect(inlineToMarkdown([['   ', [['b']]]])).toBe('   ')
  })

  it('still parses inline syntax after a budget-draining document', () => {
    parseMarkdown('*a '.repeat(150_000))
    expect(parseInline('**bold**')).toEqual([['bold', [['b']]]])
    expect(parseMarkdown('**bold**').nodes[0].props.title).toEqual([['bold', [['b']]]])
  })

  it('imports a large document quickly and refuses absurd ones', () => {
    const source = '- item\n'.repeat(20_000)
    let pageId = ''
    within(20_000, () => {
      pageId = importMarkdownText(repo, source, null).id
    })
    expect(repo.get(pageId)?.content).toHaveLength(20_000)
    expect(() => importMarkdownText(repo, 'a\n\n'.repeat(200_001), null)).toThrow('too many blocks')
    expect(() => importMarkdownText(repo, 'x'.repeat(10 * 1024 * 1024 + 1), null)).toThrow('too large')
    expect(repo.listRoot()).toHaveLength(1)
  })

  it('caps list nesting', () => {
    const source = Array.from({ length: 200 }, (_, i) => `${' '.repeat(i * 2)}- level ${i}`).join('\n')
    let depth = 0
    for (let node = parseMarkdown(source).nodes[0]; node; node = node.children[0]) depth++
    expect(depth).toBeLessThanOrEqual(33)
  })

  it('drops link targets the app would never open', () => {
    expect(parseInline('[x](file:///C:/Windows/win.ini)')).toEqual([['x']])
    expect(parseInline('[x](javascript:alert)')).toEqual([['x']])
    expect(parseInline('[x](data:text/html,hi)')).toEqual([['x']])
    expect(parseInline('[x](vbscript:msgbox)')).toEqual([['x']])
    expect(parseInline('[x](//evil.test/a)')).toEqual([['x']])
    expect(parseInline('[x](https://example.com)')).toEqual([['x', [['a', 'https://example.com']]]])
    expect(parseInline('[x](mailto:a@example.com)')).toEqual([['x', [['a', 'mailto:a@example.com']]]])
    expect(parseInline('[x](sel://page/abc)')).toEqual([['x', [['a', 'sel://page/abc']]]])
  })

  it('imports only safe image sources as image blocks', () => {
    const types = (src: string): string[] => parseMarkdown(src).nodes.map((n) => n.type)
    expect(types('![a](https://example.com/a.png)')).toEqual(['image'])
    expect(types('![a](sel-file://files/a.png)')).toEqual(['image'])
    expect(types('![a](file:///C:/secret.png)')).toEqual(['text'])
    expect(types('![a](javascript:alert)')).toEqual(['text'])
    expect(types('![a](data:image/svg+xml;base64,AAAA)')).toEqual(['text'])
    expect(types('![a](data:text/html;base64,AAAA)')).toEqual(['text'])
  })

  it('keeps headings, hard breaks and fences working', () => {
    const { title, nodes } = parseMarkdown(
      '# Title ##\n\n## Sub #\n\n### C#\n\nline one  \nline two\\\nline three\n\n```ts linenums\ncode\n```'
    )
    expect(title).toBe('Title')
    expect(nodes.map((n) => plainText(n.props.title))).toEqual(['Sub', 'C#', 'line one\nline two\nline three', 'code'])
    expect(nodes[3].props.language).toBe('ts')
  })
})
