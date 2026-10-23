import { describe, expect, it } from 'vitest'
import type { BriefingEvent, BriefingTask, BriefingTasks } from '@shared/briefing'
import { dayStart, nextDayStart } from './format'
import { lengthLabel, patchTasks, planBlocks, planEvents, planLoad, planWindow, unplannedTasks, withLanes } from './plan'

const DAY = '2026-10-22'
const from = dayStart(DAY) as number
const to = nextDayStart(from)
const at = (hours: number, minutes = 0): number => from + (hours * 60 + minutes) * 60_000

const event = (id: string, start: number, end: number, allDay = false): BriefingEvent => ({
  id,
  calendarId: 'cal',
  title: id,
  start,
  end,
  allDay,
  recurring: false
})
const task = (id: string, extra: Partial<BriefingTask> = {}): BriefingTask => ({
  id,
  kind: 'row',
  title: id,
  pageId: id,
  source: 'Tasks',
  dateProperty: 'tasks.due',
  ...extra
})

describe('the events of the plan', () => {
  it('are the timed ones, in minutes of the day, cut to it', () => {
    const events = planEvents(
      [
        event('standup', at(9, 30), at(9, 45)),
        event('holiday', from, to, true),
        event('overnight', at(-2), at(1)),
        event('tomorrow', to + 60_000, to + 120_000)
      ],
      from,
      to
    )
    expect(events.map((item) => [item.event.id, item.start, item.end])).toEqual([
      ['overnight', 0, 60],
      ['standup', 570, 585]
    ])
  })
})

describe('the blocks of the plan', () => {
  it('are the tasks of the day with a time, as long as their block or half an hour', () => {
    const blocks = planBlocks(
      [
        task('write', { due: DAY, time: '10:00', minutes: 90 }),
        task('call', { due: DAY, time: '09:00' }),
        task('other', { due: '2026-10-23', time: '09:00' }),
        task('loose', { due: DAY })
      ],
      DAY
    )
    expect(blocks.map((item) => [item.task.id, item.start, item.end, item.sized])).toEqual([
      ['call', 540, 570, false],
      ['write', 600, 690, true]
    ])
  })

  it('leave the rest to be planned', () => {
    const tasks: BriefingTasks = {
      overdue: [task('late', { due: '2026-10-20' })],
      today: [task('timed', { due: DAY, time: '09:00' }), task('free', { due: DAY })],
      noDate: [task('someday')],
      more: 0
    }
    expect(unplannedTasks(tasks, DAY).map((each) => each.id)).toEqual(['late', 'free', 'someday'])
  })
})

describe('the hours the plan shows', () => {
  it('are eight to eight, widened to whole hours around anything outside', () => {
    expect(planWindow([])).toEqual({ start: 480, end: 1200 })
    expect(
      planWindow([
        { start: 405, end: 450 },
        { start: 1250, end: 1290 }
      ])
    ).toEqual({ start: 360, end: 1320 })
  })
})

describe('how the day stands', () => {
  it('counts today’s tasks without a time against what is free', () => {
    const events = planEvents([event('offsite', at(8), at(19, 30))], from, to)
    const tasks: BriefingTasks = { overdue: [task('late')], today: [task('a', { due: DAY }), task('b', { due: DAY })], more: 0 }
    expect(planLoad(events, [], tasks, DAY)).toMatchObject({ free: 30, wanted: 60, over: true })
    expect(planLoad([], [], tasks, DAY)).toMatchObject({ over: false })
  })
})

describe('a block shown before the next load', () => {
  it('moves the task to today’s list with its time and length', () => {
    const tasks: BriefingTasks = {
      overdue: [task('late', { due: '2026-10-20' })],
      today: [task('a', { due: DAY })],
      noDate: [task('n')],
      more: 0
    }
    const next = patchTasks(tasks, 'late', { due: DAY, time: '09:00', minutes: 45 }, DAY)
    expect(next.overdue).toEqual([])
    expect(next.today.map((each) => [each.id, each.time, each.minutes])).toEqual([
      ['a', undefined, undefined],
      ['late', '09:00', 45]
    ])
    const off = patchTasks(next, 'late', { due: DAY, time: null, minutes: null }, DAY)
    expect(off.today.find((each) => each.id === 'late')).not.toHaveProperty('time')
    expect(patchTasks(tasks, 'missing', { due: DAY }, DAY)).toBe(tasks)
  })
})

describe('lanes and lengths', () => {
  it('puts what overlaps side by side', () => {
    const placed = withLanes([
      { start: 540, end: 600 },
      { start: 570, end: 630 },
      { start: 660, end: 690 }
    ])
    expect(placed.map((item) => [item.lane, item.lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1]
    ])
  })

  it('says how long', () => {
    expect(lengthLabel(45)).toBe('45 min')
    expect(lengthLabel(60)).toBe('1 h')
    expect(lengthLabel(90)).toBe('1 h 30')
  })
})
