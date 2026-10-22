// Renders Herman 64's sprite strips into src/renderer/src/herman/sprites/:
//   <skin>-<animation>.png  one strip of 84×84 frames, played with CSS steps()
//   <skin>-still.png        the skin from the front, at rest (the picker's thumbnail)
// Run with: node scripts/herman64/generate.mjs
// The frame counts and speeds must match src/renderer/src/herman/sprites.ts (a test checks the PNG widths).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ANIMATIONS, CAM, herman } from './herman64.mjs'
import { png, render } from './ps1.mjs'
import { SKINS } from './skins.mjs'
import { STONE_ANIMATIONS, stone } from './stone.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', '..', 'src', 'renderer', 'src', 'herman', 'sprites')
mkdirSync(out, { recursive: true })

function strip(build, poses) {
  const shots = poses.map((p) => render(build(p), { ...CAM, raw: true }))
  const { W, H } = shots[0]
  const n = shots.length
  const rgba = new Uint8ClampedArray(W * n * H * 4)
  shots.forEach((s, f) => {
    for (let y = 0; y < H; y++) rgba.set(s.color.subarray(y * W * 4, (y + 1) * W * 4), (y * W * n + f * W) * 4)
  })
  return Buffer.from(png(W * n, H, rgba).split(',')[1], 'base64')
}
const still = (mesh) => Buffer.from(render(mesh, CAM).split(',')[1], 'base64')

const ALL = [...SKINS.map((s) => ({ id: s.id, build: (p) => herman(s.o, p), poses: (a) => a.poses })), { id: 'stone', build: (p) => stone(null, p), poses: (a) => STONE_ANIMATIONS[a.id] }]

let bytes = 0
for (const skin of ALL) {
  const s = still(skin.build({}))
  writeFileSync(join(out, `${skin.id}-still.png`), s)
  bytes += s.length
  for (const a of ANIMATIONS) {
    const poses = skin.poses(a)
    if (poses.length !== a.poses.length) throw new Error(`${skin.id}/${a.id}: ${poses.length} frames, expected ${a.poses.length}`)
    const data = strip(skin.build, poses)
    writeFileSync(join(out, `${skin.id}-${a.id}.png`), data)
    bytes += data.length
  }
}
console.log(`${ALL.length} skins × ${ANIMATIONS.length + 1} images, ${Math.round(bytes / 1024)} KB → ${out}`)
console.log(ANIMATIONS.map((a) => `${a.id}: ${a.poses.length} frames @ ${a.fps} fps`).join('\n'))
