// Hermine 64: Herman's counterpart (Hermine, from Hesse's Steppenwolf), in the same PS1 renderer,
// the same inks and the same eight animations. Her own rig: a dress, a face with eyes, hair styles.
import { box, cyl, frustum, sphere, torus, xf } from '../herman64/ps1.mjs'

export const SKIN = '#e9c7a2', DARK = '#24221d', GOLD = '#d1b660', WOOD = '#7a5632', CREAM = '#ebe7de', BLUSH = '#e2827e'
const GROUND = -0.56
const HEAD = [0, 1.62, 0]
const NECK = [0, 1.2, 0]
const SHOULDER_L = [-0.36, 1.12, 0.12]
export const HAND = [-0.82, 0.8, 0.22]
const TAU = Math.PI * 2

const mid = (t, k) => (t.v[0][k] + t.v[1][k] + t.v[2][k]) / 3
/** Keeps the triangles behind z, or above y (to open a face in a cap of hair or a hood). */
const open = (mesh, z, y = Infinity) => mesh.filter((t) => mid(t, 2) < z || mid(t, 1) > y)
const about = (mesh, pivot, r) => xf(xf(mesh, { t: pivot.map((v) => -v) }), { r, t: pivot })
const at = (mesh, p) => xf(mesh, { t: p })

/** Hair styles, in head space (the head's centre at the origin, radius 0.42). */
export const HAIR = {
  bob: (c) => [
    ...open(xf(sphere(0.47, 10, 7, c), { t: [0, 0.04, -0.02] }), 0.12, 0.3),
    ...xf(box(0.66, 0.14, 0.14, c), { r: [-18, 0, 0], t: [0, 0.27, 0.33] }),
    ...[-1, 1].flatMap((s) => xf(box(0.15, 0.5, 0.42, c), { t: [s * 0.41, -0.08, 0.02] }))
  ],
  bun: (c) => [
    ...open(xf(sphere(0.455, 10, 7, c), { t: [0, 0.03, -0.02] }), 0.2, 0.32),
    ...xf(box(0.5, 0.08, 0.1, c), { r: [-24, 0, 6], t: [0.04, 0.33, 0.3] }),
    ...xf(sphere(0.2, 7, 5, c), { t: [0, 0.38, -0.3] })
  ],
  long: (c) => [
    ...open(xf(sphere(0.47, 10, 7, c), { t: [0, 0.04, -0.02] }), 0.12, 0.3),
    ...xf(box(0.66, 0.14, 0.14, c), { r: [-18, 0, 0], t: [0, 0.27, 0.33] }),
    ...[-1, 1].flatMap((s) => xf(box(0.15, 0.85, 0.36, c), { t: [s * 0.4, -0.26, -0.02] })),
    ...xf(box(0.82, 0.95, 0.16, c), { t: [0, -0.3, -0.3] })
  ],
  pony: (c) => [
    ...open(xf(sphere(0.455, 10, 7, c), { t: [0, 0.03, -0.02] }), 0.2, 0.3),
    ...xf(box(0.6, 0.12, 0.12, c), { r: [-18, 0, -8], t: [0, 0.28, 0.32] }),
    ...xf(frustum(0.13, 0.04, 0.75, 6, c), { r: [-150, 0, 0], t: [0, 0.02, -0.62] })
  ],
  none: () => []
}

/**
 * Hermine in a skin and a pose.
 * Skin: { dress, hem, sleeve?, hair, hairColor?, top?, lens?, rim?, hat?, body?, prop? } — hat moves with the head, prop with the left hand.
 * Pose: yaw, bob, squash, lean, headPitch/Yaw/Roll, blink 0..1, mouth 0..1, wave (right arm angle, or null), propLift, extras.
 */
