import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent } from 'react'
import type { EditorController } from '../editor/controller'
import { APP_SHORTCUTS } from '../../../shared/shortcuts'
import { detectBlockShortcut, detectInlineShortcut } from '../editor/markdown'
import { SHORTCUT_GROUPS, shownShortcuts } from './catalog'

// The editor's key handler reads the caret from the DOM and may start AI: both are stood in for.
const fake = vi.hoisted(() => ({ offsets: { start: 0, end: 0 }, aiPrompts: 0 }))
vi.mock('../editor/richtext-dom', () => ({
  getSelectionOffsets: () => fake.offsets,
  caretRect: () => ({ top: 0, bottom: 0, left: 0, height: 0 })
}))
vi.mock('../ai/session', () => ({
  wantsAiPrompt: () => true,
  aiPromptAt: () => {
    fake.aiPrompts++
  }
}))
const { onBlockKeyDown } = await import('../editor/keyboard')

const entries = SHORTCUT_GROUPS.flatMap((group) => group.entries)
const group = (id: string) => SHORTCUT_GROUPS.find((g) => g.id === id)?.entries ?? []

describe('the shortcut list', () => {
  it('gives every entry its own id', () => {
    const ids = entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lists every app shortcut once, by its menu command', () => {
    const listed = entries.flatMap((e) => (e.command ? [e.command] : []))
    expect([...listed].sort()).toEqual([...new Set(APP_SHORTCUTS.map((s) => s.command))].sort())
  })

  it('places each line of a group that lists commands, once', () => {
    for (const g of SHORTCUT_GROUPS) {
      if (!g.entries.some((e) => e.command)) continue
      for (const e of g.entries) expect(e.order, `${g.id}: ${e.id}`).toBeTypeOf('number')
      const orders = g.entries.map((e) => e.order)
      expect(new Set(orders).size, g.id).toBe(orders.length)
    }
  })

  it('gives every entry keys or text to type', () => {
    for (const mac of [false, true]) {
      for (const g of shownShortcuts({ mac, ai: true })) {
        for (const e of g.entries) expect(e.keys.length > 0 || e.typed !== undefined, e.id).toBe(true)
      }
    }
  })

  it('writes keys in the platform notation', () => {
    const find = (mac: boolean, id: string) =>
      shownShortcuts({ mac, ai: true })
        .flatMap((g) => g.entries)
        .find((e) => e.id === id)
    expect(find(false, 'keyboard-shortcuts')?.keys).toEqual(['Ctrl+/'])
    expect(find(true, 'keyboard-shortcuts')?.keys).toEqual(['⌘/'])
    expect(find(false, 'go-back')?.keys).toEqual(['Alt+←'])
    expect(find(true, 'go-back')?.keys).toEqual(['⌘['])
    expect(find(false, 'redo')?.keys).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y'])
    expect(find(false, 'db-page')?.keys).toEqual(['Page Up', 'Page Down'])
    expect(find(false, 'md-heading-1')).toMatchObject({ typed: '#', thenSpace: true, keys: [] })
    expect(find(false, 'md-code')).toMatchObject({ typed: '```', thenSpace: false })
  })

  it('leaves out what does not apply', () => {
    const ids = (mac: boolean, ai: boolean) => shownShortcuts({ mac, ai }).flatMap((g) => g.entries.map((e) => e.id))
    expect(ids(false, false)).not.toContain('toggle-assistant')
    expect(ids(false, false)).not.toContain('ai-write')
    expect(shownShortcuts({ mac: false, ai: false }).map((g) => g.id)).not.toContain('herman')
    expect(ids(false, true)).toContain('tab-position')
    expect(ids(true, true)).not.toContain('tab-position')
  })
})

describe('filtering', () => {
  const ids = (query: string) => shownShortcuts({ mac: false, ai: true, query }).flatMap((g) => g.entries.map((e) => e.id))

  it('ignores case and accents and needs every word', () => {
    expect(ids('BOLD')).toEqual(['bold', 'md-bold'])
    expect(ids('itálico')).toEqual([])
    expect(ids('ítalic')).toEqual(['italic', 'md-italic'])
    expect(ids('bold markdown')).toEqual(['md-bold'])
  })

  it('finds keys, keywords and group titles', () => {
    expect(ids('ctrl+b')).toEqual(['bold'])
    expect(ids('dark mode')).toEqual(['toggle-theme'])
    expect(ids('databases')).toEqual(group('databases').map((e) => e.id))
  })

  it('drops groups with nothing left and shows everything for a blank query', () => {
    expect(shownShortcuts({ mac: false, ai: true, query: 'bold' }).map((g) => g.id)).toEqual(['editor', 'markdown'])
    expect(ids('   ')).toEqual(ids(''))
    expect(ids('zzzz')).toEqual([])
  })
})

