// Renders the Sky's "64" sprites into src/renderer/src/sky/sprites/, with the Herman 64 renderer
// (../herman64/ps1.mjs, through ./sky.mjs). Run from the repo root: node scripts/sky64/generate.mjs
//
// Every file comes in two themes, -light and -dark (the inks that read on paper don't read on charcoal).
// Sprites have a transparent background; the hill is a full scene with the theme's ground and dot grid.
//
//   figure-<id>-<theme>.png      one per figure in src/shared/sky/figures.ts (45): 16 frames of 84×84,
//                                a seamless sway loop. Play at 8 fps (2 s), steps(16), infinite.
//   rare-<kind>-<theme>.png      12 frames of 84×84. kinds: eclipse, meteors, comet, first-star (the
//                                'anniversary' event), echo (on this day), season, new-year. Play at 8 fps;
//                                eclipse and new-year once, holding the last frame (animation-fill-mode:
//                                forwards); the others loop. Reduced motion: show frame 0 (eclipse and
//                                new-year: the last frame).
//   hill-<theme>.png             240×136 still, the Rest screen's hill and night sky without Herman, shown
//                                at 2×. The 84 px Herman sprite at the same 2× goes at the top-left printed
//                                below; the moon (its real phase) is drawn by the app in the printed slot.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKY_FIGURES } from '../../src/shared/sky/figures.ts'
import { THEMES } from './sky.mjs'
import { figureStrip, FIGURE_FRAMES } from './figures.mjs'
import { RARE, RARE_FRAMES, rareStrip } from './rare.mjs'
import { ARC, MOON_SLOT, hill, spriteAnchor } from './hill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', '..', 'src', 'renderer', 'src', 'sky', 'sprites')
mkdirSync(out, { recursive: true })

const sizes = { figure: 0, rare: 0, hill: 0 }
const write = (kind, name, buf) => { writeFileSync(join(out, name), buf); sizes[kind] += buf.length }

for (const th of THEMES) {
  for (const fig of SKY_FIGURES) write('figure', `figure-${fig.id}-${th.id}.png`, figureStrip(fig, th))
  for (const r of RARE) write('rare', `rare-${r.id}-${th.id}.png`, rareStrip(r, th))
  write('hill', `hill-${th.id}.png`, hill(th))
}

const kb = (b) => (b / 1024).toFixed(1) + ' KB'
console.log(`figures: ${SKY_FIGURES.length} × 2 themes, ${FIGURE_FRAMES} frames of 84 px, ${kb(sizes.figure)}`)
console.log(`rare nights: ${RARE.map((r) => r.id).join(', ')} × 2 themes, ${RARE_FRAMES} frames of 84 px, ${kb(sizes.rare)}`)
console.log(`hill: 240×136 × 2 themes, ${kb(sizes.hill)}`)
console.log(`total ${kb(sizes.figure + sizes.rare + sizes.hill)} → ${out}`)
const a = spriteAnchor()
console.log(`hill: Herman's feet at (${a.feet}) of 240×136; in his 84 px frame they are at (${a.feetInSprite}); so the sprite's top-left goes at (${a.spriteTopLeft}) (same scale as the hill)`)
console.log(`hill: moon slot centre (${MOON_SLOT.x}, ${MOON_SLOT.y}) radius ${MOON_SLOT.r}; year arc centre (${ARC.cx}, ${ARC.cy}) r ${ARC.r}, ${ARC.from}° to ${ARC.to}°`)
