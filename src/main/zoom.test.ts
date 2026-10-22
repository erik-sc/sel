import { describe, expect, it } from 'vitest'
import { ZOOM_STEPS, cleanZoom, nextZoom } from './zoom'

describe('the remembered zoom', () => {
  it('reads back a factor within the steps, and 100% for anything else', () => {
    expect(cleanZoom(1.25)).toBe(1.25)
    expect(cleanZoom(0.5)).toBe(0.5)
    expect(cleanZoom(3)).toBe(3)
    expect(cleanZoom(undefined)).toBe(1)
    expect(cleanZoom('1.5')).toBe(1)
    expect(cleanZoom(Number.NaN)).toBe(1)
    expect(cleanZoom(0.1)).toBe(1)
    expect(cleanZoom(40)).toBe(1)
  })

  it('steps up and down through Chromium’s levels and stops at the ends', () => {
    expect(nextZoom(1, 1)).toBe(1.1)
    expect(nextZoom(1, -1)).toBe(0.9)
    expect(nextZoom(1.75, 0)).toBe(1)
    expect(nextZoom(ZOOM_STEPS[ZOOM_STEPS.length - 1], 1)).toBe(3)
    expect(nextZoom(ZOOM_STEPS[0], -1)).toBe(0.5)
  })

  it('goes to the next step from a factor between two', () => {
    expect(nextZoom(1.2, 1)).toBe(1.25)
    expect(nextZoom(1.2, -1)).toBe(1.1)
    // Floating point from Chromium (1.2^n): a hair off a step is that step.
    expect(nextZoom(1.1000001, 1)).toBe(1.25)
    expect(nextZoom(1.0999999, -1)).toBe(1)
  })
})
