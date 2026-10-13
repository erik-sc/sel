import { describe, expect, it } from 'vitest'
import { windowBackground } from './background'

describe('windowBackground', () => {
  it('uses the wallpaper base of the theme about to be rendered', () => {
    expect(windowBackground(null, false)).toBe('#f0ede6')
    expect(windowBackground(null, true)).toBe('#171614')
    expect(windowBackground({ version: 1, light: {}, dark: {}, shared: {} }, true)).toBe('#171614')
  })

  it('honours a stored override, per theme', () => {
    const saved = { version: 1, light: { '--wall-base': '#FFeedd' }, dark: { '--wall-base': 'rgb(1, 2, 255)' }, shared: {} }
    expect(windowBackground(saved, false)).toBe('#FFeedd')
    expect(windowBackground(saved, true)).toBe('#0102ff')
    expect(windowBackground({ light: { '--wall-base': '#abc' } }, false)).toBe('#abc')
  })

  it('falls back to the default for anything that is not a plain opaque colour', () => {
    for (const value of ['red', 'rgba(0,0,0,0.5)', '#12345678', 'rgb(300, 0, 0)', 'url(x)', 'var(--bg)', '', 7, null, {}, []]) {
      expect(windowBackground({ light: { '--wall-base': value } }, false)).toBe('#f0ede6')
    }
    for (const saved of ['x', 7, [], { light: 'x' }, { light: [] }, { dark: { '--wall-base': '#000000' } }]) {
      expect(windowBackground(saved, false)).toBe('#f0ede6')
    }
    // An inherited key is not an override.
    expect(windowBackground({ light: Object.create({ '--wall-base': '#000000' }) }, false)).toBe('#f0ede6')
  })
})
