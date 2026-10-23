import { describe, expect, it } from 'vitest'
import { EDGE, FIGURE_PAD, GAP, MAX_HEIGHT, WIDTH, placeBalloon, type PlacementInput } from './placement'

const input = (over: Partial<PlacementInput> = {}): PlacementInput => ({
  area: { width: 1200, height: 800 },
  corner: 'bottom-right',
  figure: 84,
  expanded: false,
  height: 300,
  caret: null,
  ...over
})

describe('where the balloon goes', () => {
  it('stands beside the persona, in its corner, with the tail toward it', () => {
    const placed = placeBalloon(input())
    expect(placed).toMatchObject({ edge: 'bottom', attach: 'beside', flipped: false, aside: false })
    expect(placed.style).toMatchObject({
      right: EDGE.side + 84 + FIGURE_PAD + GAP,
      bottom: EDGE.bottom,
      width: WIDTH.max,
      maxHeight: MAX_HEIGHT
    })
    expect(placed.style.left).toBeUndefined()

    const topLeft = placeBalloon(input({ corner: 'top-left' }))
    expect(topLeft.style).toMatchObject({ left: EDGE.side + 84 + FIGURE_PAD + GAP, top: EDGE.top })
    expect(topLeft.edge).toBe('top')
  })

  it('keeps the corner alone without the persona', () => {
    const placed = placeBalloon(input({ figure: null }))
    expect(placed).toMatchObject({ attach: 'none' })
    expect(placed.style).toMatchObject({ right: EDGE.side, bottom: EDGE.bottom })
  })

  it('sits on top of the persona when the area is too narrow to stand beside it', () => {
    const placed = placeBalloon(input({ area: { width: 420, height: 700 }, figure: 168 }))
    expect(placed.attach).toBe('above')
    expect(placed.style).toMatchObject({ right: EDGE.side, bottom: EDGE.bottom + 168 + FIGURE_PAD + GAP })
    expect(placed.style.width).toBeLessThanOrEqual(420 - 16)
  })

  it('grows into a sheet as tall as the area allows', () => {
    const placed = placeBalloon(input({ expanded: true }))
    expect(placed.style.width).toBe(WIDTH.sheet)
    expect(placed.style.height).toBe(800 - EDGE.bottom - EDGE.top)
    expect(placed.style.maxHeight).toBe(placed.style.height)
  })

  it('moves to the other edge when the caret of the page is under it', () => {
    // A caret near the bottom, inside the balloon's span.
    const caret = { left: 900, right: 901, top: 700, bottom: 718 }
    const placed = placeBalloon(input({ caret }))
    expect(placed).toMatchObject({ edge: 'top', flipped: true, aside: false, attach: 'none' })
    expect(placed.style).toMatchObject({ top: EDGE.top })
    // A caret far from it changes nothing.
    expect(placeBalloon(input({ caret: { left: 100, right: 101, top: 700, bottom: 718 } })).flipped).toBe(false)
  })

  it('fades when the caret is under it at either edge', () => {
    const caret = { left: 900, right: 901, top: 400, bottom: 418 }
    const placed = placeBalloon(input({ expanded: true, caret }))
    expect(placed).toMatchObject({ aside: true, flipped: false, edge: 'bottom' })
  })
})