export function hermine(o, p = {}) {
  const { yaw = 0, bob = 0, squash = 1, lean = 0, headPitch = 0, headYaw = 0, headRoll = 0, blink = 0, mouth = 0, wave = null, propLift = 0, extras = [] } = p
  const sleeve = o.sleeve ?? o.top ?? o.dress
  const shut = Math.max(0.12, 1 - blink * 0.9)
  const face = [
    ...sphere(0.42, 9, 7, SKIN),
    // the face: a flat plate turned to the camera, so it stays in the skin's lit tone
    ...xf(cyl(0.34, 0.06, 10, SKIN), { r: [90, 0, 0], s: [1, 1, 1.1], t: [0, -0.03, 0.36] }),
    ...xf(frustum(0.05, 0, 0.1, 4, '#d9a882'), { r: [90, 0, 0], t: [0, -0.06, 0.44] }),
    ...[-1, 1].flatMap((s) => xf(box(0.09, 0.15 * shut, 0.03, o.eyes ?? DARK), { t: [s * 0.14, 0.05, 0.4] })),
    ...(blink > 0.5 ? [-1, 1].flatMap((s) => xf(box(0.14, 0.03, 0.03, WOOD), { t: [s * 0.14, 0.03, 0.41] })) : []),
    ...[-1, 1].flatMap((s) => xf(box(0.07, 0.035, 0.02, BLUSH), { t: [s * 0.23, -0.1, 0.4] })),
    ...xf(box(0.12, 0.03 + mouth * 0.07, 0.03, '#a3363a'), { t: [0, -0.19 - mouth * 0.02, 0.41] }),
    ...(o.lens ? [-1, 1].flatMap((s) => [...xf(torus(0.11, 0.022, 10, 4, o.rim ?? DARK), { t: [s * 0.14, 0.05, 0.44] }), ...xf(sphere(0.07, 5, 4, o.lens), { s: [1, 1, 0.3], t: [s * 0.14, 0.05, 0.42] })]) : []),
    ...(o.lens ? xf(box(0.08, 0.025, 0.025, o.rim ?? DARK), { t: [0, 0.06, 0.45] }) : []),
    ...(o.earrings === false ? [] : [-1, 1].flatMap((s) => xf(sphere(0.05, 4, 3, o.earrings ?? GOLD), { t: [s * 0.41, -0.16, 0.04] }))),
    ...(HAIR[o.hair ?? 'bob'])(o.hairColor ?? DARK),
    ...(o.hat ?? [])
  ]
  const head = [...at(face, HEAD), ...xf(cyl(0.1, 0.24, 6, SKIN), { t: [0, 1.25, 0] })]
  const left = [
    ...xf(cyl(0.1, 0.62, 6, sleeve), { r: [0, 0, 58], t: [-0.6, 0.96, 0.17] }),
    ...xf(sphere(0.1, 6, 4, SKIN), { t: HAND }),
    ...(o.prop ?? [])
  ]
  const right = wave === null
    ? [...xf(cyl(0.1, 0.62, 6, sleeve), { r: [0, 0, -14], t: [0.45, 0.86, 0.12] }), ...xf(sphere(0.1, 6, 4, SKIN), { t: [0.52, 0.52, 0.14] })]
    : about([...xf(cyl(0.1, 0.62, 6, sleeve), { t: [0, -0.31, 0] }), ...xf(sphere(0.1, 6, 4, SKIN), { t: [0, -0.66, 0] })], [0, 0, 0], [0, 0, wave])
        .map((t) => ({ v: t.v.map(([x, y, z]) => [x + 0.38, y + 1.12, z + 0.1]), c: t.c }))
  let all = [
    ...xf(frustum(0.86, 0.34, 1.45, 8, o.dress), { t: [0, 0.2, 0] }),
    ...xf(cyl(0.88, 0.1, 8, o.hem), { t: [0, -0.5, 0] }),
    ...xf(frustum(0.34, 0.3, 0.32, 8, o.top ?? o.dress), { t: [0, 1.06, 0] }),
    ...[-1, 1].flatMap((s) => xf(sphere(0.13, 6, 4, sleeve), { t: [s * 0.36, 1.12, 0.1] })),
    ...about(head, NECK, [headPitch, headYaw, headRoll]),
    ...about(left, SHOULDER_L, [0, 0, -propLift]),
    ...right,
    ...(o.body ?? [])
  ]
  all = xf(xf(all, { t: [0, -GROUND, 0] }), { s: [1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6], r: [lean, 0, 0] })
  return [...xf(all, { r: [0, yaw, 0], t: [0, GROUND + bob, 0] }), ...extras]
}

export const CAM = { size: 84, center: [-0.12, 0.98, 0], yaw: -24, pitch: 6, dist: 8.8 }

const frames = (n, fn) => Array.from({ length: n }, (_, i) => fn(i / n, i))
const spark = (x, y, z, s = 0.07) => xf(box(s, s, s, '#fff1a8'), { r: [45, 45, 0], t: [x, y, z] })

