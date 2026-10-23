import { describe, expect, it } from 'vitest'
import { ROUTINE_DEFAULTS, withRoutines, type RoutineId, type RoutinesSettings } from '../../shared/routines'
import {
  DELIVERY_GAP_MS,
  dueRoutine,
  EMPTY_STATE,
  isNight,
  markRan,
  mayDeliver,
  readState,
  recentlyOffered,
  ROUTINE_IDLE_MS,
  windowOf,
  type RoutinesState
} from './schedule'

// Thursday 22 October 2026, local time.
const at = (hours: number, minutes = 0, day = 22): number => new Date(2026, 9, day, hours, minutes).getTime()
const QUIET = { from: 21 * 60, to: 8 * 60 }
const on = (...ids: RoutineId[]): RoutinesSettings => withRoutines(ROUTINE_DEFAULTS, ids, true)
const fresh = (): RoutinesState => ({ ...EMPTY_STATE, ran: {}, offered: [] })

describe('when a routine runs', () => {
  it('runs nothing while every routine is off (the default)', () => {
    expect(dueRoutine(ROUTINE_DEFAULTS, fresh(), at(8, 45), QUIET).run).toBeNull()
  })

  it('runs the morning plan from its time, once a day', () => {
    const settings = on('morning')
    expect(dueRoutine(settings, fresh(), at(8, 29), QUIET).run).toBeNull()
    const due = dueRoutine(settings, fresh(), at(8, 30), QUIET)
    expect(due.run).toBe('morning')
    const ran = markRan(fresh(), ['morning'], at(8, 30))
    expect(dueRoutine(settings, ran, at(9, 0), QUIET).run).toBeNull()
    // The next day it is due again.
    expect(dueRoutine(settings, ran, at(8, 31, 23), QUIET).run).toBe('morning')
  })

  it('waits until the next routine’s time when none is due yet', () => {
    const due = dueRoutine(on('midday'), fresh(), at(13, 0), QUIET)
    expect(due.run).toBeNull()
    expect(due.waitMs).toBe(30 * 60_000)
  })

  it('lets a routine go once its window has passed', () => {
    // The morning window is three hours: at 11:31 the plan for the day is too late.
    expect(dueRoutine(on('morning'), fresh(), at(11, 29), QUIET).run).toBe('morning')
    expect(dueRoutine(on('morning'), fresh(), at(11, 31), QUIET).run).toBeNull()
  })

  it('never runs at night or in the quiet hours', () => {
    const settings: RoutinesSettings = { ...on('morning'), routines: { ...on('morning').routines, morning: { on: true, time: '07:00' } } }
    // 07:30 is in the quiet hours (until 08:00): it waits for them to end, then runs within its window.
    const quiet = dueRoutine(settings, fresh(), at(7, 30), QUIET)
    expect(quiet.run).toBeNull()
    expect(quiet.waitMs).toBe(30 * 60_000)
    expect(dueRoutine(settings, fresh(), at(8, 0), QUIET).run).toBe('morning')
    // Without quiet hours the night still holds: nothing before 06:00 or from 22:00.
    expect(isNight(at(5, 59), null)).toBe(true)
    expect(isNight(at(22, 0), null)).toBe(true)
    expect(isNight(at(21, 59), null)).toBe(false)
    expect(dueRoutine(on('evening'), fresh(), at(23, 0), null).run).toBeNull()
  })

  it('does not pile up missed routines: only the latest one runs, the others count as done', () => {
    const settings = on('morning', 'stalled', 'midday')
    // The app opens at 13:45: the morning plan (until 11:30) is gone, the stalled check (10:30, six
    // hours) and the midday check-in (13:30) are both due: only the midday one runs.
    const due = dueRoutine(settings, fresh(), at(13, 45), QUIET)
    expect(due.run).toBe('midday')
    expect(due.skip).toEqual(['stalled'])
    const after = markRan(fresh(), [due.run as RoutineId, ...due.skip], at(13, 45))
    expect(dueRoutine(settings, after, at(14, 0), QUIET).run).toBeNull()
  })

  it('offers the weekly review on its day only', () => {
    const friday = on('weekly')
    expect(windowOf('weekly', friday, at(17, 0))).toBeNull() // Thursday
    expect(dueRoutine(friday, fresh(), at(17, 30, 23), QUIET).run).toBe('weekly')
    const sunday: RoutinesSettings = { ...friday, weeklyDay: 0 }
    expect(dueRoutine(sunday, fresh(), at(17, 30, 23), QUIET).run).toBeNull()
    expect(dueRoutine(sunday, fresh(), at(17, 30, 25), QUIET).run).toBe('weekly')
  })

  it('keeps a window out of the night', () => {
    const late: RoutinesSettings = { ...on('evening'), routines: { ...on('evening').routines, evening: { on: true, time: '21:30' } } }
    const span = windowOf('evening', late, at(12, 0))
    expect(span).toEqual({ start: at(21, 30), end: at(22, 0) })
  })
})

describe('when what a routine prepared is said', () => {
  const moment = (over: Partial<{ now: number; idleMs: number; busy: boolean; pending: boolean }> = {}) => ({
    now: at(9, 0),
    idleMs: 60_000,
    busy: false,
    pending: true,
    ...over
  })

  it('says it at a quiet moment', () => {
    expect(mayDeliver(fresh(), moment(), QUIET)).toEqual({ ok: true })
  })

  it('never into typing', () => {
    const decision = mayDeliver(fresh(), moment({ idleMs: 5000 }), QUIET)
    expect(decision).toEqual({ ok: false, reason: 'typing', waitMs: ROUTINE_IDLE_MS - 5000 })
  })

  it('not while the window is busy, at night, or right after the last one', () => {
    expect(mayDeliver(fresh(), moment({ busy: true }), QUIET)).toMatchObject({ ok: false, reason: 'busy' })
    expect(mayDeliver(fresh(), moment({ now: at(21, 30) }), QUIET)).toMatchObject({ ok: false, reason: 'night' })
    const said = { ...fresh(), lastSaidAt: at(8, 50) }
    expect(mayDeliver(said, moment(), QUIET)).toEqual({ ok: false, reason: 'too-soon', waitMs: DELIVERY_GAP_MS - 10 * 60_000 })
    // A clock set back keeps the gate shut for one gap at most.
    expect(mayDeliver({ ...fresh(), lastSaidAt: at(10, 0) }, moment(), QUIET)).toMatchObject({ waitMs: DELIVERY_GAP_MS })
  })

  it('has nothing to say when nothing waits', () => {
    expect(mayDeliver(fresh(), moment({ pending: false }), QUIET)).toMatchObject({ ok: false, reason: 'nothing' })
  })
})

describe('what the routines remember', () => {
  it('forgets what is malformed', () => {
    expect(readState(null)).toEqual(EMPTY_STATE)
    expect(
      readState({ ran: { morning: '2026-10-22', midday: 'nope', other: '2026-10-22' }, limitSaid: 5, offered: [{ id: 'x', day: 'y' }] })
    ).toEqual({ ran: { morning: '2026-10-22' }, limitSaid: '', offered: [], lastSaidAt: 0 })
  })

  it('remembers the tasks it offered for two weeks', () => {
    const state = {
      ...fresh(),
      offered: [
        { id: 'old-task-1', day: '2026-10-01' },
        { id: 'new-task-1', day: '2026-10-20' }
      ]
    }
    expect([...recentlyOffered(state, '2026-10-22')]).toEqual(['new-task-1'])
  })
})
