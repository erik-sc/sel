export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedBounds extends Bounds {
  maximized?: boolean
}

export const DEFAULT_SIZE = { width: 1200, height: 800 }
export const MIN_SIZE = { width: 480, height: 360 }

/** Validates stored window bounds against the displays that exist right now. */
export function fitBounds(saved: unknown, workAreas: Bounds[]): Partial<SavedBounds> {
  if (!saved || typeof saved !== 'object') return {}
  const { x, y, width, height, maximized } = saved as Partial<Record<keyof SavedBounds, unknown>>
  const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  if (!isNumber(x) || !isNumber(y) || !isNumber(width) || !isNumber(height)) return {}
  // Never larger than the biggest display: a corrupt size must not produce an unusable window.
  const maxWidth = Math.max(MIN_SIZE.width, ...workAreas.map((a) => a.width))
  const maxHeight = Math.max(MIN_SIZE.height, ...workAreas.map((a) => a.height))
  const w = Math.min(maxWidth, Math.max(MIN_SIZE.width, Math.round(width)))
  const h = Math.min(maxHeight, Math.max(MIN_SIZE.height, Math.round(height)))
  // Only reuse the position if the window would still be reachable (a monitor may be gone).
  const visible = workAreas.some((a) => {
    const overlapX = Math.min(x + w, a.x + a.width) - Math.max(x, a.x)
    const overlapY = Math.min(y + h, a.y + a.height) - Math.max(y, a.y)
    return overlapX >= 120 && overlapY >= 80
  })
  const out: Partial<SavedBounds> = { width: w, height: h, maximized: maximized === true }
  if (visible) {
    out.x = Math.round(x)
    out.y = Math.round(y)
  }
  return out
}
