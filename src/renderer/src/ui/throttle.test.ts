import { describe, expect, it } from 'vitest'
import { createThrottle } from './throttle'

describe('createThrottle', () => {
  it('lets the first call through, then one per interval', () => {
    const allow = createThrottle(5000)
    expect(allow(1000)).toBe(true)
    expect(allow(1001)).toBe(false)
    expect(allow(5999)).toBe(false)
    expect(allow(6000)).toBe(true)
    expect(allow(6001)).toBe(false)
  })

  it('measures from the last call that got through, not the last call', () => {
    const allow = createThrottle(1000)
    expect(allow(0)).toBe(true)
    for (let t = 100; t < 1000; t += 100) expect(allow(t)).toBe(false)
    expect(allow(1000)).toBe(true)
    expect(allow(1500)).toBe(false)
    expect(allow(2000)).toBe(true)
  })

  it('keeps separate gates independent', () => {
    const a = createThrottle(1000)
    const b = createThrottle(1000)
    expect(a(0)).toBe(true)
    expect(b(10)).toBe(true)
    expect(a(20)).toBe(false)
  })

  it('lets a call through at time zero', () => {
    expect(createThrottle(5000)(0)).toBe(true)
  })
})
