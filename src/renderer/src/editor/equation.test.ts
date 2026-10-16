// The equation block in the editor: how it is made (slash menu, `$$`), and how it travels through
// pasted Markdown and the clipboard. The Markdown export/import of pages is in main/markdown.test.ts.
import { describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType } from '@shared/types'
import { ALL_TYPES, filterSlashItems, isPlainTextType, TURN_INTO } from './blockTypes'
import { cleanProps, nodesToText, parseClipNodes } from './clipboard'
import { detectBlockShortcut, parseMarkdownBlocks } from './markdown'
import { turnIntoPatch } from './structure'
import { blockShortcutOps } from './typing'

function block(id: string, type: BlockType, parentId: string | null, props: BlockProps = {}): Block {
  return { id, type, parentId, content: [], props, createdAt: 1, updatedAt: 1, trashedAt: null }
}

describe('making an equation block', () => {
  it('is offered by the slash menu in both languages, and by Turn into', () => {
    for (const query of ['equation', 'equação', 'equacao', 'math', 'latex', 'fórmula']) {
      expect(filterSlashItems(query)[0]?.type).toBe('equation')
    }
    expect(TURN_INTO.some((i) => i.type === 'equation')).toBe(true)
    expect(ALL_TYPES).toContain('equation')
    expect(isPlainTextType('equation')).toBe(true)
  })

  it('comes from typing $$ at the start of a paragraph, keeping what follows as TeX', () => {
    expect(detectBlockShortcut('$$')).toEqual({ type: 'equation' })
    expect(detectBlockShortcut('a $$')).toBeNull()
    const b = block('x', 'text', 'page')
    expect(blockShortcutOps(b, [['$$'], ['x^2', [['b']]]], 2, '$', null, () => 'n')).toEqual([
      { op: 'update', id: 'x', patch: { type: 'equation', props: { title: [['x^2']] } } }
    ])
  })

  it('turns into and from text as plain text, without marks', () => {
    expect(turnIntoPatch(block('t', 'text', 'p', { title: [['a', [['b']]], ['b']] }), 'equation')).toEqual({ title: [['ab']] })
    expect(turnIntoPatch(block('e', 'equation', 'p', { title: [['E=mc^2']] }), 'text')).toEqual({ title: [['E=mc^2']] })
  })
})

describe('pasted Markdown', () => {
  it('reads $$ lines and one-line $$…$$ as equations, an unclosed $$ as text', () => {
    expect(parseMarkdownBlocks('$$\n\\frac{a}{b}\n\\\\ c\n$$\n$$x^2$$\n$$ open\nrest')).toEqual([
      { type: 'equation', title: [['\\frac{a}{b}\n\\\\ c']] },
      { type: 'equation', title: [['x^2']] },
      { type: 'text', title: [['$$ open']] },
      { type: 'text', title: [['rest']] }
    ])
  })
})

describe('the clipboard', () => {
  it('keeps an equation as plain TeX and copies it as $$ lines', () => {
    expect(cleanProps('equation', { title: [['x', [['b']]], ['^2']], language: 'js', url: 'https://x.dev' })).toEqual({ title: [['x^2']] })
    const nodes = parseClipNodes([{ type: 'equation', props: { title: [['a+b']] }, children: [] }])
    expect(nodes).toEqual([{ type: 'equation', props: { title: [['a+b']] }, children: [] }])
    const text = nodesToText(nodes).join('\n')
    expect(text).toBe('$$\na+b\n$$')
    // …which pastes back as the same block.
    expect(parseMarkdownBlocks(text)).toEqual([{ type: 'equation', title: [['a+b']] }])
  })
})
