import { describe, expect, it } from 'vitest'
import { APP_SHORTCUTS, PAGE_KEYS, ZOOM_KEYS, acceleratorOf, formatAccelerator, type PageKey } from './shortcuts'

describe('formatAccelerator', () => {
  it('writes Windows and Linux shortcuts with plus signs', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+L', false)).toBe('Ctrl+Shift+L')
    expect(formatAccelerator('CmdOrCtrl+Alt+Shift+H', false)).toBe('Ctrl+Alt+Shift+H')
    expect(formatAccelerator('Control+Tab', false)).toBe('Ctrl+Tab')
    expect(formatAccelerator('Alt+Left', false)).toBe('Alt+←')
    expect(formatAccelerator('CmdOrCtrl+\\', false)).toBe('Ctrl+\\')
    expect(formatAccelerator('CmdOrCtrl+,', false)).toBe('Ctrl+,')
    expect(formatAccelerator('CmdOrCtrl++', false)).toBe('Ctrl++')
  })

  it('writes macOS shortcuts as symbols in the usual order', () => {
    expect(formatAccelerator('CmdOrCtrl+K', true)).toBe('⌘K')
    expect(formatAccelerator('CmdOrCtrl+Alt+Shift+H', true)).toBe('⌥⇧⌘H')
    expect(formatAccelerator('Control+Shift+Tab', true)).toBe('⌃⇧Tab')
    expect(formatAccelerator('Cmd+[', true)).toBe('⌘[')
  })
})

describe('APP_SHORTCUTS', () => {
  it('gives each key combination to one command', () => {
    const combos = APP_SHORTCUTS.map((s) => `${s.ctrl ? 'c' : ''}${s.shift ? 's' : ''}${s.alt ? 'a' : ''}+${s.key}`)
    expect(new Set(combos).size).toBe(combos.length)
  })

  it('looks up the accelerator of a command for the platform', () => {
    expect(acceleratorOf('command-palette', false)).toBe('CmdOrCtrl+K')
    expect(acceleratorOf('go-back', false)).toBe('Alt+Left')
    expect(acceleratorOf('go-back', true)).toBe('Cmd+[')
    expect(acceleratorOf('send-feedback', false)).toBeUndefined()
    expect(acceleratorOf('go-home', false)).toBe('CmdOrCtrl+Alt+H')
    expect(APP_SHORTCUTS.find((s) => s.key === 'h' && s.ctrl && s.alt && !s.shift)?.command).toBe('go-home')
  })
})

describe('the keys pages handle themselves', () => {
  const combo = (s: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }) =>
    `${s.ctrl ? 'c' : ''}${s.shift ? 's' : ''}${s.alt ? 'a' : ''}+${s.key}`
  const app = new Set(APP_SHORTCUTS.map(combo))
  // Ctrl+1 to Ctrl+9 pick a tab (src/main/menu.ts), outside APP_SHORTCUTS.
  for (let n = 1; n <= 9; n++) app.add(combo({ key: String(n), ctrl: true }))
  const zoom: PageKey[] = [...ZOOM_KEYS.in, ...ZOOM_KEYS.out, ...ZOOM_KEYS.reset]

  it('are never an app shortcut, which main would take before the page', () => {
    for (const key of [...PAGE_KEYS, ...zoom]) expect(app.has(combo(key)), key.accelerator).toBe(false)
  })

  it('give each combination one meaning in one place', () => {
    const seen = new Map<string, string>()
    for (const key of PAGE_KEYS) {
      const where = seen.get(combo(key))
      expect(where === undefined || where === key.where, key.accelerator).toBe(true)
      seen.set(combo(key), key.where)
    }
  })

  it('agree with their accelerators', () => {
    for (const key of [...PAGE_KEYS, ...zoom]) {
      const parts = key.accelerator.toLowerCase().split('+')
      expect(!!key.ctrl, key.accelerator).toBe(parts.includes('control') || parts.includes('cmdorctrl'))
      expect(!!key.alt, key.accelerator).toBe(parts.includes('alt'))
    }
  })
})