describe('the Markdown group', () => {
  it('lists only what typing turns into formatting', () => {
    for (const e of group('markdown')) {
      const typed = e.typed ?? ''
      const found = detectBlockShortcut(typed) ?? detectInlineShortcut(typed, typed.length)
      expect(found, e.id).not.toBeNull()
    }
  })
})

// What each editor entry makes the block's key handler (editor/keyboard.ts) do. Every editor entry
// must be here, so a key added to the list or dropped from the editor shows up as a failure.
type Expectation = { calls: string; args?: unknown[]; selection?: 'some' | 'all'; empty?: boolean } | { elsewhere: string }

const EDITOR: Record<string, Expectation> = {
  'insert-block': { elsewhere: 'typing / opens the slash menu (editor/typingHooks.ts)' },
  'new-block': { calls: 'split' },
  'line-break': { calls: 'insertPlain' },
  bold: { calls: 'toggleMark', args: [['b']] },
  italic: { calls: 'toggleMark', args: [['i']] },
  underline: { calls: 'toggleMark', args: [['u']] },
  strikethrough: { calls: 'toggleMark', args: [['s']] },
  'inline-code': { calls: 'toggleMark', args: [['c']] },
  link: { calls: 'requestLink', selection: 'some' },
  toolbar: { calls: 'requestToolbar', selection: 'some' },
  indent: { calls: 'indent' },
  outdent: { calls: 'outdent' },
  'move-block': { calls: 'moveBlocks' },
  'duplicate-block': { calls: 'duplicate' },
  'select-block': { calls: 'selectBlocks' },
  'select-all': { calls: 'selectAll', selection: 'all' },
  'ai-write': { calls: 'aiPromptAt', empty: true },
  'leave-code': { elsewhere: 'code blocks are a textarea (editor/blocks.tsx)' }
}

const KEY_VALUES: Record<string, string> = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Space: ' ' }

/** A keydown for an accelerator such as 'CmdOrCtrl+Shift+Up'. */
function keyEvent(accelerator: string) {
  const parts = accelerator.split('+')
  const name = parts.pop() ?? ''
  const shift = parts.includes('Shift')
  const key = KEY_VALUES[name] ?? (name.length === 1 ? (shift ? name.toUpperCase() : name.toLowerCase()) : name)
  const event = {
    key,
    ctrlKey: parts.includes('CmdOrCtrl'),
    metaKey: false,
    shiftKey: shift,
    altKey: parts.includes('Alt'),
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn()
  }
  return event
}

/** Runs one key through the block handler and says which controller methods it called. */
function press(accelerator: string, text: string, start: number, end: number) {
  const calls: { method: string; args: unknown[] }[] = []
  const ui = { getState: () => ({ slash: null }) }
  const ctrl = new Proxy(
    {},
    {
      get: (_target, method) =>
        method === 'ui'
          ? ui
          : (...args: unknown[]) => {
              calls.push({ method: String(method), args })
              return true
            }
    }
  ) as unknown as EditorController
  fake.offsets = { start, end }
  const before = fake.aiPrompts
  const event = keyEvent(accelerator)
  const el = { textContent: text } as unknown as HTMLElement
  onBlockKeyDown(ctrl, 'block-1', event as unknown as KeyboardEvent<HTMLElement>, el)
  if (fake.aiPrompts > before) calls.push({ method: 'aiPromptAt', args: [] })
  return { calls, prevented: event.preventDefault.mock.calls.length > 0 }
}

describe('the Editor group', () => {
  it('has an expectation for every entry', () => {
    expect(
      group('editor')
        .map((e) => e.id)
        .sort()
    ).toEqual(Object.keys(EDITOR).sort())
  })

  for (const entry of group('editor')) {
    const expected = EDITOR[entry.id]
    if (!expected || 'elsewhere' in expected) continue
    it(`handles ${entry.label}`, () => {
      expect(entry.keys?.length).toBeGreaterThan(0)
      for (const accelerator of entry.keys ?? []) {
        const text = expected.empty ? '' : 'hello'
        const [start, end] =
          expected.selection === 'all' ? [0, 5] : expected.selection === 'some' ? [1, 3] : expected.empty ? [0, 0] : [2, 2]
        const { calls, prevented } = press(accelerator, text, start, end)
        expect(prevented, accelerator).toBe(true)
        const call = calls.find((c) => c.method === expected.calls)
        expect(call, `${accelerator} calls ${expected.calls}`).toBeDefined()
        if (expected.args) expect(call?.args).toEqual(expected.args)
      }
    })
  }
})
