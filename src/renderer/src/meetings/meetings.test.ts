import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Block } from '@shared/types'
import { MEETING_LANGUAGES, MEETING_LANGUAGE_LABELS, WHISPER_MODEL_LABELS, WHISPER_MODELS } from '../../../shared/meetings'
import { filterSlashItems } from '../editor/blockTypes'
import { planAccept } from '../ai/plan'
import type { Tree } from '../editor/structure'
import { paragraphAt, stampedRows } from './follow'

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

function page(id: string, parentId: string | null, type: Block['type'] = 'page'): Block {
  return { id, type, parentId, content: [], props: {}, createdAt: 0, updatedAt: 0, trashedAt: null }
}

describe('which pages are meetings', () => {
  it('tells a meeting and its transcript from everything else', async () => {
    // The gate imports the stores, which expect a window: only its pure part is exercised here.
    ;(globalThis as { window?: unknown }).window ??= { api: { onChange: () => () => undefined, app: { getSetting: async () => null, setSetting: async () => undefined } }, matchMedia: undefined }
    const { meetingRole } = await import('./gate')
    const meeting = page('m', 'db')
    expect(meetingRole(meeting, page('db', null, 'database'), 'db')).toEqual({ role: 'meeting', meetingId: 'm' })
    expect(meetingRole(page('t', 'm'), meeting, 'db')).toEqual({ role: 'transcript', meetingId: 'm' })
    expect(meetingRole(page('x', 'elsewhere'), page('elsewhere', null), 'db')).toBeNull()
    expect(meetingRole(page('deep', 't'), page('t', 'm'), 'db')).toBeNull()
    expect(meetingRole(meeting, undefined, null)).toBeNull()
    expect(meetingRole(page('db2', 'db', 'database'), undefined, 'db')).toBeNull()
    expect(meetingRole(undefined, undefined, 'db')).toBeNull()
  })
})

describe('entry points', () => {
  it('offers "Meeting notes" in the slash menu', () => {
    expect(filterSlashItems('meet').map((item) => item.id)).toContain('meeting')
    expect(filterSlashItems('record').map((item) => item.label)).toContain('Meeting notes')
    expect(filterSlashItems('').find((item) => item.id === 'meeting')?.kind).toBe('meeting')
  })

  it('labels every model and language it offers, multilingual models only', () => {
    for (const id of WHISPER_MODELS) {
      expect(WHISPER_MODEL_LABELS[id]).toBeTruthy()
      expect(id).not.toMatch(/\.en$/)
    }
    for (const language of MEETING_LANGUAGES) expect(MEETING_LANGUAGE_LABELS[language]).toBeTruthy()
    expect(MEETING_LANGUAGES).toContain('pt')
  })
})

