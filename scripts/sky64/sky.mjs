// The Sky's corner of the Herman 64 renderer (../herman64/ps1.mjs): the same look (flat-shaded triangles,
// vertices on whole pixels, a z-buffer, three tones per material from the design system's inks, the 4×4 Bayer
// dither only at the seams), opened up for what the sky needs:
//   - frames of any size (the hill is 240×136), drawn in several passes on one z-buffer, each with its own light;
//   - a near plane, emissive triangles (stars and lines glow in one ink, unshaded) and per-material ink overrides
//     (the moon's dark side is grey, never brown; in an eclipse it turns copper);
//   - a few 2D pixel tools for the flat parts (single-pixel stars, 1 px lines);
//   - transparent backgrounds, so the app draws its own paper or charcoal behind every sprite.
import { png, sphere, xf as xfBase } from '../herman64/ps1.mjs'
import { PALETTE } from '../herman64/palette.mjs'

export const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
export const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)] / 16

/** ps1.mjs's xf, keeping each triangle's own flags (emissive and so on). */
export const xf = (mesh, o) => xfBase(mesh, o).map((t, i) => ({ ...mesh[i], ...t }))

// ---- themes: the app's tokens (src/renderer/src/styles/tokens.css) ----
export const LIGHT = {
  id: 'light', ground: '#f0ede6', dot: '#ddd8cc', ink: '#24221d', ink2: '#615d54', faint: '#b0aba0',
  accent: '#3b4f7d', accent2: '#93acce', moon: '#d1b660', moonSide: '#b0aba0', copper: '#9b4f14', copper2: '#d39a5e',
  grass: '#9bbb8a', rock: '#b0aba0'
}
export const DARK = {
  id: 'dark', ground: '#171614', dot: '#2b2927', ink: '#e8e3d9', ink2: '#a8a297', faint: '#63605a',
  accent: '#a3b1d9', accent2: '#3b4f7d', moon: '#d1b660', moonSide: '#63605a', copper: '#9b4f14', copper2: '#d39a5e',
  grass: '#456a38', rock: '#63605a'
}
export const THEMES = [LIGHT, DARK]
const paletteFor = (th) => [...new Set([...PALETTE, ...Object.values(th).filter((v) => typeof v === 'string' && v[0] === '#')])]

// ---- extra meshes ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a, k = 1) => { const m = Math.hypot(...a) || 1; return a.map((v) => (v / m) * k) }
/** A square beam from a to b, `th` thick: constellation lines, meteor trails. */
export function beam(a, b, th, color, e = false) {
  const c = hex(color), d = norm(sub(b, a))
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const u = norm(cross(d, up), th / 2), w = norm(cross(d, u), th / 2)
  const ring = (p) => [add(add(p, u), w), add(sub(p, u), w), sub(sub(p, u), w), add(sub(p, w), u)]
  const A = ring(a), B = ring(b), out = []
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; out.push({ v: [A[i], A[j], B[j]], c, e }, { v: [A[i], B[j], B[i]], c, e }) }
  return out
}
/** An octahedron (a star). */
export const octa = (r, color, e = false) => sphere(r, 4, 2, color).map((t) => ({ ...t, e }))
export const glow = (mesh) => mesh.map((t) => ({ ...t, e: true }))
/** Ink overrides: the moon drawn grey on its dark side, or copper in an eclipse. */
export const moonInks = (th) => ({ [hex(th.moon).join(',')]: [hex(th.moonSide), hex(th.moon), hex(th.moon)] })

