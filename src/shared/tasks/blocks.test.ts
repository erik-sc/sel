import { describe, expect, it } from 'vitest'
import {
  blockOf,
  blockValue,
  clockOf,
  dayLoad,
  durationOf,
  fitBlock,
  freeMinutes,
  freeSpans,
  mergeSpans,
  minutesOf,
  moveBlock,
  placeBlock,
  resizeBlock
} from './blocks'

describe('a time block in a due date', () => {
  it('is a start and an end on the same day', () => {
    expect(blockOf({ start: '2026-10-22T09:00', end: '2026-10-22T10:30' })).toEqual({ day: '2026-10-22', start: 540, minutes: 90 })
    expect(durationOf({ start: '2026-10-22T09:00', end: '2026-10-22T09:15' })).toBe(15)
  })

  it('is not a day, a time alone, a range over days, or an end before the start', () => {
    expect(blockOf({ start: '2026-10-22' })).toBeNull()
    expect(blockOf({ start: '2026-10-22T09:00' })).toBeNull()
    expect(blockOf('2026-10-22T09:00')).toBeNull()
    expect(blockOf({ start: '2026-10-22T09:00', end: '2026-10-23T10:00' })).toBeNull()
    expect(blockOf({ start: '2026-10-22T09:00', end: '2026-10-22T09:00' })).toBeNull()
    expect(blockOf({ start: '2026-10-22T09:00', end: '2026-10-22T08:00' })).toBeNull()
    expect(blockOf({ start: '2026-10-22T25:00', end: '2026-10-22T26:00' })).toBeNull()
    expect(blockOf(null)).toBeNull()
  })

  it('is stored as a range of the day, ending by 23:59', () => {
    expect(blockValue({ day: '2026-10-22', start: 540, minutes: 45 })).toEqual({ start: '2026-10-22T09:00', end: '2026-10-22T09:45' })
    expect(blockValue({ day: '2026-10-22', start: 1410, minutes: 60 })).toEqual({ start: '2026-10-22T23:30', end: '2026-10-22T23:59' })
    expect(blockValue({ day: 'tomorrow', start: 540, minutes: 30 })).toBeNull()
    // Read back, it is the same block.
    const value = blockValue({ day: '2026-10-22', start: 615, minutes: 75 })
    expect(blockOf(value)).toEqual({ day: '2026-10-22', start: 615, minutes: 75 })
  })

  it('is never shorter than the shortest block', () => {
    expect(fitBlock({ day: '2026-10-22', start: 600, minutes: 5 })).toEqual({ day: '2026-10-22', start: 600, minutes: 15 })
    expect(fitBlock({ day: '2026-10-22', start: -30, minutes: 30 })).toEqual({ day: '2026-10-22', start: 0, minutes: 30 })
  })

  it('reads and writes the clock', () => {
    expect(minutesOf('07:45')).toBe(465)
    expect(minutesOf('24:00')).toBeNull()
    expect(minutesOf(undefined)).toBeNull()
    expect(clockOf(465)).toBe('07:45')
    expect(clockOf(5000)).toBe('23:59')
  })
})

describe('the free time of a day', () => {
  const busy = [
    { start: 600, end: 660 },
    { start: 630, end: 690 },
    { start: 780, end: 840 }
  ]

  it('merges what overlaps', () => {
    expect(mergeSpans(busy)).toEqual([
      { start: 600, end: 690 },
      { start: 780, end: 840 }
    ])
  })

  it('is what lies between', () => {
    expect(freeSpans(busy, 480, 900)).toEqual([
      { start: 480, end: 600 },
      { start: 690, end: 780 },
      { start: 840, end: 900 }
    ])
    expect(freeMinutes(busy, 480, 900)).toBe(120 + 90 + 60)
    expect(freeSpans(busy, 610, 700)).toEqual([{ start: 690, end: 700 }])
    expect(freeSpans([], 480, 600)).toEqual([{ start: 480, end: 600 }])
  })
})

describe('putting a task on the plan', () => {
  const busy = [{ start: 600, end: 660 }]

  it('starts on the quarter hour it was dropped in', () => {
    expect(placeBlock('2026-10-22', 547, busy)).toEqual({ day: '2026-10-22', start: 540, minutes: 30 })
  })

  it('stops where something else starts', () => {
    expect(placeBlock('2026-10-22', 585, busy)).toEqual({ day: '2026-10-22', start: 585, minutes: 15 })
    expect(placeBlock('2026-10-22', 570, busy, 60)).toEqual({ day: '2026-10-22', start: 570, minutes: 30 })
  })

  it('goes where it is put, even on something busy', () => {
    expect(placeBlock('2026-10-22', 615, busy)).toEqual({ day: '2026-10-22', start: 615, minutes: 30 })
  })

  it('resizes and moves on the grid', () => {
    const block = { day: '2026-10-22', start: 540, minutes: 30 }
    expect(resizeBlock(block, 628)).toEqual({ ...block, minutes: 90 })
    expect(resizeBlock(block, 500)).toEqual({ ...block, minutes: 15 })
    expect(moveBlock(block, 603)).toEqual({ ...block, start: 600 })
    expect(moveBlock(block, 2000)).toEqual({ ...block, start: 1409 })
  })
})

describe('a day that holds more than fits', () => {
  it('fits when the tasks without a time have room', () => {
    const load = dayLoad({ events: [{ start: 540, end: 600 }], blocks: [], unplaced: 2, from: 480, to: 720 })
    expect(load).toMatchObject({ free: 180, wanted: 60, over: false })
  })

  it('does not when they want more than is free', () => {
    const load = dayLoad({ events: [{ start: 480, end: 1140 }], blocks: [], unplaced: 3, from: 480, to: 1200 })
    expect(load).toMatchObject({ free: 60, wanted: 90, over: true })
  })

  it('stops saying so once the planned hours are over', () => {
    expect(dayLoad({ events: [], blocks: [], unplaced: 4, from: 480, to: 1200, now: 1300 })).toMatchObject({ free: 0, over: false })
  })

  it('counts only what is left of today', () => {
    expect(dayLoad({ events: [], blocks: [], unplaced: 4, from: 480, to: 1200, now: 1140 })).toMatchObject({ free: 60, over: true })
  })

  it('does not when blocks sit on top of events, but two events clashing are the calendar’s', () => {
    expect(
      dayLoad({ events: [{ start: 600, end: 660 }], blocks: [{ start: 630, end: 690 }], unplaced: 0, from: 480, to: 1200 })
    ).toMatchObject({
      overlap: 30,
      over: true
    })
    expect(
      dayLoad({
        events: [
          { start: 600, end: 660 },
          { start: 600, end: 660 }
        ],
        blocks: [],
        unplaced: 0,
        from: 480,
        to: 1200
      })
    ).toMatchObject({ overlap: 0, over: false })
  })
})