/** The same eight animations as Herman 64, the same frame counts and speeds, done her way. */
export const ANIMATIONS = [
  { id: 'idle', name: 'Respirando', when: 'em repouso, no canto', fps: 8,
    poses: frames(12, (t, i) => ({ bob: 0.03 * Math.sin(TAU * t), squash: 1 + 0.015 * Math.sin(TAU * t), headRoll: 2 * Math.sin(TAU * t), blink: i === 8 ? 0.6 : i === 9 ? 1 : 0 })) },
  { id: 'spin', name: 'Girando', when: 'carregando, lendo o workspace', fps: 10,
    poses: frames(16, (t) => ({ yaw: t * 360, bob: 0.04 * Math.abs(Math.sin(TAU * t * 2)) })) },
  { id: 'wave', name: 'Acenando', when: 'olá, a primeira vez no dia', fps: 10,
    poses: frames(10, (t) => ({ wave: 145 + 20 * Math.sin(TAU * t * 2), headRoll: -6 * Math.sin(TAU * t), mouth: 0.4, bob: 0.02 * Math.sin(TAU * t * 2) })) },
  { id: 'think', name: 'Pensando', when: 'esperando a resposta da AI', fps: 10,
    poses: frames(16, (t) => ({
      headPitch: -12, headRoll: -8 + 4 * Math.sin(TAU * t), headYaw: 10 * Math.sin(TAU * t), wave: 158,
      extras: [...xf(sphere(0.1, 6, 4, GOLD), { t: [0.55 * Math.cos(TAU * t), 2.55 + 0.05 * Math.sin(TAU * t * 2), 0.55 * Math.sin(TAU * t)] }),
        ...xf(sphere(0.06, 5, 3, GOLD), { t: [0.55 * Math.cos(TAU * t + 2.1), 2.55, 0.55 * Math.sin(TAU * t + 2.1)] })]
    })) },
  { id: 'talk', name: 'Falando', when: 'respondendo no balão', fps: 8,
    poses: [0, 1, 0.5, 1, 0, 0.7, 1, 0.3].map((m, i) => ({ mouth: m, bob: 0.02 * Math.sin((TAU * i) / 8), headRoll: 4 * Math.sin((TAU * i) / 8), wave: i % 4 < 2 ? 40 : 55 })) },
  { id: 'sleep', name: 'Dormindo', when: 'AI desligada, ou tarde da noite', fps: 4,
    poses: frames(12, (t) => ({ headPitch: 18 + 3 * Math.sin(TAU * t), headRoll: 14, squash: 0.97 + 0.012 * Math.sin(TAU * t), blink: 1, bob: -0.02 })) },
  { id: 'enter', name: 'Aparecendo', when: 'quando você chama (Ctrl+J)', fps: 12,
    poses: [
      ...[-2.8, -2.2, -1.5, -0.8, -0.2, 0, 0.22, 0.28, 0.16, 0, -0.03, 0].map((bob, i) => ({ bob, yaw: i < 6 ? (6 - i) * 30 : 0, squash: [1, 1.08, 1.1, 1.08, 1, 0.84, 1.08, 1.06, 1.02, 0.96, 0.99, 1][i] })),
      ...Array.from({ length: 14 }, (_, i) => ({ blink: i === 6 ? 1 : 0, wave: i >= 2 && i <= 9 ? 150 + 18 * Math.sin(i * 1.6) : null }))
    ] },
  { id: 'cheer', name: 'Comemorando', when: 'proposta aplicada', fps: 10,
    poses: frames(12, (t, i) => {
      const hop = t < 0.5 ? Math.sin(Math.PI * t * 2) : 0
      const sparkles = i >= 3 && i <= 9 ? [[-1.3, 2.3, 0.2], [0.9, 2.5, 0.3], [-1.5, 1.8, 0.1], [1.1, 1.9, 0]].map(([x, y, z], k) => spark(x + Math.sin(i + k) * 0.08, y + (i - 3) * 0.03, z, 0.06 + ((i + k) % 3) * 0.02)).flat() : []
      return { bob: hop * 0.38, squash: i === 6 ? 0.88 : i === 7 ? 1.05 : 1 + hop * 0.04, propLift: hop * 55 + (i >= 6 && i <= 9 ? 20 : 0), wave: 150 + 20 * hop, mouth: 0.8, headPitch: -8 * hop, extras: sparkles }
    }) }
]
