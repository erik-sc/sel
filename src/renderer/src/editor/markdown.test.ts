import { describe, expect, it } from 'vitest'
import {
  applyInlineShortcut,
  detectBlockShortcut,
  detectInlineShortcut,
  parseInlineMarkdown,
  parseMarkdownBlocks,
  parseMarkdownNodes
} from './markdown'
import { defaultDatabaseProps, filterSlashItems, isCssCover, COVER_PRESETS } from './blockTypes'

describe('detectBlockShortcut', () => {
  it('detects headings', () => {
    expect(detectBlockShortcut('# ')).toEqual({ type: 'heading_1' })
    expect(detectBlockShortcut('## ')).toEqual({ type: 'heading_2' })
    expect(detectBlockShortcut('### ')).toEqual({ type: 'heading_3' })
    expect(detectBlockShortcut('#### ')).toBeNull()
  })

  it('detects lists and to-dos', () => {
    expect(detectBlockShortcut('- ')?.type).toBe('bulleted_list')
    expect(detectBlockShortcut('* ')?.type).toBe('bulleted_list')
    expect(detectBlockShortcut('1. ')?.type).toBe('numbered_list')
    expect(detectBlockShortcut('12. ')?.type).toBe('numbered_list')
    expect(detectBlockShortcut('[] ')).toEqual({ type: 'to_do', props: { checked: false } })
    expect(detectBlockShortcut('[ ] ')).toEqual({ type: 'to_do', props: { checked: false } })
    expect(detectBlockShortcut('[x] ')).toEqual({ type: 'to_do', props: { checked: true } })
  })

  it('detects quote, toggle, code and divider', () => {
    expect(detectBlockShortcut('> ')?.type).toBe('quote')
    expect(detectBlockShortcut('>> ')?.type).toBe('toggle')
    expect(detectBlockShortcut('```')?.type).toBe('code')
    expect(detectBlockShortcut('---')?.type).toBe('divider')
  })

  it('ignores anything that is not exactly a trigger', () => {
    for (const s of ['', '#', '-', '--', 'a# ', ' # ', '1.', '1) ', 'x- ', '``', '> x']) {
      expect(detectBlockShortcut(s)).toBeNull()
    }
  })
})

describe('detectInlineShortcut', () => {
  const at = (s: string) => detectInlineShortcut(s, s.length)

  it('detects bold, italic, code and strike at the caret', () => {
    expect(at('say **hi**')).toEqual({ start: 4, end: 10, delimLength: 2, mark: ['b'] })
    expect(at('say *hi*')).toEqual({ start: 4, end: 8, delimLength: 1, mark: ['i'] })
    expect(at('say `hi`')).toEqual({ start: 4, end: 8, delimLength: 1, mark: ['c'] })
    expect(at('say ~~hi~~')).toEqual({ start: 4, end: 10, delimLength: 2, mark: ['s'] })
    expect(at('_hi_')?.mark).toEqual(['i'])
  })

  it('does not fire while a bold is still being typed', () => {
    expect(at('**bold*')).toBeNull()
    expect(at('**')).toBeNull()
    expect(at('***')).toBeNull()
    expect(at('****')).toBeNull()
  })

  it('requires content without surrounding whitespace', () => {
    expect(at('a * b *')).toBeNull()
    expect(at('** x**')).toBeNull()
    expect(at('``')).toBeNull()
    expect(at('2 * 3 * 4*')).toBeNull()
  })

  it('leaves snake_case alone', () => {
    expect(at('my_var_')).toBeNull()
    expect(at('a _b_')?.start).toBe(2)
  })

  it('only looks at text before the caret', () => {
    expect(detectInlineShortcut('*a* tail', 3)).toEqual({ start: 0, end: 3, delimLength: 1, mark: ['i'] })
    expect(detectInlineShortcut('*a* tail', 8)).toBeNull()
  })
})

describe('applyInlineShortcut', () => {
  it('removes the delimiters and marks the inner text', () => {
    const text = 'say **hi** now'
    const m = detectInlineShortcut(text, 10)
    expect(m).not.toBeNull()
    const r = applyInlineShortcut([[text]], m!)
    expect(r.rt).toEqual([['say '], ['hi', [['b']]], [' now']])
    expect(r.caret).toBe(6)
  })

  it('keeps marks that were already inside', () => {
    const m = detectInlineShortcut('*ab*', 4)!
    const r = applyInlineShortcut([['*a'], ['b', [['b']]], ['*']], m)
    expect(r.rt).toEqual([
      ['a', [['i']]],
      ['b', [['b'], ['i']]]
    ])
    expect(r.caret).toBe(2)
  })
})

