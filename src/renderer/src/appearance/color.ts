/** Pure colour parsing and formatting used by the appearance editor. */

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0–1 */
  a: number
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

function channel(part: string): number | null {
  const percent = part.endsWith('%')
  const n = Number(percent ? part.slice(0, -1) : part)
  if (!Number.isFinite(n) || part === '') return null
  return Math.round(clamp(percent ? (n / 100) * 255 : n, 0, 255))
}

function alpha(part: string | undefined): number | null {
  if (part === undefined) return 1
  const percent = part.endsWith('%')
  const n = Number(percent ? part.slice(0, -1) : part)
  if (!Number.isFinite(n) || part === '') return null
  return clamp(percent ? n / 100 : n, 0, 1)
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const part = (t: number): number => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [part(hue + 1 / 3), part(hue), part(hue - 1 / 3)].map((v) => Math.round(v * 255)) as [number, number, number]
}

/** Parses hex (3/4/6/8 digits), rgb()/rgba(), hsl()/hsla() and `transparent`. Returns null for anything else. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase()
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  const hex = /^#([0-9a-f]{3,8})$/.exec(text)
  if (hex) {
    let digits = hex[1]
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join('')
    if (digits.length !== 6 && digits.length !== 8) return null
    const n = (i: number): number => parseInt(digits.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 }
  }

  const fn = /^(rgba?|hsla?)\(\s*([^()]*?)\s*\)$/.exec(text)
  if (!fn) return null
  const parts = fn[2].split(/\s*[,/]\s*|\s+/).filter((part) => part !== '')
  if (parts.length !== 3 && parts.length !== 4) return null
  const a = alpha(parts[3])
  if (a === null) return null

  if (fn[1].startsWith('rgb')) {
    const r = channel(parts[0])
    const g = channel(parts[1])
    const b = channel(parts[2])
    if (r === null || g === null || b === null) return null
    return { r, g, b, a }
  }

  const h = Number(parts[0].replace(/deg$/, ''))
  if (!parts[1].endsWith('%') || !parts[2].endsWith('%')) return null
  const s = Number(parts[1].slice(0, -1))
  const l = Number(parts[2].slice(0, -1))
  if (![h, s, l].every(Number.isFinite)) return null
  const [r, g, b] = hslToRgb(h, clamp(s, 0, 100) / 100, clamp(l, 0, 100) / 100)
  return { r, g, b, a }
}

const hex2 = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')

/** `#rrggbb`, ignoring alpha (what `<input type="color">` understands). */
export function toHex(color: Rgba): string {
  return `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`
}

/** Opaque colours become `#rrggbb`; translucent ones `rgba(r, g, b, a)` with two decimals of alpha. */
export function formatColor(color: Rgba): string {
  const a = Math.round(clamp(color.a, 0, 1) * 100) / 100
  if (a >= 1) return toHex(color)
  const c = (n: number): number => clamp(Math.round(n), 0, 255)
  return `rgba(${c(color.r)}, ${c(color.g)}, ${c(color.b)}, ${a})`
}
