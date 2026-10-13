/**
 * Page and database icons: small abstract shapes, each drawn from a seed.
 *
 * An icon is stored as `shape:<seed>`. The same seed always draws the same shape, so nothing
 * but the seed is kept. Icons saved before shapes existed are emoji: such a value is used as
 * its own seed, which gives every old icon a shape of its own without rewriting anything.
 * Pure: no DOM, so it runs in node tests.
 */

export const SHAPE_PREFIX = 'shape:'
const SEED_LENGTH = 8
/** The drawing is laid out on a square of this side. */
export const SHAPE_BOX = 24

/** The named colours (`--c-<name>`) a shape may wear. */
const HUES = ['blue', 'orange', 'pink', 'yellow', 'brown', 'purple', 'green', 'red'] as const

export interface ShapeLayer {
  d: string
  /** Name of a `--c-<name>` token. */
  colour: string
  opacity: number
  /** Degrees around the centre of the box. */
  rotate: number
  evenOdd?: boolean
}

export interface Shape {
  layers: ShapeLayer[]
}

/** A new icon value with a random seed. */
export function newShapeIcon(random: () => number = Math.random): string {
  let seed = ''
  while (seed.length < SEED_LENGTH) seed += Math.floor(random() * 36).toString(36)
  return SHAPE_PREFIX + seed
}

/** The seed an icon value draws from. */
export function shapeSeed(icon: string): string {
  return icon.startsWith(SHAPE_PREFIX) ? icon.slice(SHAPE_PREFIX.length) : icon
}

// ---- seeded numbers ----

function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: small, fast, and even enough for drawing. */
function generator(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- primitives, each around (cx, cy) with a reach of r ----

const n = (value: number): string => String(Math.round(value * 100) / 100)

function disc(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(r * 2)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-r * 2)} 0Z`
}

function ring(cx: number, cy: number, r: number): string {
  return disc(cx, cy, r) + disc(cx, cy, r * 0.55)
}

function square(cx: number, cy: number, r: number): string {
  const s = r * 0.86
  const c = s * 0.28
  const x = cx - s
  const y = cy - s
  const side = s * 2 - c * 2
  return (
    `M${n(x + c)} ${n(y)}h${n(side)}q${n(c)} 0 ${n(c)} ${n(c)}v${n(side)}q0 ${n(c)} ${n(-c)} ${n(c)}` +
    `h${n(-side)}q${n(-c)} 0 ${n(-c)} ${n(-c)}v${n(-side)}q0 ${n(-c)} ${n(c)} ${n(-c)}Z`
  )
}

function triangle(cx: number, cy: number, r: number): string {
  return `M${n(cx)} ${n(cy - r)}L${n(cx + r * 0.92)} ${n(cy + r * 0.72)}L${n(cx - r * 0.92)} ${n(cy + r * 0.72)}Z`
}

function half(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy + r * 0.45)}a${n(r)} ${n(r)} 0 0 1 ${n(r * 2)} 0Z`
}

function quarter(cx: number, cy: number, r: number): string {
  const side = r * 1.7
  const x = cx - side / 2
  const y = cy - side / 2
  return `M${n(x)} ${n(y)}h${n(side)}a${n(side)} ${n(side)} 0 0 1 ${n(-side)} ${n(side)}Z`
}

function leaf(cx: number, cy: number, r: number): string {
  const a = r * 0.9
  return `M${n(cx - a)} ${n(cy + a)}Q${n(cx - a)} ${n(cy - a)} ${n(cx + a)} ${n(cy - a)}Q${n(cx + a)} ${n(cy + a)} ${n(cx - a)} ${n(cy + a)}Z`
}

function arch(cx: number, cy: number, r: number): string {
  const inner = r * 0.5
  return (
    `M${n(cx - r)} ${n(cy + r * 0.5)}a${n(r)} ${n(r)} 0 0 1 ${n(r * 2)} 0h${n(-(r - inner))}` +
    `a${n(inner)} ${n(inner)} 0 0 0 ${n(-inner * 2)} 0Z`
  )
}

function bars(cx: number, cy: number, r: number): string {
  const h = r * 0.42
  const bar = (y: number, w: number): string =>
    `M${n(cx - w + h / 2)} ${n(y)}h${n(w * 2 - h)}a${n(h / 2)} ${n(h / 2)} 0 0 1 0 ${n(h)}h${n(-(w * 2 - h))}a${n(h / 2)} ${n(h / 2)} 0 0 1 0 ${n(-h)}Z`
  return bar(cy - r * 0.8, r) + bar(cy - h / 2, r * 0.68) + bar(cy + r * 0.8 - h, r * 0.86)
}

/** A closed curve through points at uneven distances from the centre. */
function blob(cx: number, cy: number, r: number, random: () => number): string {
  const count = 5 + Math.floor(random() * 3)
  const points: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    const reach = r * (0.68 + random() * 0.4)
    points.push([cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach])
  }
  const at = (i: number): [number, number] => points[(i + count) % count]
  let d = `M${n(points[0][0])} ${n(points[0][1])}`
  // Catmull-Rom through the points, written as cubic Béziers.
  for (let i = 0; i < count; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    d +=
      `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`
  }
  return d + 'Z'
}

type Primitive = (cx: number, cy: number, r: number, random: () => number) => string
const PRIMITIVES: Primitive[] = [disc, ring, square, triangle, half, quarter, leaf, arch, bars, blob]
const EVEN_ODD = new Set<Primitive>([ring])

// ---- composition ----

function draw(seed: string): Shape {
  const random = generator(hash(seed))
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]
  const centre = SHAPE_BOX / 2
  const layer = (primitive: Primitive, cx: number, cy: number, r: number, colour: string, opacity: number): ShapeLayer => {
    const made: ShapeLayer = { d: primitive(cx, cy, r, random), colour, opacity, rotate: Math.floor(random() * 8) * 45 }
    if (EVEN_ODD.has(primitive)) made.evenOdd = true
    return made
  }

  const first = Math.floor(random() * HUES.length)
  // A neighbour two to four steps round the list: never the same hue, never a clash by accident of order.
  const second = (first + 2 + Math.floor(random() * 3)) % HUES.length
  const base = pick(PRIMITIVES)
  const layers = [layer(base, centre, centre, 8.2 + random() * 1.6, HUES[first], 0.82)]

  let over = pick(PRIMITIVES)
  while (over === base || over === bars) over = pick(PRIMITIVES)
  const offset = (): number => (random() - 0.5) * 8
  layers.push(layer(over, centre + offset(), centre + offset(), 3.6 + random() * 2.2, HUES[second], 0.9))

  if (random() < 0.4) layers.push(layer(disc, centre + offset() * 1.6, centre + offset() * 1.6, 1.4 + random() * 0.8, HUES[first], 1))
  return { layers }
}

const CACHE_LIMIT = 2000
const cache = new Map<string, Shape>()

/** The shape an icon value stands for. */
export function shapeOf(icon: string): Shape {
  const seed = shapeSeed(icon)
  let shape = cache.get(seed)
  if (!shape) {
    if (cache.size >= CACHE_LIMIT) cache.clear()
    shape = draw(seed)
    cache.set(seed, shape)
  }
  return shape
}
