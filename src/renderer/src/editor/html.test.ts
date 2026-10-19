import { describe, expect, it } from 'vitest'
import { htmlToNodes, tidy, type HtmlNode } from './html'
import type { ClipNode } from './clipboard'

// A stand-in for the DOM DOMParser gives in the app: just the members html.ts reads.
type Child = HtmlNode | string

function text(value: string): HtmlNode {
  return { nodeType: 3, nodeName: '#text', textContent: value, childNodes: [] }
}

function h(tag: string, attrs: Record<string, string> | null, ...children: Child[]): HtmlNode {
  const kids = children.map((c) => (typeof c === 'string' ? text(c) : c))
  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    get textContent() {
      return kids.map((k) => k.textContent ?? '').join('')
    },
    childNodes: kids,
    getAttribute: (name: string) => attrs?.[name] ?? null
  }
}

const body = (...children: Child[]): HtmlNode => h('body', null, ...children)

/** Type, title text and children of each node, for compact expectations. */
function outline(nodes: readonly ClipNode[] | null): unknown[] {
  return (nodes ?? []).map((n) => {
    const title = (n.props.title ?? []).map((s) => s[0]).join('')
    const head = n.type === 'to_do' ? `${n.type}${n.props.checked ? '[x]' : '[ ]'}: ${title}` : `${n.type}: ${title}`
    return n.children.length ? [head, outline(n.children)] : head
  })
}

