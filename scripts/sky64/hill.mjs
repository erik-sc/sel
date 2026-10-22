// Herman's hill for the Rest screen ("Até amanhã"): a low-poly hill under a night sky of pixel stars,
// 240×136, WITHOUT Herman: the app lays the 84 px sprite of the user's skin on top. The hill is drawn with
// the sprites' own camera (yaw −24°, pitch 6°, the same pixels per unit at his feet), so he stands on it
// at the same scale. The moon is left out (its phase changes every night): the app draws it in MOON_SLOT.
import { frustum, sphere } from '../herman64/ps1.mjs'
import { CAM } from '../herman64/herman64.mjs'
import { Cv, rng, still, xf } from './sky.mjs'

export const W = 240, H = 136
/** Herman's feet in his own rig (ground under the robe). */
const FEET = [0, -0.56, 0]
/** Pixels per unit at his feet in the 84 px sprites: 42 · fov / (dist − z). */
const PPU = (42 * 4.6) / CAM.dist
const DIST = 22
const HILL_CAM = { yaw: CAM.yaw, pitch: CAM.pitch, dist: DIST, fov: (PPU * DIST) / (H / 2), center: FEET, ox: 78, oy: 112 }
/** Where the app draws the moon: centre and radius, in the 240×136 frame. */
export const MOON_SLOT = { x: 214, y: 22, r: 9 }
/** The empty dotted arc of the year over the hill (centre, radius, from/to angle in degrees, screen y down). */
export const ARC = { cx: 122, cy: 172, r: 140, from: -152, to: -28 }

function hillMesh(th) {
  // modelled at the concept's size, then shrunk about Herman's feet to the sprites' scale (pixels per unit);
  // the ground under him sits a hair below FEET so he never sinks in
  const m = xf([
    ...xf(sphere(7.5, 12, 6, th.grass, 0.06, 4), { s: [1.25, 0.42, 0.7], t: [0.6, -3.7, -1] }),
    ...xf(sphere(5, 10, 5, th.rock, 0.1, 9), { s: [1.4, 0.4, 0.6], t: [9, -3.9, -4] }),
    ...xf(sphere(0.35, 6, 3, '#8f8a80', 0.2, 2), { s: [1.3, 0.7, 1], t: [-1.8, -0.75, 0.6] }),
    ...[[-3.4, 0.2], [2.6, 0.4], [-0.9, 1.4]].flatMap(([x, z]) => xf(frustum(0.18, 0, 0.5, 4, th.grass), { t: [x, -0.65 - Math.abs(x) * 0.12, z] }))
  ], { t: [0, 0.56, 0] })
  return xf(m, { s: HILL_SHRINK, t: [0, -0.56 - 0.04, 0] })
}
const HILL_SHRINK = 0.62

export function hill(th, { raw = false } = {}) {
  const cv = new Cv(W, H, th).fill(th.ground).dots(th.dot)
  const q = rng('sel-sky64-hill')
  // background stars: single pixels; a few brighter ones as 5 px crosses
  for (let i = 0; i < 70; i++) cv.px(Math.floor(q() * W), Math.floor(q() * H * 0.8), th.faint)
  for (let i = 0; i < 9; i++) { const x = 8 + Math.floor(q() * (W - 16)), y = 6 + Math.floor(q() * 60); for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) cv.px(x + a, y + b, th.ink2) }
  // the Milky Way: a diagonal band of dust
  for (let i = 0; i < 200; i++) {
    const t = q(), off = (q() + q() + q() - 1.5) * 0.07
    cv.px(Math.floor(t * W), Math.floor((0.73 - t * 0.72 + Math.sin(t * 5) * 0.04 + off) * H), q() < 0.3 ? th.ink2 : th.faint)
  }
  // the year's arc, dotted and empty
  for (let a = ARC.from; a <= ARC.to; a += 1.6) cv.px(Math.round(ARC.cx + Math.cos((a * Math.PI) / 180) * ARC.r), Math.round(ARC.cy + Math.sin((a * Math.PI) / 180) * ARC.r), th.faint)
  // keep the moon's slot clear of stars
  for (let y = MOON_SLOT.y - MOON_SLOT.r - 2; y <= MOON_SLOT.y + MOON_SLOT.r + 2; y++) for (let x = MOON_SLOT.x - MOON_SLOT.r - 2; x <= MOON_SLOT.x + MOON_SLOT.r + 2; x++) {
    const onDot = (x - 2) % 6 === 0 && (y - 2) % 6 === 0
    cv.px(x, y, onDot ? th.dot : th.ground)
  }
  cv.draw(hillMesh(th), { ...HILL_CAM, ambient: 0.5 })
  return raw ? cv : still(cv)
}

/** Where the 84 px sprite's top-left corner goes in the hill frame so his feet land on the hill. */
export function spriteAnchor() {
  const scene = new Cv(W, H, {}).project(FEET, HILL_CAM)
  const sprite = new Cv(84, 84, {}).project(FEET, { ...CAM, fov: 4.6, scale: 42 })
  return { feet: [scene[0], scene[1]], feetInSprite: [sprite[0], sprite[1]], spriteTopLeft: [scene[0] - sprite[0], scene[1] - sprite[1]] }
}
