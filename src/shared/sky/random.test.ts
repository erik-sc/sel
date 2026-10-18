import { describe, expect, it } from 'vitest'
import { hash, rng } from './random'

// Fixed vectors: these numbers place every star already drawn. If they change, every sky moves.
describe('hash', () => {
  it('gives the same numbers as the prototype', () => {
    expect(hash('')).toBe(2872998923)
    expect(hash('a')).toBe(444641715)
    expect(hash('sel')).toBe(2749093114)
    expect(hash('sel-sky-figures')).toBe(1800392375)
    expect(hash('2026-10-15')).toBe(699247111)
  })
})

describe('rng', () => {
  it('gives the same stream as the prototype', () => {
    const r = rng('sel-sky')
    expect(r()).toBeCloseTo(0.34075009846128523, 15)
    expect(r()).toBeCloseTo(0.008589116157963872, 15)
    expect(r()).toBeCloseTo(0.648363069165498, 15)
    const s = rng('sel-sky-rot:2026-10')
    expect(s()).toBeCloseTo(0.7017457864712924, 15)
    expect(s()).toBeCloseTo(0.05190618894994259, 15)
  })

  it('stays in [0, 1) and repeats for the same seed', () => {
    const a = rng('x')
    const b = rng('x')
    for (let i = 0; i < 1000; i++) {
      const v = a()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      expect(b()).toBe(v)
    }
  })
})
