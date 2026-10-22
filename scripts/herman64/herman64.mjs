// Herman 64's rig: the body every skin shares, its joints, and the helpers that render it.
import { box, cyl, frustum, png, render, sphere, torus, xf } from './ps1.mjs'

export const SKIN = '#e9c7a2', BEARD = '#f1eee6', DARK = '#1e1d22', WOOD = '#8a5a32', GOLD = '#d8b44a'
export const HAND = [-0.95, 0.78, 0.18]
const GROUND = -0.56
const NECK = [0, 1.08, 0]
const SHOULDER_L = [-0.42, 1.12, 0.15]
const TAU = Math.PI * 2

/** Drops the triangles whose middle lies in front of a z plane (to open a hood or a helmet). */
export const cutFront = (mesh, z) => mesh.filter((t) => (t.v[0][2] + t.v[1][2] + t.v[2][2]) / 3 < z)
/** The classic staff, with whatever sits on top of it. */
export const staff = (top, color = WOOD) => [...xf(cyl(0.05, 2.5, 5, color), { t: [-1.0, 0.45, 0.18] }), ...top]
const about = (mesh, pivot, r) => xf(xf(mesh, { t: pivot.map((v) => -v) }), { r, t: pivot })

/**
 * Herman in a skin and a pose.
 * Skin: { robe, hem, sleeve?, beard?, lens?, rim?, hat?, body?, prop? } — hat moves with the head, prop with the left hand.
 * Pose: yaw, bob, squash, lean, headPitch/Yaw/Roll, blink 0..1, mouth 0..1, wave (right arm angle, or null), staffLift, extras.
 */
export function herman(o, p = {}) {
  const { yaw = 0, bob = 0, squash = 1, lean = 0, headPitch = 0, headYaw = 0, headRoll = 0, blink = 0, mouth = 0, wave = null, staffLift = 0, extras = [] } = p
  const lens = o.lens ?? '#2b2a30'
  const head = [
    ...xf(sphere(0.46, 8, 6, SKIN), { t: [0, 1.48, 0] }),
    ...xf(frustum(0.4, 0, 1.0, 6, o.beard ?? BEARD), { r: [180, 0, 0], t: [0, 0.85 - mouth * 0.09, 0.2 + mouth * 0.03] }),
    ...xf(box(0.42, 0.1, 0.12, o.beard ?? BEARD), { t: [0, 1.32 + mouth * 0.02, 0.42] }),
    ...xf(frustum(0.08, 0, 0.22, 5, '#d9a882'), { r: [90, 0, 0], t: [0, 1.46, 0.5] }),
    ...[-1, 1].flatMap((s) => xf(torus(0.13, 0.03, 10, 4, o.rim ?? DARK), { t: [s * 0.17, 1.55, 0.44] })),
    ...[-1, 1].flatMap((s) => xf(sphere(0.06, 5, 4, lens), { s: [1, Math.max(0.12, 1 - blink * 0.9), 1], t: [s * 0.17, 1.55, 0.4] })),
    ...(blink > 0.5 ? [-1, 1].flatMap((s) => xf(box(0.2, 0.025, 0.02, SKIN), { t: [s * 0.17, 1.55, 0.43] })) : []),
    ...xf(box(0.1, 0.03, 0.03, o.rim ?? DARK), { t: [0, 1.56, 0.45] }),
    ...(o.hat ?? [])
  ]
  const left = [...xf(cyl(0.11, 0.75, 6, o.sleeve ?? o.robe), { r: [0, 0, 62], t: [-0.62, 0.95, 0.15] }), ...xf(sphere(0.12, 6, 4, SKIN), { t: HAND }), ...(o.prop ?? [])]
  const right = wave === null ? [] : about([...xf(cyl(0.1, 0.7, 6, o.sleeve ?? o.robe), { t: [0, -0.35, 0] }), ...xf(sphere(0.12, 6, 4, SKIN), { t: [0, -0.74, 0] })], [0, 0, 0], [0, 0, wave])
    .map((t) => ({ v: t.v.map(([x, y, z]) => [x + 0.42, y + 1.12, z + 0.1]), c: t.c }))
  let all = [
    ...xf(frustum(0.95, 0.42, 1.7, 8, o.robe), { t: [0, 0.35, 0] }),
    ...xf(cyl(0.98, 0.12, 8, o.hem), { t: [0, -0.5, 0] }),
    ...about(head, NECK, [headPitch, headYaw, headRoll]),
    ...about(left, SHOULDER_L, [0, 0, -staffLift]),
    ...right,
    ...(o.body ?? [])
  ]
  all = xf(xf(all, { t: [0, -GROUND, 0] }), { s: [1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6], r: [lean, 0, 0] })
  return [...xf(all, { r: [0, yaw, 0], t: [0, GROUND + bob, 0] }), ...extras]
}

export const CAM = { size: 84, center: [-0.15, 0.95, 0], yaw: -24, pitch: 6, dist: 8.8 }

