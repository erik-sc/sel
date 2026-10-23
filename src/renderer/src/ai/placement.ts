// Where the conversation balloon goes in the page area: beside the persona, in the corner it is
// docked in (or above it when the area is too narrow), and out of the way of the page's caret —
// to the other edge of the area when the caret is under it, faint when it is under both. Pure;
// unit tested. All boxes are in the area's own coordinates (0,0 at its top-left).
import type { HermanCorner } from '@shared/herman'
import { near, type Box } from '@/herman/mood'

/** The dock's own distances from the area's edges (herman.css). */
export const EDGE = { side: 22, bottom: 18, top: 14 } as const
/** Between the persona's button and the balloon. */
export const GAP = 10
/** The persona's button: the figure and its padding. */
export const FIGURE_PAD = 10
export const WIDTH = { min: 300, max: 420, sheet: 760 } as const
export const MAX_HEIGHT = 560
/** How close the caret may come (as the dock). */
export const CARET_MARGIN = 28

export interface PlacementInput {
  area: { width: number; height: number }
  corner: HermanCorner
  /** The persona's figure height in px; null without it. */
  figure: number | null
  /** The larger sheet for long conversations. */
  expanded: boolean
  /** The balloon's height as drawn (0 before it is). */
  height: number
  caret: Box | null
}

export interface Placement {
  /** Distances from the area's edges: one of left/right, one of top/bottom. */
  style: { left?: number; right?: number; top?: number; bottom?: number; width: number; maxHeight: number; height?: number }
  /** The vertical edge it keeps; the other one when the caret pushed it there. */
  edge: 'top' | 'bottom'
  /** Beside the figure, with the tail toward it; `above`: on top of it; `none`: no figure. */
  attach: 'beside' | 'above' | 'none'
  flipped: boolean
  /** The caret is under it wherever it goes: it fades, as the persona does. */
  aside: boolean
}

export function placeBalloon(input: PlacementInput): Placement {
  const { area, corner, figure, expanded } = input
  const [vertical, horizontal] = corner.split('-') as ['top' | 'bottom', 'left' | 'right']
  const figureBox = figure === null ? 0 : figure + FIGURE_PAD
  let side: number = EDGE.side
  let lift = 0
  let attach: Placement['attach'] = 'none'
  let width: number
  if (figure === null) {
    width = Math.min(expanded ? WIDTH.sheet : WIDTH.max, area.width - EDGE.side * 2)
  } else {
    const besideWidth = Math.min(expanded ? WIDTH.sheet : WIDTH.max, area.width - EDGE.side - figureBox - GAP - 16)
    if (besideWidth >= WIDTH.min) {
      side = EDGE.side + figureBox + GAP
      width = besideWidth
      attach = 'beside'
    } else {
      // Too narrow to stand beside him: the balloon sits on top of him.
      lift = figureBox + GAP
      width = Math.min(expanded ? WIDTH.sheet : WIDTH.max, area.width - 32)
      attach = 'above'
    }
  }
  width = Math.max(Math.min(WIDTH.min, area.width - 16), Math.round(width))

  const edgeOf = (edge: 'top' | 'bottom', lifted: boolean): number => (edge === 'top' ? EDGE.top : EDGE.bottom) + (lifted ? lift : 0)
  const roomOf = (edge: 'top' | 'bottom', lifted: boolean): number =>
    Math.max(160, area.height - edgeOf(edge, lifted) - (edge === 'top' ? EDGE.bottom : EDGE.top))
  const heightOf = (edge: 'top' | 'bottom', lifted: boolean): number =>
    expanded ? roomOf(edge, lifted) : Math.min(MAX_HEIGHT, roomOf(edge, lifted))

  // The box it would take at an edge, to test against the caret.
  const left = horizontal === 'right' ? area.width - side - width : side
  const boxAt = (edge: 'top' | 'bottom', lifted: boolean): Box => {
    const height = expanded ? heightOf(edge, lifted) : Math.min(input.height || heightOf(edge, lifted), heightOf(edge, lifted))
    const top = edge === 'top' ? edgeOf(edge, lifted) : area.height - edgeOf(edge, lifted) - height
    return { left, right: left + width, top, bottom: top + height }
  }

  let edge = vertical
  let flipped = false
  let aside = false
  if (input.caret && near(boxAt(vertical, true), input.caret, CARET_MARGIN)) {
    const other = vertical === 'top' ? 'bottom' : 'top'
    // On the other edge the figure is not in the way: no lift there.
    if (!near(boxAt(other, false), input.caret, CARET_MARGIN)) {
      edge = other
      flipped = true
    } else aside = true
  }
  const lifted = !flipped
  const style: Placement['style'] = {
    width,
    maxHeight: heightOf(edge, lifted),
    ...(expanded ? { height: heightOf(edge, lifted) } : {}),
    ...(horizontal === 'right' ? { right: side } : { left: side }),
    ...(edge === 'top' ? { top: edgeOf(edge, lifted) } : { bottom: edgeOf(edge, lifted) })
  }
  return { style, edge, attach: flipped ? 'none' : attach, flipped, aside }
}