// ---- a frame ----
export class Cv {
  constructor(W, H, th) {
    this.W = W; this.H = H; this.th = th
    this.color = new Uint8ClampedArray(W * H * 4)
    this.depth = new Float32Array(W * H).fill(-Infinity)
    this.PAL = paletteFor(th).map(hex)
    this.ramps = new Map()
  }
  near(c) { let best = this.PAL[0], bd = Infinity; for (const p of this.PAL) { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = p } } return best }
  ramp(c) {
    const key = c.join(',')
    if (!this.ramps.has(key)) this.ramps.set(key, [this.near(c.map((q) => q * 0.55)), this.near(c), this.near(c.map((q) => Math.min(255, q * 1.18 + 12)))])
    return this.ramps.get(key)
  }
  set(x, y, rgb) {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return
    const i = (y * this.W + x) * 4
    this.color[i] = rgb[0]; this.color[i + 1] = rgb[1]; this.color[i + 2] = rgb[2]; this.color[i + 3] = 255
  }
  px(x, y, h) { this.set(x, y, hex(h)) }
  get(x, y) { const i = (y * this.W + x) * 4; return [...this.color.subarray(i, i + 4)] }
  fill(h) { const c = hex(h); for (let i = 0; i < this.W * this.H; i++) { this.color.set(c, i * 4); this.color[i * 4 + 3] = 255 } return this }
  /** The app's 12 px dot grid: one pixel every 6 here, since everything is shown at 2×. */
  dots(h, step = 6, off = 2) { for (let y = off; y < this.H; y += step) for (let x = off; x < this.W; x += step) this.px(x, y, h); return this }

  /** Camera like ps1.mjs (yaw, then pitch, looking down −z from `dist`); `scale` = pixels per unit of fov. */
  project(p, { yaw = 0, pitch = 0, dist = 8, fov = 2, center = [0, 0, 0], scale, ox, oy, roll = 0 } = {}) {
    scale = scale ?? this.H / 2; ox = ox ?? this.W / 2; oy = oy ?? this.H / 2
    const ry = (yaw * Math.PI) / 180, rp = (pitch * Math.PI) / 180, rr = (roll * Math.PI) / 180
    let [x, y, z] = [p[0] - center[0], p[1] - center[1], p[2] - center[2]]
    ;[x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)]
    ;[y, z] = [y * Math.cos(rp) - z * Math.sin(rp), y * Math.sin(rp) + z * Math.cos(rp)]
    ;[x, y] = [x * Math.cos(rr) - y * Math.sin(rr), x * Math.sin(rr) + y * Math.cos(rr)]
    const k = (fov / (dist - z)) * scale
    return [Math.round(ox + x * k), Math.round(oy - y * k), z]
  }
  /** Draws a mesh, sharing the z-buffer with earlier passes. `light` is in camera space, as in ps1.mjs. */
  draw(mesh, cam = {}) {
    const { dist = 8, light = [-0.5, 0.75, 0.55], ambient = 0.38, inks = null, levels = [0.62, 0.98] } = cam
    const W = this.W, H = this.H
    const L = norm(light)
    for (const tr of mesh) {
      const P = tr.v.map((p) => this.project(p, cam))
      if (P.some((p) => p[2] > dist - 0.15)) continue // near plane
      // the face normal, in camera space, turned toward the eye
      const a = this.cam3(tr.v[0], cam), b = this.cam3(tr.v[1], cam), d = this.cam3(tr.v[2], cam)
      let n = norm(cross(sub(b, a), sub(d, a)))
      const toCam = [-a[0], -a[1], dist - a[2]]
      if (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2] < 0) n = n.map((q) => -q)
      const shade = Math.min(1.12, ambient + (1 - ambient) * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]))
      const x0 = Math.max(0, Math.min(...P.map((p) => p[0]))), x1 = Math.min(W - 1, Math.max(...P.map((p) => p[0])))
      const y0 = Math.max(0, Math.min(...P.map((p) => p[1]))), y1 = Math.min(H - 1, Math.max(...P.map((p) => p[1])))
      const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1])
      const c = typeof tr.c === 'string' ? hex(tr.c) : tr.c
      const flat = tr.e ? this.near(c) : null
      if (area === 0) {
        // a beam seen edge-on: keep it visible as single pixels
        if (tr.e) for (const p of P) if (p[0] >= 0 && p[1] >= 0 && p[0] < W && p[1] < H) { const i = p[1] * W + p[0]; if (p[2] > this.depth[i]) { this.depth[i] = p[2]; this.set(p[0], p[1], flat) } }
        continue
      }
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5
          const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area
          const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area
          const w2 = 1 - w0 - w1
          if (w0 < 0 || w1 < 0 || w2 < 0) continue
          const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2]
          const i = y * W + x
          if (z <= this.depth[i]) continue
          this.depth[i] = z
          let col = flat
          if (!col) {
            const ramp = (inks && inks[c.join(',')]) || this.ramp(c)
            const level = shade + (bayer(x, y) - 0.5) * 0.12
            col = level < levels[0] ? ramp[0] : level < levels[1] ? ramp[1] : ramp[2]
          }
          this.set(x, y, col)
        }
    }
    return this
  }
  /** A point in camera space (before projection). */
  cam3(p, { yaw = 0, pitch = 0, center = [0, 0, 0], roll = 0 } = {}) {
    const ry = (yaw * Math.PI) / 180, rp = (pitch * Math.PI) / 180, rr = (roll * Math.PI) / 180
    let [x, y, z] = [p[0] - center[0], p[1] - center[1], p[2] - center[2]]
    ;[x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)]
    ;[y, z] = [y * Math.cos(rp) - z * Math.sin(rp), y * Math.sin(rp) + z * Math.cos(rp)]
    ;[x, y] = [x * Math.cos(rr) - y * Math.sin(rr), x * Math.sin(rr) + y * Math.cos(rr)]
    return [x, y, z]
  }
}

/** Frames side by side in one PNG Buffer (a strip for CSS steps()). */
export function strip(frames) {
  const { W, H } = frames[0], n = frames.length
  const out = new Uint8ClampedArray(W * n * H * 4)
  frames.forEach((f, k) => { for (let y = 0; y < H; y++) out.set(f.color.subarray(y * W * 4, (y + 1) * W * 4), (y * W * n + k * W) * 4) })
  return Buffer.from(png(W * n, H, out).split(',')[1], 'base64')
}
export const still = (cv) => Buffer.from(png(cv.W, cv.H, cv.color).split(',')[1], 'base64')

/** A seeded random in [0, 1) (FNV-1a + mulberry32); only for decoration, never for anything the data decides. */
export function rng(seed) {
  let h = 2166136261
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  let a = h >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
