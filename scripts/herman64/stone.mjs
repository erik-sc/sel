// The Stone skin: three stacked rocks with eyes on the top one. It has no arms and no staff, so it does
// not wear Herman's rig: it has a rig of its own and its own takes on the same eight animations.
import { box, render, sphere, xf } from './ps1.mjs'
import { CAM, GOLD } from './herman64.mjs'

const TAU = Math.PI * 2
const GROUND = -0.56
const DARK = '#1e1d22'

// Each rock: its shape, and the point it rests on (where it pivots when it tilts or squashes).
const ROCKS = [
  { mesh: () => sphere(0.9, 7, 4, '#8f8a80', 0.12, 3), s: [1.2, 0.5, 0.9], rest: [0, GROUND, 0], h: 0.45 },
  { mesh: () => sphere(0.65, 7, 4, '#a7a296', 0.12, 9), s: [1.15, 0.55, 0.9], rest: [0.05, GROUND + 0.84, 0], h: 0.36 },
  { mesh: () => sphere(0.5, 7, 5, '#bdb8ac', 0.1, 21), s: [1.05, 0.75, 0.95], rest: [-0.02, GROUND + 1.48, 0], h: 0.375 }
]

function eyes(blink) {
  return [-1, 1].flatMap((s) => [
    ...xf(sphere(0.11, 8, 6, '#f4f2ec'), { s: [1, Math.max(0.12, 1 - blink * 0.9) * 1, 0.55], t: [s * 0.17, 0.42, 0.4] }),
    ...(blink > 0.5 ? [] : xf(sphere(0.055, 6, 4, DARK), { s: [1, 1, 0.5], t: [s * 0.17 + 0.02, 0.41, 0.45] })),
    ...(blink > 0.5 ? xf(box(0.22, 0.03, 0.03, '#6f6a60'), { t: [s * 0.17, 0.42, 0.46] }) : [])
  ])
}

/**
 * The stack in a pose. Each rock takes { dx, dy, tilt (deg about z), turn (deg about y), squash };
 * blink closes the eyes; yaw turns the whole stack; extras are added as they are.
 */
export function stone(_skin, p = {}) {
  const { yaw = 0, blink = 0, rocks = [], extras = [] } = p
  let y = GROUND
  const out = []
  ROCKS.forEach((rock, i) => {
    const r = { dx: 0, dy: 0, tilt: 0, turn: 0, squash: 1, ...(rocks[i] ?? {}) }
    const h = rock.h * 2 * r.squash
    const base = [rock.rest[0] + r.dx, y + r.dy, 0]
    // the rock centred on its own base, squashed, tilted, then set on the one below
    let mesh = xf(rock.mesh(), { s: rock.s, t: [0, rock.h, 0] })
    if (i === 2) mesh = [...mesh, ...eyes(blink)]
    mesh = xf(mesh, { s: [1 + (1 - r.squash) * 0.5, r.squash, 1 + (1 - r.squash) * 0.5], r: [0, r.turn, r.tilt], t: base })
    out.push(...mesh)
    y += h * 0.93
  })
  // a little larger than Herman's body, so the stack reads at the same size in the corner
  const big = xf(xf(out, { t: [0, -GROUND, 0] }), { s: 1.3, r: [0, yaw, 0], t: [0, GROUND, 0] })
  return [...big, ...extras]
}

const frames = (n, fn) => Array.from({ length: n }, (_, i) => fn(i / n, i))
const spark = (x, y, z, s = 0.07) => xf(box(s, s, s, '#fff1a8'), { r: [45, 45, 0], t: [x, y, z] })
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3)

/** A rock dropped from above: falls from start to end frame, squashes on landing, settles. */
function drop(i, start, end) {
  if (i < start) return { dy: 6, squash: 1 }
  if (i < end) return { dy: 3.2 * (1 - ease((i - start) / (end - start))) ** 1.4, squash: 1.08 }
  const k = i - end
  return { dy: [0, 0.06, 0.02, 0][k] ?? 0, squash: [0.78, 1.08, 0.97, 1][k] ?? 1 }
}

export const STONE_ANIMATIONS = {
  idle: frames(12, (t, i) => ({
    rocks: [0, 1, 2].map((k) => ({ squash: 1 + 0.02 * Math.sin(TAU * t - k * 0.8) })),
    blink: i === 9 ? 0.6 : i === 10 ? 1 : 0
  })),
  spin: frames(16, (t) => ({ yaw: t * 360, rocks: [{}, {}, { dy: 0.04 * Math.abs(Math.sin(TAU * t * 2)) }] })),
  // hello: the top rock rocks side to side, the middle one follows a little
  wave: frames(10, (t) => ({ rocks: [{}, { tilt: 4 * Math.sin(TAU * t * 2) }, { tilt: 14 * Math.sin(TAU * t * 2), dx: -0.04 * Math.sin(TAU * t * 2) }] })),
  // thinking: the top rock turns slowly, looking around; two gold motes circle above
  think: frames(16, (t) => ({
    rocks: [{}, {}, { turn: 40 * Math.sin(TAU * t), tilt: 4 }],
    extras: [
      ...xf(sphere(0.09, 6, 4, GOLD), { t: [0.5 * Math.cos(TAU * t), 1.65, 0.5 * Math.sin(TAU * t)] }),
      ...xf(sphere(0.06, 5, 3, GOLD), { t: [0.5 * Math.cos(TAU * t + 2.6), 1.7, 0.5 * Math.sin(TAU * t + 2.6)] })
    ]
  })),
  // talking: the top rock lifts and drops like a jaw
  talk: [0, 1, 0.5, 1, 0, 0.7, 1, 0.3].map((m) => ({ rocks: [{}, { squash: 1 - 0.03 * m }, { dy: 0.12 * m, squash: 1 + 0.03 * m }] })),
  sleep: frames(12, (t) => ({
    blink: 1,
    rocks: [{}, { squash: 0.98 + 0.01 * Math.sin(TAU * t) }, { tilt: -8, dy: -0.04, squash: 0.97 + 0.015 * Math.sin(TAU * t) }]
  })),
  // appearing: the rocks fall in one by one and stack themselves, then it blinks
  enter: [...frames(26, (_t, i) => ({ rocks: [drop(i, 0, 4), drop(i, 4, 8), drop(i, 8, 12)], blink: i === 20 ? 1 : 0 }))],
  // cheering: the rocks hop one after the other, bottom to top, and sparks fly
  cheer: frames(12, (_t, i) => {
    const hop = (k) => {
      const f = i - k * 2
      return f >= 0 && f < 5 ? { dy: Math.sin((Math.PI * f) / 4) * 0.35, squash: f === 0 ? 0.85 : 1.05 } : {}
    }
    const sparks = i >= 4 && i <= 10 ? [[-0.6, 1.9, 0.2], [0.5, 2.0, 0.3], [-0.2, 2.3, 0], [0.7, 1.6, 0.1]].map(([x, y, z], k) => spark(x + Math.sin(i + k) * 0.08, y + (i - 4) * 0.03, z, 0.06 + ((i + k) % 3) * 0.02)).flat() : []
    return { rocks: [hop(0), hop(1), hop(2)], extras: sparks }
  })
}

export const stoneStill = () => render(stone(null), CAM)
