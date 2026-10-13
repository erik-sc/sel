import { describe, expect, it } from 'vitest'
import { SHAPE_BOX, SHAPE_PREFIX, newShapeIcon, shapeOf, shapeSeed } from './shape'

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

  it('gives an icon saved as an emoji a shape of its own', () => {
    expect(shapeSeed('📄')).toBe('📄')
    expect(shapeSeed(SHAPE_PREFIX + 'x')).toBe('x')
    expect(shapeOf('📄').layers.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(shapeOf('📄'))).not.toBe(JSON.stringify(shapeOf('✅')))
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
