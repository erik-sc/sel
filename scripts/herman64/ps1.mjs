// A tiny software renderer with the PlayStation 1 look: low-poly meshes, flat shading, vertices
// snapped to whole pixels, a z-buffer, 4×4 ordered dithering down to 15-bit colour, a small
// frame shown scaled up. Output: a PNG (RGBA, transparent background) as a data: URI.
import { deflateSync } from 'node:zlib'

const rad = (d) => (d * Math.PI) / 180
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

// ---- meshes: arrays of { v: [[x,y,z]×3], c: [r,g,b] } ----
const tri = (a, b, c, col) => ({ v: [a, b, c], c: col })
const quad = (a, b, c, d, col) => [tri(a, b, c, col), tri(a, c, d, col)]

export function box(w, h, d, color) {
  const c = hex(color), x = w / 2, y = h / 2, z = d / 2
  const p = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]
  return [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]].flatMap(([a, b, e, f]) => quad(p[a], p[b], p[e], p[f], c))
}
/** A frustum along y: r1 at the bottom, r2 at the top (0 = a cone). */
export function frustum(r1, r2, h, seg, color, caps = true) {
  const c = hex(color), out = []
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2
    const b0 = [Math.cos(a0) * r1, -h / 2, Math.sin(a0) * r1], b1 = [Math.cos(a1) * r1, -h / 2, Math.sin(a1) * r1]
    const t0 = [Math.cos(a0) * r2, h / 2, Math.sin(a0) * r2], t1 = [Math.cos(a1) * r2, h / 2, Math.sin(a1) * r2]
    out.push(...quad(b0, b1, t1, t0, c))
    if (caps) {
      out.push(tri([0, -h / 2, 0], b1, b0, c))
      if (r2 > 0) out.push(tri([0, h / 2, 0], t0, t1, c))
    }
  }
  return out
}
export const cyl = (r, h, seg, color) => frustum(r, r, h, seg, color)
export function sphere(r, seg, rings, color, wobble = 0, seed = 1) {
  const c = hex(color), out = [], grid = []
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let j = 0; j <= rings; j++) {
    const row = [], phi = (j / rings) * Math.PI
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2
      const k = j === 0 || j === rings ? 1 : 1 + rnd() * wobble
      row.push([Math.sin(phi) * Math.cos(th) * r * k, Math.cos(phi) * r * k, Math.sin(phi) * Math.sin(th) * r * k])
    }
    grid.push(row)
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = grid[j][i], b = grid[j][(i + 1) % seg], d = grid[j + 1][i], e = grid[j + 1][(i + 1) % seg]
      if (j > 0) out.push(tri(a, b, e, c))
      if (j < rings - 1) out.push(tri(a, e, d, c))
    }
  return out
}
/** A ring lying in the xy plane, facing +z. */
export function torus(R, r, seg, side, color) {
  const c = hex(color), out = []
  const at = (i, j) => {
    const u = (i / seg) * Math.PI * 2, v = (j / side) * Math.PI * 2
    return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < side; j++) out.push(...quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), c))
  return out
}
/** Scale, then rotate (x, y, z in degrees), then move. */
export function xf(mesh, { s = [1, 1, 1], r = [0, 0, 0], t = [0, 0, 0] } = {}) {
  const S = typeof s === 'number' ? [s, s, s] : s
  const [cx, sx] = [Math.cos(rad(r[0])), Math.sin(rad(r[0]))]
  const [cy, sy] = [Math.cos(rad(r[1])), Math.sin(rad(r[1]))]
  const [cz, sz] = [Math.cos(rad(r[2])), Math.sin(rad(r[2]))]
  const f = ([x, y, z]) => {
    x *= S[0]; y *= S[1]; z *= S[2]
    ;[y, z] = [y * cx - z * sx, y * sx + z * cx]
    ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]
    ;[x, y] = [x * cz - y * sz, x * sz + y * cz]
    return [x + t[0], y + t[1], z + t[2]]
  }
  return mesh.map((tr) => ({ v: tr.v.map(f), c: tr.c }))
}

// ---- render ----
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
export function render(mesh, { size = 84, yaw = -28, pitch = 8, dist = 7, fov = 4.6, center = [0, 0.9, 0], light = [-0.5, 0.75, 0.55], ambient = 0.38, outline = '#16151a', raw = false } = {}) {
  const W = size, H = size
  const color = new Uint8ClampedArray(W * H * 4)
  const depth = new Float32Array(W * H).fill(-Infinity)
  const L = (() => { const m = Math.hypot(...light); return light.map((v) => v / m) })()
  const view = xf(xf(mesh, { t: center.map((v) => -v) }), { r: [0, yaw, 0] })
  const cam = xf(view, { r: [pitch, 0, 0] })
  const project = ([x, y, z]) => {
    const k = (fov / (dist - z)) * (W / 2)
    // PS1: no sub-pixel precision, vertices land on whole pixels
    return [Math.round(W / 2 + x * k), Math.round(H / 2 - y * k), z]
  }
  for (const { v, c } of cam) {
    const [a, b, d] = v
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const m = Math.hypot(...n) || 1
    n = n.map((q) => q / m)
    const toCam = [-a[0], -a[1], dist - a[2]]
    if (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2] < 0) n = n.map((q) => -q)
    const shade = Math.min(1.12, ambient + (1 - ambient) * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]))
    const col = c.map((q) => q * shade)
    const P = v.map(project)
    const [x0, x1] = [Math.max(0, Math.min(...P.map((p) => p[0]))), Math.min(W - 1, Math.max(...P.map((p) => p[0])))]
    const [y0, y1] = [Math.max(0, Math.min(...P.map((p) => p[1]))), Math.min(H - 1, Math.max(...P.map((p) => p[1])))]
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1])
    if (area === 0) continue
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5
        const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area
        const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2]
        const i = y * W + x
        if (z <= depth[i]) continue
        depth[i] = z
        const t = BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5
        // 15-bit colour (5 bits a channel) with the ordered dither
        for (let k = 0; k < 3; k++) color[i * 4 + k] = Math.max(0, Math.min(31, Math.round(col[k] / 8.226 + t))) * 8.226
        color[i * 4 + 3] = 255
      }
  }
  // a one-pixel dark outline around the silhouette, the way sprites were often cut
  const ol = hex(outline)
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && color[(y * W + x) * 4 + 3] === 255
  const edge = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!solid(x, y) && (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))) edge.push(y * W + x)
  for (const i of edge) { color[i * 4] = ol[0]; color[i * 4 + 1] = ol[1]; color[i * 4 + 2] = ol[2]; color[i * 4 + 3] = 255 }
  return raw ? { W, H, color } : png(W, H, color)
}

// ---- PNG ----
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
export function png(W, H, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.alloc((W * 4 + 1) * H)
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1) }
  const out = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  return `data:image/png;base64,${out.toString('base64')}`
}
