// Rare nights as 84×84 vignettes, 12 frames each, transparent background, one strip per theme.
// Kinds follow src/shared/sky/events.ts (eclipse, meteors, comet, anniversary → first-star, season,
// new-year) plus echo ("on this day"). Loops unless noted: eclipse and new-year play once and hold the last frame.
import { box, frustum, sphere, torus } from '../herman64/ps1.mjs'
import { Cv, beam, bayer, glow, hex, moonInks, octa, strip, xf } from './sky.mjs'

export const RARE_FRAMES = 12
const S = 84, N = RARE_FRAMES, TAU = Math.PI * 2
const cam = { yaw: 0, pitch: 0, dist: 10, fov: 4.2, scale: 42 }
const blank = (th) => new Cv(S, S, th)

/** The Earth's shadow crosses a full moon; inside it the moon turns copper (Bayer at the edge). Play once. */
function eclipse(th, f) {
  const cv = blank(th).draw(sphere(1.7, 8, 6, th.moon), { ...cam, light: [0, 0, 1], ambient: 0, inks: moonInks(th), levels: [0.06, 9] })
  const ux = -8 + (f / (N - 1)) * 52, uy = 40, ur = 30
  const lit = hex(th.moon)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = cv.get(x, y)
    if (c[3] === 0) continue
    const d = Math.hypot(x + 0.5 - ux, y + 0.5 - uy)
    const isLit = c[0] === lit[0] && c[1] === lit[1] && c[2] === lit[2]
    if (d < ur - 2 || (d < ur + 1 && bayer(x, y) < (ur + 1 - d) / 3)) cv.px(x, y, isLit ? th.copper2 : th.copper)
  }
  return cv
}
/** Six streaks from one radiant (top right). */
function meteors(th, f) {
  const m = []
  for (let k = 0; k < 6; k++) {
    const t = ((f + k * 2) % N) / N
    if (t > 0.85) continue
    const a = -2.3 + k * 0.17, r0 = 0.4 + t * 4.6
    const at = (r) => [1.9 + Math.cos(a) * r, 1.9 + Math.sin(a) * r, -k * 0.3]
    m.push(...glow(beam(at(r0 - 2), at(r0), 0.1, th.ink2)), ...xf(octa(0.13, th.id === 'dark' ? th.ink : th.accent, true), { t: at(r0) }))
  }
  return blank(th).draw(m, cam)
}
/** A nucleus and three tails, turning a little. */
function comet(th, f) {
  const nuc = [1.3, 1.2, 0]
  const m = [...xf(octa(0.3, th.id === 'dark' ? th.ink : th.accent), { r: [f * 30, f * 30, 0], t: nuc })]
  ;[[0, 0.5, 4.2, th.ink2], [9, 0.32, 3.4, th.faint], [-9, 0.28, 3.0, th.faint]].forEach(([dr, w, h, c], i) => {
    const ang = ((-53 + dr + 2 * Math.sin((TAU * (f + i * 3)) / N)) * Math.PI) / 180
    const up = [-Math.sin(ang), Math.cos(ang)]
    m.push(...xf(frustum(w, 0, h, 5, c), { r: [0, 0, (ang * 180) / Math.PI], t: [nuc[0] - (up[0] * h) / 2, nuc[1] - (up[1] * h) / 2, -0.2 - i * 0.1] }))
  })
  return blank(th).draw(m, { ...cam, yaw: 18 * Math.sin((TAU * f) / N), ambient: 0.6 })
}
/** The four-point glint of the very first star, opening and turning. */
function firstStar(th, f) {
  const open = Math.sin((Math.PI * f) / N) * 0.8 + 0.4
  return blank(th).draw([
    ...xf(octa(0.5, th.accent), { s: [open * 4, 0.45, 0.45], r: [0, f * 30, 0] }),
    ...xf(octa(0.5, th.accent), { s: [0.45, open * 4, 0.45], r: [0, f * 30, 0] }),
    ...xf(octa(0.32, th.id === 'dark' ? th.moon : th.ink), { r: [f * 15, f * 30, 0] })
  ], { ...cam, roll: f * 7.5 })
}
/** On this day: last year's star, two rings breathing out of step. */
function echo(th, f) {
  const b1 = 1 + 0.25 * Math.sin((TAU * f) / N), b2 = 1 + 0.25 * Math.sin((TAU * f) / N + 2.2)
  return blank(th).draw([
    ...xf(octa(0.38, th.accent), { s: [1, 1.3, 1], r: [0, f * 30, 0] }),
    ...glow(xf(torus(1.0 * b1, 0.06, 16, 3, th.accent), { r: [8, 0, 0] })),
    ...glow(xf(torus(1.6 * b2, 0.05, 20, 3, th.accent2), { r: [8, 0, 0] }))
  ], cam)
}
/** Solstice or equinox: the sun's path over a horizon, the sun walking along it. */
function season(th, f) {
  const arc = (t) => { const a = Math.PI * (1 - t); return [Math.cos(a) * 2.6, -1.1 + Math.sin(a) * 2.2, 0] }
  const m = [...glow(beam([-3, -1.1, 0], [3, -1.1, 0], 0.08, th.ink2))]
  for (let i = 1; i < 12; i++) if (i % 2) m.push(...xf(octa(0.07, th.faint, true), { t: arc(i / 12) }))
  m.push(...xf(sphere(0.55, 8, 6, th.moon), { t: arc(0.08 + (0.84 * f) / (N - 1)) }))
  return blank(th).draw(m, { ...cam, ambient: 0.5, inks: moonInks(th), levels: [0.06, 9] })
}
/** New year: the wheel of the year closes, its twelve marks lighting one by one, then a star. Play once. */
function newYear(th, f) {
  const m = [...glow(torus(1.7, 0.05, 24, 3, th.ink2))]
  for (let k = 0; k < 12; k++) {
    const a = -Math.PI / 2 + (k / 12) * TAU, on = k <= f, r = on ? 0.2 : 0.12
    m.push(...xf(box(r, r, r, on ? th.accent : th.faint), { r: [45, 45, 0], t: [Math.cos(a) * 1.7, -Math.sin(a) * 1.7, 0] }))
  }
  if (f === N - 1) m.push(...xf(octa(0.4, th.id === 'dark' ? th.moon : th.ink), { s: [1, 1.3, 1], r: [0, 30, 0] }))
  return blank(th).draw(xf(m, { r: [-50, 0, 0] }), cam)
}

export const RARE = [
  { id: 'eclipse', fn: eclipse, once: true },
  { id: 'meteors', fn: meteors },
  { id: 'comet', fn: comet },
  { id: 'first-star', fn: firstStar },
  { id: 'echo', fn: echo },
  { id: 'season', fn: season },
  { id: 'new-year', fn: newYear, once: true }
]
export const rareStrip = (r, th) => strip(Array.from({ length: N }, (_, f) => r.fn(th, f)))
