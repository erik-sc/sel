// Herman 64's sprites: one PNG strip per skin and animation, 84×84 frames side by side, played with CSS
// steps(). The strips are made by scripts/herman64/generate.mjs; the frame counts and speeds here must
// match what it renders (a test checks the PNG widths).
import type { HermanSkinId } from '@shared/herman'

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

const URLS = import.meta.glob<string>('./sprites/*.png', { eager: true, query: '?url', import: 'default' })

/** The strip of one skin in one animation, or its still when the animation is 'still'. */
export function spriteUrl(skin: HermanSkinId, animation: HermanAnimation | 'still'): string {
  return URLS[`./sprites/${skin}-${animation}.png`] ?? URLS[`./sprites/classic-${animation}.png`] ?? ''
}