describe('htmlToNodes', () => {
  it('keeps headings, paragraphs, quotes, code and dividers', () => {
    const nodes = htmlToNodes(
      body(
        h('h1', null, 'Plano'),
        h('p', null, 'Um ', h('b', null, 'parágrafo'), '.'),
        h('h4', null, 'Menor'),
        h('blockquote', null, h('p', null, 'primeira'), h('p', null, 'segunda')),
        h('pre', { class: 'language-ts' }, h('code', null, 'const a = 1\n  b()\n')),
        h('hr', null)
      ),
      'Plano\nUm parágrafo.'
    )
    expect(outline(nodes)).toEqual([
      'heading_1: Plano',
      'text: Um parágrafo.',
      'heading_3: Menor',
      'quote: primeira\nsegunda',
      'code: const a = 1\n  b()',
      'divider: '
    ])
    expect(nodes?.[1].props.title).toEqual([['Um '], ['parágrafo', [['b']]], ['.']])
    expect(nodes?.[4].props.language).toBe('ts')
  })

  it('nests lists, inside the item or right after it, and reads task lists', () => {
    const nodes = htmlToNodes(
      body(
        h(
          'ul',
          null,
          h('li', null, 'um', h('ul', null, h('li', null, 'um.a'), h('li', null, h('p', null, 'um.b')))),
          h('li', null, 'dois')
        ),
        h('ol', null, h('li', null, 'primeiro'), h('ol', null, h('li', null, 'dentro'))),
        h(
          'ul',
          null,
          h('li', null, h('input', { type: 'checkbox', checked: '' }), ' feito'),
          h('li', null, h('input', { type: 'checkbox' }), ' a fazer')
        )
      ),
      'um\num.a'
    )
    expect(outline(nodes)).toEqual([
      ['bulleted_list: um', ['bulleted_list: um.a', 'bulleted_list: um.b']],
      'bulleted_list: dois',
      ['numbered_list: primeiro', ['numbered_list: dentro']],
      'to_do[x]: feito',
      'to_do[ ]: a fazer'
    ])
  })

  it('reads Google Docs: the normal-weight <b> wrapper, styled spans, aria-level lists and checklists', () => {
    const span = (style: string, value: string): HtmlNode => h('span', { style }, value)
    const nodes = htmlToNodes(
      body(
        h(
          'b',
          { style: 'font-weight:normal;', id: 'docs-internal-guid-1' },
          h(
            'p',
            { dir: 'ltr' },
            span('font-weight:400;white-space:pre-wrap;', 'Texto '),
            span('font-weight:700;font-style:italic;', 'forte')
          ),
          h(
            'ul',
            null,
            h('li', { 'aria-level': '1' }, h('p', null, span('font-weight:400', 'nível 1'))),
            h('li', { 'aria-level': '2' }, h('p', null, span('font-weight:400', 'nível 2'))),
            h('li', { 'aria-level': '1' }, h('p', null, span('text-decoration:line-through', 'outro')))
          ),
          h('ul', null, h('li', { role: 'checkbox', 'aria-checked': 'true' }, h('p', null, 'marcado')))
        )
      ),
      'Texto forte'
    )
    expect(outline(nodes)).toEqual([
      'text: Texto forte',
      ['bulleted_list: nível 1', ['bulleted_list: nível 2']],
      'bulleted_list: outro',
      'to_do[x]: marcado'
    ])
    expect(nodes?.[0].props.title).toEqual([['Texto '], ['forte', [['b'], ['i']]]])
    expect(nodes?.[2].props.title).toEqual([['outro', [['s']]]])
  })

  it('keeps safe links and drops the rest', () => {
    const nodes = htmlToNodes(
      body(
        h(
          'p',
          null,
          h('a', { href: 'https://example.com/a' }, 'seguro'),
          ' ',
          h('a', { href: 'javascript:alert(1)' }, 'não'),
          ' ',
          h('a', { href: '/relativo' }, 'relativo')
        )
      ),
      'seguro não relativo'
    )
    expect(nodes?.[0].props.title).toEqual([['seguro', [['a', 'https://example.com/a']]], [' não relativo']])
  })

  it('leaves out images, scripts, styles and forms', () => {
    const nodes = htmlToNodes(
      body(
        h('style', null, 'p { color: red }'),
        h('script', null, 'alert(1)'),
        h('h2', null, 'Título'),
        h('p', null, h('img', { src: 'https://tracker.example/p.gif', alt: 'pixel' }), 'texto ', h('button', null, 'Comprar')),
        h('svg', null, h('text', null, 'desenho'))
      ),
      'Título\ntexto'
    )
    expect(outline(nodes)).toEqual(['heading_2: Título', 'text: texto'])
    expect(JSON.stringify(nodes)).not.toContain('tracker')
  })

  it('collapses whitespace the way a browser shows it, keeping <br> as a line break', () => {
    const nodes = htmlToNodes(
      body(h('h3', null, '\n   Muito\n\n   espaço  '), h('p', null, 'linha um ', h('br', null), ' linha dois')),
      'x\ny'
    )
    expect(outline(nodes)).toEqual(['heading_3: Muito espaço', 'text: linha um\nlinha dois'])
    expect(tidy([['  a  '], [' b', [['b']]], ['\n\n c ']])).toEqual([['a '], ['b', [['b']]], ['\nc']])
  })

  it('turns data table rows into lines and reads layout tables through', () => {
    const nodes = htmlToNodes(
      body(
        h(
          'table',
          null,
          h(
            'tbody',
            null,
            h('tr', null, h('th', null, 'Nome'), h('th', null, 'Nota')),
            h('tr', null, h('td', null, 'Ana'), h('td', null, h('b', null, '10')))
          )
        ),
        h('table', null, h('tr', null, h('td', null, h('h2', null, 'Boletim'), h('ul', null, h('li', null, 'item')))))
      ),
      'Nome\tNota'
    )
    expect(outline(nodes)).toEqual(['text: Nome | Nota', 'text: Ana | 10', 'heading_2: Boletim', 'bulleted_list: item'])
  })

  it('gives way to the plain text when the HTML adds nothing to it', () => {
    // Plain styled spans: what a browser puts on the clipboard for ordinary text.
    expect(htmlToNodes(body(h('span', { style: 'color: rgb(0, 0, 0); font-weight: 400;' }, 'só texto')), 'só texto')).toBeNull()
    // Markdown source in a styled view: its own syntax is richer than the styling.
    expect(htmlToNodes(body(h('div', null, h('b', null, '## Título'))), '## Título\n- item')).toBeNull()
    // A code editor's copy: a white-space: pre box of coloured spans.
    expect(
      htmlToNodes(
        body(h('div', { style: 'color: #ccc;white-space: pre;' }, h('div', null, h('span', { style: 'font-weight: bold;' }, 'const')))),
        'const'
      )
    ).toBeNull()
    expect(htmlToNodes(null, 'x')).toBeNull()
    expect(htmlToNodes(body(h('p', null, '   ')), '')).toBeNull()
  })

  it('stays bounded on hostile nesting', () => {
    let deep: HtmlNode = h('b', null, 'fundo')
    for (let i = 0; i < 500; i++) deep = h(i % 2 ? 'div' : 'span', null, deep)
    const nodes = htmlToNodes(body(h('h1', null, 'Topo'), deep), 'Topo\nfundo')
    expect(outline(nodes)).toEqual(['heading_1: Topo', 'text: fundo'])

    let list: HtmlNode = h('li', null, 'folha')
    for (let i = 0; i < 100; i++) list = h('li', null, `n${i}`, h('ul', null, list))
    const depth = (n: readonly ClipNode[]): number => (n.length ? 1 + Math.max(...n.map((c) => depth(c.children))) : 0)
    expect(depth(htmlToNodes(body(h('ul', null, list)), 'a\nb') ?? [])).toBeLessThanOrEqual(32)
  })
})
