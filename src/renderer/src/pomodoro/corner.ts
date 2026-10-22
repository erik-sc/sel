// Where the pomodoro widget sits in the lower right corner of the content, given what else lives
// there: Herman (herman.css, `.herman-dock.is-bottom-right`, right 22px / bottom 18px), his speech
// bubble, the toasts and the focus-mode indicators. Pure: boxes in, offsets out. Unit-tested.

/** A box in the content's own coordinates (px from its top left corner). */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface CornerInput {
  /** The content area's size. */
  width: number
  height: number
  /** The widget's own size. */
  widget: { width: number; height: number }
  /** Herman's corner, figure and bubble together, when he is in the lower right; else null. */
  herman: Box | null
  /** What the widget must not cover: the toasts, the indicators shown in focus mode. */
  obstacles: readonly Box[]
}

/** Offsets from the content's right and bottom edges, as CSS `right` / `bottom`. */
export interface CornerPlace {
  right: number
  bottom: number
}

/** Herman's own distance from the edges (herman.css), which the widget keeps when the corner is its own. */
export const EDGE = { right: 22, bottom: 18 } as const
/** His feet stand this far above the bottom of his corner (the padding of his button): the base line. */
export const BASELINE = 5
/** Between the widget and whatever it sits beside or above. */
export const GAP = 10
/** The least room left between the widget and the content's left edge. */
const MARGIN = 8

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/**
 * To Herman's left on his base line (beside his bubble when he speaks, never over it); above him
 * when the content is too narrow for both side by side; in the corner itself when he is
 * elsewhere or off. Then lifted over anything it would cover.
 */
export function placeWidget({ width, height, widget, herman, obstacles }: CornerInput): CornerPlace {
  let place: CornerPlace = { right: EDGE.right, bottom: EDGE.bottom }
  if (herman) {
    const beside = width - herman.left + GAP
    place =
      width - beside - widget.width >= MARGIN
        ? { right: beside, bottom: height - herman.bottom + BASELINE }
        : { right: EDGE.right, bottom: height - herman.top + GAP }
  }
  // Each lift can bring it up against another obstacle: look again until nothing is covered.
  for (let round = 0; round <= obstacles.length; round++) {
    const box: Box = {
      left: width - place.right - widget.width,
      right: width - place.right,
      top: height - place.bottom - widget.height,
      bottom: height - place.bottom
    }
    const hit = obstacles.find((obstacle) => overlaps(box, obstacle))
    if (!hit) break
    place = { right: place.right, bottom: height - hit.top + GAP }
  }
  return place
}