describe('parseInlineMarkdown', () => {
  it('parses the basic inline marks', () => {
    expect(parseInlineMarkdown('a **b** *c* `d` ~~e~~')).toEqual([
      ['a '],
      ['b', [['b']]],
      [' '],
      ['c', [['i']]],
      [' '],
      ['d', [['c']]],
      [' '],
      ['e', [['s']]]
    ])
  })

  it('parses safe links and leaves unsafe ones as text', () => {
    expect(parseInlineMarkdown('[site](https://x.dev)')).toEqual([['site', [['a', 'https://x.dev']]]])
    expect(parseInlineMarkdown('[x](javascript:alert(1))')).toEqual([['[x](javascript:alert(1))']])
  })

  it('returns plain text untouched', () => {
    expect(parseInlineMarkdown('2 * 3 = 6')).toEqual([['2 * 3 = 6']])
    expect(parseInlineMarkdown('')).toEqual([])
  })

  it('reads underscore emphasis, but not inside snake_case words', () => {
    expect(parseInlineMarkdown('__forte__ e _leve_')).toEqual([['forte', [['b']]], [' e '], ['leve', [['i']]]])
    expect(parseInlineMarkdown('call my_var_name now')).toEqual([['call my_var_name now']])
    expect(parseInlineMarkdown('ação_x_y')).toEqual([['ação_x_y']])
  })
})

describe('parseMarkdownBlocks', () => {
  it('creates one block per non-empty line with block detection', () => {
    const blocks = parseMarkdownBlocks(
      ['# Title', '', 'plain', '- item', '* item2', '1. one', '2) two', '- [ ] todo', '[x] done', '> quote', '---'].join('\r\n')
    )
    expect(blocks.map((b) => b.type)).toEqual([
      'heading_1',
      'text',
      'bulleted_list',
      'bulleted_list',
      'numbered_list',
      'numbered_list',
      'to_do',
      'to_do',
      'quote',
      'divider'
    ])
    expect(blocks[0].title).toEqual([['Title']])
    expect(blocks[6].props).toEqual({ checked: false })
    expect(blocks[7].props).toEqual({ checked: true })
    expect(blocks[7].title).toEqual([['done']])
  })

  it('collects fenced code into a single code block', () => {
    const blocks = parseMarkdownBlocks('before\n```ts\nconst a = 1\n\n  b()\n```\nafter')
    expect(blocks).toEqual([
      { type: 'text', title: [['before']] },
      { type: 'code', title: [['const a = 1\n\n  b()']], props: { language: 'ts' } },
      { type: 'text', title: [['after']] }
    ])
  })

  it('handles an unterminated fence and empty input', () => {
    expect(parseMarkdownBlocks('```\nx')).toEqual([{ type: 'code', title: [['x']], props: undefined }])
    expect(parseMarkdownBlocks(' \n\n')).toEqual([])
  })

  it('applies inline marks inside lines', () => {
    expect(parseMarkdownBlocks('## a **b**')[0]).toEqual({ type: 'heading_2', title: [['a '], ['b', [['b']]]] })
  })

  it('joins consecutive quote lines and maps deeper headings to the smallest', () => {
    expect(parseMarkdownBlocks('> one\n> two\n>\n> three\nafter')).toEqual([
      { type: 'quote', title: [['one\ntwo\n\nthree']] },
      { type: 'text', title: [['after']] }
    ])
    expect(parseMarkdownBlocks('#### four\n###### six').map((b) => b.type)).toEqual(['heading_3', 'heading_3'])
  })
})

