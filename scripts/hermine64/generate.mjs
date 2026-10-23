// Renders Hermine 64's sprite strips into src/renderer/src/herman/sprites/hermine/:
//   <skin>-<animation>.png  one strip of 84×84 frames, played with CSS steps()
//   <skin>-still.png        the skin from the front, at rest (the picker's thumbnail)
// Run with: node scripts/hermine64/generate.mjs
// The same animations, frame counts and speeds as Herman 64's (src/renderer/src/herman/sprites.ts;
// a test checks the PNG widths of both).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PALETTE } from '../herman64/palette.mjs'
import { png, render } from '../herman64/ps1.mjs'
import { ANIMATIONS, CAM, hermine } from './hermine.mjs'
import { SKINS } from './skins.mjs'

const here = dirname(fileURLToPath(import.meta.url))
/** In the system's inks, with no outline around her. */
const LOOK = { ...CAM, palette: PALETTE, outline: null }
const out = join(here, '..', '..', 'src', 'renderer', 'src', 'herman', 'sprites', 'hermine')
mkdirSync(out, { recursive: true })

function strip(build, poses) {
  const shots = poses.map((p) => render(build(p), { ...LOOK, raw: true }))
  const { W, H } = shots[0]
  const n = shots.length
  const rgba = new Uint8ClampedArray(W * n * H * 4)
  shots.forEach((s, f) => {
    for (let y = 0; y < H; y++) rgba.set(s.color.subarray(y * W * 4, (y + 1) * W * 4), (y * W * n + f * W) * 4)
  })
  return Buffer.from(png(W * n, H, rgba).split(',')[1], 'base64')
}
const still = (mesh) => Buffer.from(render(mesh, LOOK).split(',')[1], 'base64')

let bytes = 0
for (const skin of SKINS) {
  const build = (p) => hermine(skin.o, p)
  const s = still(build({}))
  writeFileSync(join(out, `${skin.id}-still.png`), s)
  bytes += s.length
  for (const a of ANIMATIONS) {
    const data = strip(build, a.poses)
    writeFileSync(join(out, `${skin.id}-${a.id}.png`), data)
    bytes += data.length
  }
}
console.log(`${SKINS.length} skins × ${ANIMATIONS.length + 1} images, ${Math.round(bytes / 1024)} KB → ${out}`)
console.log(ANIMATIONS.map((a) => `${a.id}: ${a.poses.length} frames @ ${a.fps} fps`).join('\n'))
