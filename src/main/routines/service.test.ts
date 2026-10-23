import { describe, expect, it } from 'vitest'
import { addUsage, AI_USAGE_KEY, readUsage } from '../../shared/aiUsage'
import { ROUTINE_DEFAULTS, ROUTINES_KEY, withRoutines, type RoutineId } from '../../shared/routines'
import type { CloseData, DayData, StalledData } from './data'
import { ROUTINES_STATE_KEY } from './schedule'
import { RoutinesService, type RoutineBuild } from './service'

const at = (hours: number, minutes = 0, day = 22): number => new Date(2026, 9, day, hours, minutes).getTime()

const DAY: DayData = {
  date: 'Thursday, 22 October 2026',
  time: '08:30',
  today: '2026-10-22',
  events: ['09:00–09:30: Standup'],
  free: ['09:30–12:00'],
  overdue: [{ id: 'task-overdue-1', title: 'Pay the bill', due: '2026-10-20' }],
  dueToday: [{ id: 'task-today-001', title: 'Write the report', due: '2026-10-22', priority: 'P2' }],
  undated: [],
  projects: ['Website — next: Draft the brief [task-proj-0001]']
}

const CLOSE: CloseData = { ...DAY, done: ['Write the report'], edited: ['Notes'], line: '', tomorrowPlans: [] }

const STALLED: StalledData = {
  date: 'Thursday, 22 October 2026',
  task: {
    id: 'task-stuck-01',
    title: 'File the taxes',
    postponed: 4,
    untouchedDays: 3,
    ageDays: 40,
    project: null,
    due: '2026-10-25',
    subtasks: []
  }
}

function harness(options: { routines?: RoutineId[]; now?: number; usage?: number; stalled?: StalledData | null; fail?: boolean } = {}) {
  const settings: Record<string, unknown> = {
    [ROUTINES_KEY]: withRoutines(ROUTINE_DEFAULTS, options.routines ?? ['morning'], true),
    'herman.quietHours': { from: 21 * 60, to: 8 * 60 }
  }
  let usage = readUsage(null)
  for (let i = 0; i < (options.usage ?? 0); i++)
    usage = addUsage(usage, { day: '2026-10-22', origin: 'routine:midday', ms: 1000, costUsd: null })
  settings[AI_USAGE_KEY] = usage
  const clock = { now: options.now ?? at(8, 30) }
  const asked: { routine: RoutineId; prompt: string; tools: boolean }[] = []
  let notified = 0
  const service = new RoutinesService({
    getSetting: (key) => settings[key] ?? null,
    setSetting: (key, value) => {
      settings[key] = value
    },
    now: () => clock.now,
    locale: () => 'en',
    read: {
      day: async () => DAY,
      close: async () => CLOSE,
      stalled: async (skip) => {
        const found = options.stalled === undefined ? STALLED : options.stalled
        return found && !skip.has(found.task.id) ? found : null
      }
    },
    ask: async (routine: RoutineId, build: RoutineBuild, { tools, context }) => {
      if (options.fail) throw new Error('Claude Code was not found on this computer.')
      const prompt = build({ language: 'auto', voice: null, persona: 'herman', tools, servers: [], context })
      asked.push({ routine, prompt, tools })
      // A request is counted by the AI service, under the routine's origin.
      settings[AI_USAGE_KEY] = addUsage(readUsage(settings[AI_USAGE_KEY]), {
        day: '2026-10-22',
        origin: `routine:${routine}`,
        ms: 2000,
        costUsd: 0.01
      })
      return { text: `Here is the ${routine} answer.\n\n\`\`\`sel-actions\n[]\n\`\`\`` }
    },
    notify: () => {
      notified++
    }
  })
  return { service, settings, clock, asked, notified: () => notified }
}