describe('parseMarkdownNodes', () => {
  const outline = (nodes: ReturnType<typeof parseMarkdownNodes>): unknown[] =>
    nodes.map((n) => {
      const head = `${n.type}: ${(n.props.title ?? []).map((s) => s[0]).join('')}`
      return n.children.length ? [head, outline(n.children)] : head
    })

  it('nests indented list items under the item above', () => {
    const nodes = parseMarkdownNodes(['- one', '  - one.a', '    1. deep', '  - one.b', '- two', '\t- tabbed', '- [x] done'].join('\n'))
    expect(outline(nodes)).toEqual([
      ['bulleted_list: one', [['bulleted_list: one.a', ['numbered_list: deep']], 'bulleted_list: one.b']],
      ['bulleted_list: two', ['bulleted_list: tabbed']],
      'to_do: done'
    ])
    expect(nodes[2].props.checked).toBe(true)
  })

  it('keeps a code fence inside a list item, without the item indentation', () => {
    const nodes = parseMarkdownNodes(['1. step', '   ```sh', '   npm test', '     --watch', '   ```', '2. next'].join('\n'))
    expect(outline(nodes)).toEqual([['numbered_list: step', ['code: npm test\n  --watch']], 'numbered_list: next'])
    expect(nodes[0].children[0].props.language).toBe('sh')
  })

  it('leaves plain lines, headings and indented text outside of lists flat', () => {
    const nodes = parseMarkdownNodes(['- item', '## Heading', '  indented', 'Rua A, 1', 'São Paulo'].join('\n'))
    expect(outline(nodes)).toEqual(['bulleted_list: item', 'heading_2: Heading', 'text: indented', 'text: Rua A, 1', 'text: São Paulo'])
  })

  it('stays within the clipboard depth on absurd indentation', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `${' '.repeat(i)}- level ${i}`)
    let depth = 0
    for (let n = parseMarkdownNodes(lines.join('\n')); n.length; n = n[0].children) depth++
    expect(depth).toBeLessThanOrEqual(32)
  })
})

describe('block catalogue', () => {
  it('filters slash items by label and keyword', () => {
    expect(filterSlashItems('').length).toBeGreaterThan(15)
    expect(filterSlashItems('h1')[0].type).toBe('heading_1')
    expect(filterSlashItems('todo')[0].type).toBe('to_do')
    expect(filterSlashItems('data').map((i) => i.view ?? i.id)).toEqual(['table', 'board', 'list', 'db-linked'])
    // The linked view is found by each of its keywords, and by its label.
    for (const query of ['linked', 'source', 'view', 'database', 'Linked database']) {
      expect(filterSlashItems(query).some((i) => i.linked)).toBe(true)
    }
    expect(filterSlashItems('linked')[0].id).toBe('db-linked')
    expect(filterSlashItems('zzzz')).toEqual([])
  })

  it('finds slash items by their Portuguese words, accents and case aside', () => {
    const first = (query: string): string | undefined => filterSlashItems(query)[0]?.id
    expect(first('titulo')).toBe('h1')
    expect(first('Título')).toBe('h1')
    expect(first('subtitulo')).toBe('h2')
    expect(first('tarefa')).toBe('todo')
    expect(first('citacao')).toBe('quote')
    expect(first('imagem')).toBe('image')
    expect(first('codigo')).toBe('code')
    expect(first('divisor')).toBe('divider')
    expect(first('reuniao')).toBe('meeting')
    expect(first('grafico')).toBe('chart')
    expect(
      filterSlashItems('lista')
        .map((i) => i.id)
        .slice(0, 3)
    ).toEqual(['bullet', 'number', 'todo'])
    expect(filterSlashItems('banco de dados').map((i) => i.id)).toEqual(['db-table', 'db-board', 'db-list', 'db-linked'])
    expect(filterSlashItems('resumir', true)[0].id).toBe('ai-summarize')
    expect(filterSlashItems('resumir', false)).toEqual([])
    // With AI on, a block still comes before an AI action that shares the word.
    for (const query of ['tarefa', 'lista', 'texto', 'titulo']) expect(filterSlashItems(query, true)[0].kind).not.toBe('ai')
    // English stays as it was: an item whose label starts with the query comes first.
    expect(first('to')).toBe('todo')
    expect(first('c')).toBe('callout')
  })

  it('builds a default database schema', () => {
    let n = 0
    const props = defaultDatabaseProps('board', () => `id${++n}`)
    const schema = Object.values(props.schema ?? {})
    expect(schema.map((p) => [p.name, p.type])).toEqual([
      ['Name', 'title'],
      ['Status', 'select']
    ])
    const status = schema[1]
    expect(status.options).toHaveLength(3)
    expect(props.views).toHaveLength(1)
    expect(props.views?.[0]).toMatchObject({ type: 'board', groupBy: status.id, visibleProperties: ['title', status.id] })
    expect(defaultDatabaseProps('table', () => `x${++n}`).views?.[0].groupBy).toBeUndefined()
  })

  it('recognises token-based covers only', () => {
    for (const preset of COVER_PRESETS) expect(isCssCover(preset)).toBe(true)
    expect(isCssCover('sel-file://a.png')).toBe(false)
    expect(isCssCover('url(https://evil.example/x.png)')).toBe(false)
    expect(isCssCover('var(--c-blue-bg); background: url(x)')).toBe(false)
  })
})
