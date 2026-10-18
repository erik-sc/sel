import { describe, expect, it } from 'vitest'
import { BASELINE, EDGE, GAP, placeWidget, type Box } from './corner'

const W = 1000
const H = 700
const widget = { width: 120, height: 28 }

/** Herman at rest in the lower right (herman.css: right 22px, bottom 18px), `width` wide with his bubble. */
function herman(width = 60, height = 60): Box {
  return { left: W - 22 - width, right: W - 22, top: H - 18 - height, bottom: H - 18 }
}

describe('the place of the pomodoro widget', () => {
  it('takes the corner when Herman is elsewhere or off', () => {
    expect(placeWidget({ width: W, height: H, widget, herman: null, obstacles: [] })).toEqual({ right: EDGE.right, bottom: EDGE.bottom })
  })

  it('sits to Herman’s left, on his base line', () => {
    const dock = herman()
    expect(placeWidget({ width: W, height: H, widget, herman: dock, obstacles: [] })).toEqual({ right: 22 + 60 + GAP, bottom: 18 + BASELINE })
  })

  it('moves further left when his bubble widens his corner, so as never to cover it', () => {
    const dock = herman(380, 110)
    const place = placeWidget({ width: W, height: H, widget, herman: dock, obstacles: [] })
    expect(place).toEqual({ right: 22 + 380 + GAP, bottom: 18 + BASELINE })
    expect(W - place.right).toBeLessThanOrEqual(dock.left)
  })

  it('goes above him when the content is too narrow for both side by side', () => {
    const narrow = 300
    const dock: Box = { left: narrow - 22 - 200, right: narrow - 22, top: H - 18 - 90, bottom: H - 18 }
    expect(placeWidget({ width: narrow, height: H, widget, herman: dock, obstacles: [] })).toEqual({ right: EDGE.right, bottom: 18 + 90 + GAP })
  })

  it('rises above a toast it would cover, and above the next one that is then in the way', () => {
    const toast: Box = { left: W - 300, right: W - 4, top: H - 60, bottom: H - 4 }
    const second: Box = { left: W - 300, right: W - 4, top: H - 110, bottom: H - 68 }
    expect(placeWidget({ width: W, height: H, widget, herman: null, obstacles: [toast] })).toEqual({ right: EDGE.right, bottom: 60 + GAP })
    expect(placeWidget({ width: W, height: H, widget, herman: null, obstacles: [toast, second] })).toEqual({ right: EDGE.right, bottom: 110 + GAP })
  })

  it('leaves alone what it does not cover', () => {
    const away: Box = { left: 10, right: 200, top: H - 60, bottom: H - 10 }
    expect(placeWidget({ width: W, height: H, widget, herman: herman(), obstacles: [away] })).toEqual({ right: 22 + 60 + GAP, bottom: 18 + BASELINE })
  })
})