/** Frames as one horizontal strip PNG (data: URI or, with buffer: true, a Buffer). */
export function strip(o, poses, { buffer = false } = {}) {
  const shots = poses.map((p) => render(herman(o, p), { ...CAM, raw: true }))
  const { W, H } = shots[0]
  const n = shots.length
  const out = new Uint8ClampedArray(W * n * H * 4)
  shots.forEach((s, f) => { for (let y = 0; y < H; y++) out.set(s.color.subarray(y * W * 4, (y + 1) * W * 4), (y * W * n + f * W) * 4) })
  const uri = png(W * n, H, out)
  return { n, data: buffer ? Buffer.from(uri.split(',')[1], 'base64') : uri }
}
export const still = (o, p = {}, buffer = false) => {
  const uri = render(herman(o, p), CAM)
  return buffer ? Buffer.from(uri.split(',')[1], 'base64') : uri
}

const frames = (n, fn) => Array.from({ length: n }, (_, i) => fn(i / n, i))
const spark = (x, y, z, s = 0.07) => xf(box(s, s, s, '#fff1a8'), { r: [45, 45, 0], t: [x, y, z] })

/** The animations, as lists of poses, with their speed and where the app uses them. */
export const ANIMATIONS = [
  { id: 'idle', name: 'Respirando', when: 'em repouso, no canto', fps: 8,
    poses: frames(12, (t, i) => ({ bob: 0.03 * Math.sin(TAU * t), squash: 1 + 0.015 * Math.sin(TAU * t), blink: i === 9 ? 0.6 : i === 10 ? 1 : 0 })) },
  { id: 'spin', name: 'Girando', when: 'carregando, lendo o workspace', fps: 10,
    poses: frames(16, (t) => ({ yaw: t * 360, bob: 0.04 * Math.abs(Math.sin(TAU * t * 2)) })) },
  { id: 'wave', name: 'Acenando', when: 'olá, a primeira vez no dia', fps: 10,
    poses: frames(10, (t) => ({ wave: 140 + 22 * Math.sin(TAU * t * 2), headRoll: 5 * Math.sin(TAU * t), bob: 0.02 * Math.sin(TAU * t * 2) })) },
  { id: 'think', name: 'Pensando', when: 'esperando a resposta da AI', fps: 10,
    poses: frames(16, (t) => ({
      headPitch: -14, headRoll: 6 * Math.sin(TAU * t), bob: 0.015 * Math.sin(TAU * t * 2),
      extras: [...xf(sphere(0.1, 6, 4, GOLD), { t: [0.55 * Math.cos(TAU * t), 2.45 + 0.05 * Math.sin(TAU * t * 2), 0.55 * Math.sin(TAU * t)] }),
        ...xf(sphere(0.06, 5, 3, GOLD), { t: [0.55 * Math.cos(TAU * t + 2.1), 2.45, 0.55 * Math.sin(TAU * t + 2.1)] })]
    })) },
  { id: 'talk', name: 'Falando', when: 'respondendo no balão', fps: 8,
    poses: [0, 1, 0.5, 1, 0, 0.7, 1, 0.3].map((m, i) => ({ mouth: m, bob: 0.02 * Math.sin((TAU * i) / 8), headPitch: 3 * Math.sin((TAU * i) / 8) })) },
  { id: 'sleep', name: 'Dormindo', when: 'AI desligada, ou tarde da noite', fps: 4,
    poses: frames(12, (t) => ({ headPitch: 22 + 3 * Math.sin(TAU * t), squash: 0.97 + 0.012 * Math.sin(TAU * t), blink: 1, bob: -0.02 })) },
  { id: 'enter', name: 'Aparecendo', when: 'quando você chama (Ctrl+J)', fps: 12,
    poses: [
      ...[-2.8, -2.2, -1.5, -0.8, -0.2, 0, 0.22, 0.28, 0.16, 0, -0.03, 0].map((bob, i) => ({ bob, squash: [1, 1.08, 1.1, 1.08, 1, 0.84, 1.08, 1.06, 1.02, 0.96, 0.99, 1][i] })),
      ...Array.from({ length: 14 }, (_, i) => ({ blink: i === 6 ? 1 : 0 }))
    ] },
  { id: 'cheer', name: 'Comemorando', when: 'proposta aplicada', fps: 10,
    poses: frames(12, (t, i) => {
      const hop = t < 0.5 ? Math.sin(Math.PI * t * 2) : 0
      const sparkles = i >= 3 && i <= 9 ? [[-1.4, 2.2, 0.2], [-0.6, 2.4, 0.3], [-1.6, 1.7, 0.1], [-0.9, 2.6, 0]].map(([x, y, z], k) => spark(x + Math.sin(i + k) * 0.08, y + (i - 3) * 0.03, z, 0.06 + ((i + k) % 3) * 0.02)).flat() : []
      return { bob: hop * 0.38, squash: i === 6 ? 0.88 : i === 7 ? 1.05 : 1 + hop * 0.04, staffLift: hop * 55 + (i >= 6 && i <= 9 ? 20 : 0), headPitch: -8 * hop, extras: sparkles }
    }) }
]