describe('the routines on a fake clock', () => {
  it('run the morning plan once at its time and hold it until a quiet moment', async () => {
    const { service, clock, asked, notified } = harness({ now: at(8, 0) })
    await service.tick()
    expect(asked).toHaveLength(0)
    clock.now = at(8, 30)
    await service.tick()
    expect(asked.map((entry) => entry.routine)).toEqual(['morning'])
    expect(asked[0].tools).toBe(true)
    expect(asked[0].prompt).toContain('[task-today-001]')
    expect(notified()).toBe(1)
    // Not again the same day.
    clock.now = at(9, 0)
    await service.tick()
    expect(asked).toHaveLength(1)
    // Held: typing first, then said once.
    expect(service.next({ idleMs: 3000 }).offer).toBeNull()
    const reply = service.next({ idleMs: 60_000 })
    expect(reply.offer).toMatchObject({
      routine: 'morning',
      kind: 'balloon',
      line: 'I put together a plan for today. Want to see it?',
      delivery: { source: 'routine:morning', today: true, request: 'Plan my day.' }
    })
    expect(service.next({ idleMs: 60_000 }).offer).toBeNull()
  })

  it('never speaks while the window is busy or at night', async () => {
    const { service, clock } = harness()
    await service.tick()
    expect(service.next({ idleMs: 60_000 }, true).offer).toBeNull()
    expect(service.next({ idleMs: 60_000, busy: true }).offer).toBeNull()
    clock.now = at(21, 30)
    expect(service.next({ idleMs: 60_000 }).offer).toBeNull()
  })

  it('drops what a routine prepared once it is turned off', async () => {
    const { service, settings } = harness()
    await service.tick()
    expect(service.waiting()).toHaveLength(1)
    settings[ROUTINES_KEY] = ROUTINE_DEFAULTS
    service.settingsChanged()
    expect(service.waiting()).toHaveLength(0)
  })

  it('stops at the daily limit and says so once', async () => {
    const { service, clock, asked } = harness({ routines: ['morning', 'midday'], usage: 6 })
    await service.tick()
    expect(asked).toHaveLength(0)
    expect(service.waiting()).toEqual([expect.objectContaining({ routine: 'limit', kind: 'note' })])
    expect(service.next({ idleMs: 60_000 }).offer?.line).toContain('daily limit')
    // The midday one is stopped too, without a second word about it.
    clock.now = at(13, 30)
    await service.tick()
    expect(asked).toHaveLength(0)
    expect(service.waiting()).toHaveLength(0)
  })

  it('counts its own requests toward the limit', async () => {
    const { service, settings } = harness({ usage: 5 })
    await service.tick()
    expect(service.usage()).toMatchObject({ routinesToday: 6, routineLimit: 6 })
    expect(readUsage(settings[AI_USAGE_KEY])['2026-10-22']['routine:morning']).toEqual({
      requests: 1,
      ms: 2000,
      costUsd: 0.01,
      costed: 1
    })
  })

  it('runs a routine at once when asked, whatever its time and the limit', async () => {
    const { service, asked } = harness({ routines: [], now: at(15, 0), usage: 10 })
    const offer = await service.runNow('evening')
    expect(asked.map((entry) => entry.routine)).toEqual(['evening'])
    expect(asked[0].tools).toBe(false)
    expect(offer).toMatchObject({ kind: 'balloon', delivery: { title: 'Close of the day' } })
    await expect(service.runNow('nope')).rejects.toThrow('Unknown routine')
  })

  it('offers the weekly review without running the AI', async () => {
    const { service, clock, asked } = harness({ routines: ['weekly'], now: at(17, 0, 23) })
    clock.now = at(17, 5, 23)
    await service.tick()
    expect(asked).toHaveLength(0)
    expect(service.waiting()).toEqual([expect.objectContaining({ routine: 'weekly', kind: 'review', label: 'Open the review' })])
  })

  it('unsticks one task a day at most, and not the same one again soon', async () => {
    const { service, settings, clock, asked } = harness({ routines: ['stalled'], now: at(10, 30) })
    await service.tick()
    expect(asked.map((entry) => entry.routine)).toEqual(['stalled'])
    expect(asked[0].prompt).toContain('File the taxes [task-stuck-01]')
    expect(service.waiting()[0].line).toBe('“File the taxes” has been waiting a while. I have an idea to get it moving.')
    clock.now = at(12, 0)
    await service.tick()
    expect(asked).toHaveLength(1)
    // The next day the same task is not offered again: nothing else is stuck, so nothing runs.
    clock.now = at(10, 30, 23)
    await service.tick()
    expect(asked).toHaveLength(1)
    expect((settings[ROUTINES_STATE_KEY] as { offered: unknown[] }).offered).toEqual([{ id: 'task-stuck-01', day: '2026-10-22' }])
    // Asked for by hand, it says nothing is stuck.
    expect(await service.runNow('stalled')).toMatchObject({ kind: 'note', line: 'Nothing seems stuck right now.' })
  })

  it('keeps quiet when the AI fails on its own, and says why when asked by hand', async () => {
    const { service } = harness({ fail: true })
    await service.tick()
    expect(service.waiting()).toHaveLength(0)
    await expect(service.runNow('morning')).rejects.toThrow('Claude Code was not found')
  })

  it('runs nothing while AI is turned off', async () => {
    const { service, settings, asked } = harness()
    settings['ai.enabled'] = false
    await service.tick()
    expect(asked).toHaveLength(0)
    await expect(service.runNow('morning')).rejects.toThrow('AI is turned off')
  })

  it('checks what a window says', () => {
    const { service } = harness()
    expect(() => service.next({ idleMs: -1 })).toThrow('Invalid signals')
    expect(() => service.next('nope')).toThrow()
  })
})
