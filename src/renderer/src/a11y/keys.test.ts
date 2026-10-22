import { describe, expect, it } from 'vitest'
import { isMenuKeyEcho, rovingTarget, takeMenuKey } from './keys'

const key = (k: string, mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})

describe('rovingTarget', () => {
  it('steps along a list without wrapping', () => {
    expect(rovingTarget('ArrowDown', 0, 3, 'vertical')).toBe(1)
    expect(rovingTarget('ArrowUp', 1, 3, 'vertical')).toBe(0)
    expect(rovingTarget('ArrowDown', 2, 3, 'vertical')).toBeNull()
    expect(rovingTarget('ArrowUp', 0, 3, 'vertical')).toBeNull()
  })

  it('goes to the ends with Home and End', () => {
    expect(rovingTarget('Home', 2, 3, 'vertical')).toBe(0)
    expect(rovingTarget('End', 0, 3, 'horizontal')).toBe(2)
    expect(rovingTarget('End', 2, 3, 'horizontal')).toBeNull()
  })

  it('reads the arrows of its orientation only', () => {
    expect(rovingTarget('ArrowRight', 0, 3, 'horizontal')).toBe(1)
    expect(rovingTarget('ArrowRight', 0, 3, 'vertical')).toBeNull()
    expect(rovingTarget('ArrowDown', 0, 3, 'horizontal')).toBeNull()
    expect(rovingTarget('Enter', 0, 3, 'vertical')).toBeNull()
  })

  it('starts at the first item when none has the focus', () => {
    expect(rovingTarget('ArrowDown', -1, 3, 'vertical')).toBe(0)
    expect(rovingTarget('ArrowUp', -1, 3, 'vertical')).toBe(0)
    expect(rovingTarget('ArrowDown', -1, 0, 'vertical')).toBeNull()
  })
})

describe('takeMenuKey', () => {
  it('is the Menu key and Shift+F10, and nothing else', () => {
    expect(takeMenuKey(key('ContextMenu'))).toBe(true)
    expect(takeMenuKey(key('F10', { shiftKey: true }))).toBe(true)
    expect(takeMenuKey(key('F10'))).toBe(false)
    expect(takeMenuKey(key('F10', { shiftKey: true, ctrlKey: true }))).toBe(false)
    expect(takeMenuKey(key('ContextMenu', { altKey: true }))).toBe(false)
    expect(takeMenuKey(key('Enter'))).toBe(false)
  })

  it('takes the contextmenu event that follows the key for an echo', () => {
    takeMenuKey(key('ContextMenu'))
    expect(isMenuKeyEcho()).toBe(true)
  })
})
