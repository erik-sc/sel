import { describe, expect, it } from 'vitest'
import { LINE_ICONS, LINE_ICON_NAMES, lineIconPath, lineIconValue } from './lineIcons'
import { SHAPE_BOX, isShapeIcon, newShapeIcon, shapeOf } from './shape'

describe('shape icons', () => {
  it('makes a new icon value that is short enough for every place an icon is stored', () => {
    const icon = newShapeIcon()
    expect(icon).toMatch(/^shape:[0-9a-z]{8}$/)
    // The briefing keeps 16 characters of a database icon; the clipboard accepts 32.
    expect(icon.length).toBeLessThanOrEqual(16)
    expect(newShapeIcon()).not.toBe(icon)
  })

  it('draws the same shape for the same seed, and another for another', () => {
    expect(shapeOf('shape:abc12345')).toEqual(shapeOf('shape:abc12345'))
    expect(JSON.stringify(shapeOf('shape:abc12345'))).not.toBe(JSON.stringify(shapeOf('shape:abc12346')))
  })

  it('tells a shape from the other kinds of icon', () => {
    expect(isShapeIcon(newShapeIcon())).toBe(true)
    expect(isShapeIcon('📄')).toBe(false)
    expect(isShapeIcon('icon:leaf')).toBe(false)
  })

  it('only draws finite paths in known colours, near the box', () => {
    for (let i = 0; i < 500; i++) {
      for (const layer of shapeOf(`shape:${i}`).layers) {
        expect(layer.d).toMatch(/^M[-\d. a-zA-Z]+Z$/)
        expect(layer.d).not.toMatch(/NaN|Infinity/)
        expect(layer.colour).toMatch(/^(blue|orange|pink|yellow|brown|purple|green|red)$/)
        const start = /^M(-?[\d.]+) (-?[\d.]+)/.exec(layer.d)!
        for (const value of [Number(start[1]), Number(start[2])]) {
          expect(value).toBeGreaterThan(-SHAPE_BOX / 2)
          expect(value).toBeLessThan(SHAPE_BOX * 1.5)
        }
      }
    }
  })
})

describe('line icons', () => {
  it('draws every icon as one unbroken line inside the box', () => {
    expect(LINE_ICON_NAMES.length).toBeGreaterThan(24)
    for (const name of LINE_ICON_NAMES) {
      const d: string = LINE_ICONS[name]
      // One pen-down: a single M, at the start.
      expect(d.match(/[Mm]/g), name).toEqual(['M'])
      expect(d, name).toMatch(/^M[-\d. a-zA-Z]+$/)
      // The briefing keeps 16 characters of a database icon.
      expect(lineIconValue(name).length, name).toBeLessThanOrEqual(16)
      expect(lineIconPath(lineIconValue(name))).toBe(d)
    }
  })

  it('names no icon for other values', () => {
    expect(lineIconPath('icon:nothing')).toBeUndefined()
    expect(lineIconPath('icon:constructor')).toBeUndefined()
    expect(lineIconPath('📄')).toBeUndefined()
    expect(lineIconPath('shape:abc12345')).toBeUndefined()
  })
})
