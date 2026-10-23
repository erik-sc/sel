// Herman 64's sprites, and Hermine 64's: one PNG strip per skin and animation, 84×84 frames side by side,
// played with CSS steps(). His are in sprites/, made by scripts/herman64/generate.mjs; hers in
// sprites/hermine/, made by scripts/hermine64/generate.mjs. Both play the same animations: the frame
// counts and speeds here must match what both render (a test checks the PNG widths).
import type { HermanSkinId, HermineSkinId, PersonaId } from '@shared/herman'

export const FRAME = 84

export const ANIMATIONS = ['idle', 'spin', 'wave', 'think', 'talk', 'sleep', 'enter', 'cheer'] as const
export type HermanAnimation = (typeof ANIMATIONS)[number]

/** Frames in each strip, and how many play per second. */
export const TIMING: Record<HermanAnimation, { frames: number; fps: number }> = {
  idle: { frames: 12, fps: 8 },
  spin: { frames: 16, fps: 10 },
  wave: { frames: 10, fps: 10 },
  think: { frames: 16, fps: 10 },
  talk: { frames: 8, fps: 8 },
  sleep: { frames: 12, fps: 4 },
  enter: { frames: 26, fps: 12 },
  cheer: { frames: 12, fps: 10 }
}

const URLS = import.meta.glob<string>(['./sprites/*.png', './sprites/hermine/*.png'], { eager: true, query: '?url', import: 'default' })

/** Where a persona's strips are. */
const FOLDER: Record<PersonaId, string> = { herman: './sprites/', hermine: './sprites/hermine/' }

/** The strip of one of Herman's skins in one animation, or its still when the animation is 'still'. */
export function spriteUrl(skin: HermanSkinId, animation: HermanAnimation | 'still'): string
/** The strip of one of a persona's skins: Hermine's skins are hers alone. */
export function spriteUrl(skin: HermanSkinId | HermineSkinId, animation: HermanAnimation | 'still', persona: PersonaId): string
export function spriteUrl(skin: string, animation: HermanAnimation | 'still', persona: PersonaId = 'herman'): string {
  const folder = FOLDER[persona]
  return URLS[`${folder}${skin}-${animation}.png`] ?? URLS[`${folder}classic-${animation}.png`] ?? ''
}
