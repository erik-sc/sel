import { describe, expect, it } from 'vitest'
import { APP_SHORTCUTS, acceleratorOf, formatAccelerator } from './shortcuts'

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
  })
})
