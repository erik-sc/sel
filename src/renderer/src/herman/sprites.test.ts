/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HERMAN_SEASONAL_SKINS, HERMAN_SKINS, hermanSetting, wornSkin } from '@shared/herman'
import { POSE_ANIMATION } from './Herman64'
import { ANIMATIONS, FRAME, TIMING } from './sprites'

const dir = fileURLToPath(new URL('./sprites/', import.meta.url))
/** Width and height from a PNG's IHDR chunk. */
function size(file: string): [number, number] {
  const png = readFileSync(dir + file)
  expect(png.subarray(1, 4).toString('ascii'), file).toBe('PNG')
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

describe('Herman 64 sprites', () => {
  it('has a strip for every skin in every animation, and a still of each skin, and nothing else', () => {
    const expected = HERMAN_SKINS.flatMap((skin) => [...ANIMATIONS.map((a) => `${skin}-${a}.png`), `${skin}-still.png`]).sort()
    expect(
      readdirSync(dir)
        .filter((file) => file.endsWith('.png'))
        .sort()
    ).toEqual(expected)
  })

  it('holds as many frames as the timing says, 84px each, in every skin', () => {
    for (const skin of HERMAN_SKINS) {
      for (const animation of ANIMATIONS)
        expect(size(`${skin}-${animation}.png`), `${skin}-${animation}`).toEqual([TIMING[animation].frames * FRAME, FRAME])
      expect(size(`${skin}-still.png`), `${skin}-still`).toEqual([FRAME, FRAME])
    }
  })

  it('plays an animation for every pose', () => {
    for (const animation of Object.values(POSE_ANIMATION)) expect(ANIMATIONS).toContain(animation)
  })
})

describe('his outfits', () => {
  it('wears an everyday outfit all year', () => {
    for (const month of [0, 5, 11]) expect(wornSkin('stone', false, new Date(2026, month, 15))).toBe('stone')
  })

  it('wears a seasonal outfit only in its month, and only when they are on', () => {
    expect(HERMAN_SEASONAL_SKINS).toEqual({ santa: 12, pumpkin: 10 })
    expect(wornSkin('santa', true, new Date(2026, 11, 24))).toBe('santa')
    expect(wornSkin('santa', true, new Date(2026, 10, 30))).toBe('classic')
    expect(wornSkin('santa', false, new Date(2026, 11, 24))).toBe('classic')
    expect(wornSkin('pumpkin', true, new Date(2026, 9, 31))).toBe('pumpkin')
  })

  it('falls back to the classic outfit for anything it does not know', () => {
    expect(hermanSetting('skin', 'clippy')).toBe('classic')
    expect(hermanSetting('skin', null)).toBe('classic')
    expect(hermanSetting('seasonalSkins', 'yes')).toBe(false)
  })
})
