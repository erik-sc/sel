// Constellation objects: each month's figure (src/shared/sky/figures.ts) built in 3D, its stars as
// octahedra at a depth drawn from the figure's id, its lines as thin glowing beams, swaying gently.
// 16 frames of 84×84, a seamless loop (yaw = 35° · sin), transparent background, one strip per theme.
import { Cv, beam, glow, octa, rng, strip, xf } from './sky.mjs'

export const FIGURE_FRAMES = 16
const S = 84

function mesh(fig, th) {
  const q = rng('sel-sky64-depth:' + fig.id)
  const pts = fig.stars.map(([x, y]) => [((x - 50) / 100) * 3.1, -((y - 50) / 100) * 3.1, (q() - 0.5) * 1.1])
  const m = []
  for (const line of fig.lines) for (let i = 0; i + 1 < line.length; i++) m.push(...glow(beam(pts[line[i]], pts[line[i + 1]], 0.06, th.accent)))
  pts.forEach((p, i) => m.push(...xf(octa(0.17, th.ink), { s: [1, 1.25, 1], r: [0, i * 40, 0], t: p })))
  return m
}

/** The strip (a PNG Buffer) of one figure in one theme. */
export function figureStrip(fig, th) {
  const m = mesh(fig, th)
  const frames = Array.from({ length: FIGURE_FRAMES }, (_, f) =>
    new Cv(S, S, th).draw(m, { yaw: 35 * Math.sin((2 * Math.PI * f) / FIGURE_FRAMES), pitch: 10, dist: 9, fov: 4.2, scale: 42 }))
  return strip(frames)
}
