import { describe, expect, it } from 'vitest'
import {
  applyInlineShortcut,
  detectBlockShortcut,
  detectInlineShortcut,
  parseInlineMarkdown,
  parseMarkdownBlocks
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
    expect(r.rt).toEqual([['a', [['i']]], ['b', [['b'], ['i']]]])
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
    expect(isCssCover('selida-file://a.png')).toBe(false)
    expect(isCssCover('url(https://evil.example/x.png)')).toBe(false)
    expect(isCssCover('var(--c-blue-bg); background: url(x)')).toBe(false)
  })
})