describe('following the transcript while it plays', () => {
  it('marks the paragraph that started latest at or before the time heard', () => {
    const starts = [0, 5, 12, 40]
    expect(paragraphAt(starts, 0)).toBe(0)
    expect(paragraphAt(starts, 4.9)).toBe(0)
    expect(paragraphAt(starts, 5)).toBe(1)
    // A seek to 00:12 can land a hair before it.
    expect(paragraphAt(starts, 11.97)).toBe(2)
    expect(paragraphAt(starts, 3600)).toBe(3)
    expect(paragraphAt([3, 8], 1)).toBe(-1)
    expect(paragraphAt([], 10)).toBe(-1)
    // A time the user edited out of order does not hide the paragraphs after it.
    expect(paragraphAt([0, 50, 10, 20], 25)).toBe(3)
    expect(paragraphAt([0, 10, 10], 10)).toBe(2)
  })

  it('takes the rows that begin with a time written as code, and only those', () => {
    type Fake = { textContent: string; stamp: string | null }
    const fake = (rows: Fake[]): ParentNode =>
      ({
        querySelectorAll: (selector: string) => {
          expect(selector).toBe('.pe-body .blk[data-block-id] > .blk-row')
          return rows.map((row) => ({ ...row, querySelector: () => (row.stamp === null ? null : { textContent: row.stamp }) }))
        }
      }) as unknown as ParentNode
    const rows = stampedRows(
      fake([
        { textContent: '00:00 Me: Hello.', stamp: '00:00' },
        { textContent: 'A note of mine', stamp: null },
        { textContent: 'Run npm test at 01:00', stamp: 'npm test' },
        { textContent: 'Said at 02:00 by Me', stamp: '02:00' },
        { textContent: ' 1:02:03 Others: Long call.', stamp: '1:02:03' }
      ])
    )
    expect(rows.map((row) => [row.row.textContent, row.start])).toEqual([
      ['00:00 Me: Hello.', 0],
      [' 1:02:03 Others: Long call.', 3723]
    ])
  })

  it('marks it with a highlight, never in the editor’s own DOM', () => {
    const source = read('./follow.ts')
    expect(source).toContain('CSS.highlights.set')
    expect(source).not.toMatch(/classList|setAttribute|\.style\b|innerHTML/)
    expect(read('./meetings.css')).toMatch(/::highlight\(meeting-now\) \{\s*background-color: var\(--accent-soft\);/)
  })
})

describe('accepting the written-up notes', () => {
  it('puts them first in the page and the notes that were there under "My notes"', () => {
    const blocks = new Map<string, Block>([
      ['p', { ...page('p', 'db'), content: ['a', 'b'] }],
      ['a', { ...page('a', 'p', 'text'), props: { title: [['my rough note']] } }],
      ['b', { ...page('b', 'p', 'to_do'), props: { title: [['ask Rui']] } }]
    ])
    const tree: Tree = { pageId: 'p', get: (id) => blocks.get(id) }
    let serial = 0
    const answer = '## Summary\n\nThe launch moves to May.\n\n## Action items\n\n- [ ] **Ana** writes the guide'
    const plan = planAccept(tree, { kind: 'after', blockId: null }, `${answer}\n\n## My notes`, () => `new${++serial}`)
    const creates = plan?.ops.flatMap((op) => (op.op === 'create' ? [op.input] : [])) ?? []
    expect(creates.map((input) => [input.type, input.props?.title?.map((span) => span[0]).join('')])).toEqual([
      ['heading_2', 'Summary'],
      ['text', 'The launch moves to May.'],
      ['heading_2', 'Action items'],
      ['to_do', 'Ana writes the guide'],
      ['heading_2', 'My notes']
    ])
    // All of it goes in front of what the user wrote, which is not touched.
    expect(creates.every((input) => input.parentId === 'p')).toBe(true)
    expect(creates[0].afterId).toBeNull()
    expect(plan?.ops.some((op) => op.op === 'delete' || op.op === 'update')).toBe(false)
  })
})

describe('styles', () => {
  const css = read('./meetings.css')
  const indicator = /\/\* A meeting is being recorded[\s\S]*?\.topbar-actions \.is-favorite,/.exec(read('../styles/shell.css'))?.[0] ?? ''

  it.each([
    ['the meetings stylesheet', css],
    ['the recording indicator', indicator]
  ])('%s uses tokens for every colour, size of type, weight, radius, shadow and duration', (_name, text) => {
    expect(text.length).toBeGreaterThan(200)
    const body = text.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(body).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|color-mix)\(/)
    for (const declaration of body.matchAll(/(font-size|font-weight|border-radius|box-shadow|transition|animation|font-family|background|color)\s*:\s*([^;]+);/g)) {
      const [, property, value] = declaration
      if (property === 'font-size') expect(value, declaration[0]).toMatch(/^(var\(--text-[\w-]+\)|inherit|calc\(1em \* var\(--code-scale\)\))$/)
      if (property === 'font-weight') expect(value, declaration[0]).toMatch(/^var\(--weight-[\w-]+\)$/)
      if (property === 'font-family') expect(value, declaration[0]).toMatch(/^var\(--font-[\w-]+\)$/)
      if (property === 'border-radius') expect(value, declaration[0]).toMatch(/^(var\(--radius-[\w-]+\)|inherit)$/)
      if (property === 'transition' || property === 'animation') expect(value, declaration[0]).toMatch(/var\(--duration(-fast)?\)/)
      if (property === 'transition' || property === 'animation') expect(value, declaration[0]).not.toMatch(/\d(ms|s)\b/)
      if (property === 'box-shadow') expect(value.replace(/var\(--[\w-]+\)/g, ''), declaration[0]).not.toMatch(/[a-z]{3,}\(/)
      if (property === 'color' || property === 'background') expect(value, declaration[0]).toMatch(/^(var\(--[\w-]+\)|transparent|inherit|linear-gradient\(var\(--[\w-]+\) \d+%, transparent\))$/)
    }
  })

  it('keeps the recording state calm: one small dot in the danger colour, motion only where it is welcome', () => {
    expect(css).toMatch(/\.mt-dot,\s*\.recording-indicator-dot \{[^}]*background: var\(--danger\)/)
    const animated = css.match(/animation:[^;]+;/g) ?? []
    expect(animated).toHaveLength(1)
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.mt-state\.is-recording \.mt-dot \{\s*animation:/)
    expect(indicator).not.toMatch(/animation/)
  })

  it('allows audio from the recordings route only', () => {
    const html = read('../../index.html')
    expect(html).toContain("media-src sel-file:;")
    expect(html).toContain("script-src 'self';")
    expect(html).toContain("worker-src 'none'")
    expect(html).toContain("connect-src 'none'")
    expect(html).not.toMatch(/media-src[^;]*(blob:|data:|https:|\*)/)
  })
})
