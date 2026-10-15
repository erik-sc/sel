process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it, vi } from 'vitest'
import { ALARMS_FIRED_KEY, ALARMS_SETTING, cleanAlarmsSetting, cleanAlarmTimes, readAlarmSettings, type Announcement } from '../../shared/alarms'
import type { Briefing, BriefingEvent, BriefingTask } from '../../shared/briefing'
import type { Block, BlockProps } from '../../shared/types'
import { composeBriefing, composeReminder } from './compose'
import { dueReminders, momentOf, nextReminderAt, remindersOf, tasksDatabase } from './reminders'
import { AlarmsService, PREPARE_MS, type AlarmsDeps } from './service'

const MIN = 60_000
const local = (y: number, m: number, d: number, h = 0, mi = 0): number => new Date(y, m - 1, d, h, mi).getTime()

// ---- shared settings ----

describe('alarm settings', () => {
  it('accept well-formed times only', () => {
    const time = { id: 'a1', time: '08:30', days: [5, 1, 1], enabled: true }
    expect(cleanAlarmTimes([time])).toEqual([{ ...time, days: [1, 5] }])
    expect(cleanAlarmTimes([{ ...time, time: '8:30' }])).toBeUndefined()
    expect(cleanAlarmTimes([{ ...time, time: '24:00' }])).toBeUndefined()
    expect(cleanAlarmTimes([{ ...time, days: [7] }])).toBeUndefined()
    expect(cleanAlarmTimes([time, time])).toBeUndefined()
    expect(cleanAlarmTimes(Array.from({ length: 13 }, (_, i) => ({ ...time, id: `t${i}` })))).toBeUndefined()
    expect(cleanAlarmsSetting(ALARMS_SETTING.tray, true)).toBe(true)
    expect(cleanAlarmsSetting(ALARMS_SETTING.tray, 'yes')).toBeUndefined()
    expect(cleanAlarmsSetting(ALARMS_FIRED_KEY, {})).toBeUndefined()
  })

  it('fall back to their defaults', () => {
    const settings = readAlarmSettings((key) => (key === ALARMS_SETTING.voice ? false : key === ALARMS_SETTING.times ? 'junk' : null))
    expect(settings.voice).toBe(false)
    expect(settings.times).toEqual([])
    expect(settings.sound).toBe(true)
    expect(settings.tray).toBe(false)
  })
})

// ---- reminders ----

const schema = {
  title: { id: 'title', name: 'Name', type: 'title' },
  'tasks.done': { id: 'tasks.done', name: 'Done', type: 'checkbox' },
  'tasks.due': { id: 'tasks.due', name: 'Due', type: 'date' },
  'tasks.remind': { id: 'tasks.remind', name: 'Remind', type: 'date' }
} as unknown as BlockProps['schema']

function block(id: string, props: BlockProps, extra: Partial<Block> = {}): Block {
  return { id, type: 'page', parentId: 'db', content: [], props, createdAt: 0, updatedAt: 0, trashedAt: null, ...extra }
}
const db = block('db', { title: [['Tasks']], system: 'tasks', schema }, { type: 'database', parentId: null })
const row = (id: string, values: Record<string, unknown>): Block => block(id, { title: [[id]], values: values as BlockProps['values'] })

describe('reminders', () => {
  it('finds the built-in database among the root blocks', () => {
    const plain = block('other', { title: [['Other']], schema }, { type: 'database', parentId: null })
    expect(tasksDatabase([plain, db])?.id).toBe('db')
    expect(tasksDatabase([plain])).toBeNull()
    expect(tasksDatabase([{ ...db, trashedAt: 1 }])).toBeNull()
  })

  it('reads moments as local wall-clock times', () => {
    expect(momentOf({ start: '2026-10-15T09:30' }, null)).toBe(local(2026, 10, 15, 9, 30))
    expect(momentOf({ start: '2026-10-15' }, null)).toBeNull()
    expect(momentOf({ start: '2026-10-15' }, '09:00')).toBe(local(2026, 10, 15, 9, 0))
    expect(momentOf('nonsense', '09:00')).toBeNull()
  })

  it('collects reminders and timed due dates of open rows', () => {
    const rows = [
      row('call', { 'tasks.due': { start: '2026-10-15T10:00' } }),
      row('pay', { 'tasks.due': { start: '2026-10-15' }, 'tasks.remind': { start: '2026-10-15T08:00' } }),
      row('done', { 'tasks.due': { start: '2026-10-15T11:00' }, 'tasks.done': true }),
      row('allDay', { 'tasks.due': { start: '2026-10-15' } }),
      row('dayReminder', { 'tasks.remind': { start: '2026-10-16' } })
    ]
    const list = remindersOf(db, rows, { atDue: true })
    expect(list.map((r) => [r.rowId, r.at, r.atDue])).toEqual([
      ['pay', local(2026, 10, 15, 8, 0), false],
      ['call', local(2026, 10, 15, 10, 0), true],
      ['dayReminder', local(2026, 10, 16, 9, 0), false]
    ])
    expect(remindersOf(db, rows, { atDue: false }).map((r) => r.rowId)).toEqual(['pay', 'dayReminder'])
    expect(nextReminderAt(list, local(2026, 10, 15, 9, 0))).toBe(local(2026, 10, 15, 10, 0))
  })

  it('rings each reminder once, within its grace period', () => {
    const list = remindersOf(db, [row('call', { 'tasks.due': { start: '2026-10-15T10:00' } })], { atDue: true })
    const at = local(2026, 10, 15, 10, 0)
    expect(dueReminders(list, {}, at - MIN)).toEqual([])
    expect(dueReminders(list, {}, at + 5 * MIN).length).toBe(1)
    expect(dueReminders(list, { [list[0].key]: at }, at + 5 * MIN)).toEqual([])
    expect(dueReminders(list, {}, at + 20 * MIN)).toEqual([])
  })
})

// ---- words ----

const event = (title: string, start: number, end: number, allDay = false): BriefingEvent => ({ id: title, calendarId: 'c', title, start, end, allDay, recurring: false })
const task = (title: string, due?: string): BriefingTask => ({ id: title, kind: 'row', title, pageId: title, source: 'Tasks', ...(due ? { due } : {}) })

describe('his words', () => {
  const now = local(2026, 10, 15, 8, 30)

  it('brief the day in Portuguese', () => {
    const { text, speech } = composeBriefing({
      now,
      locale: 'pt-BR',
      name: 'Érik',
      events: [event('Daily', local(2026, 10, 15, 10, 0), local(2026, 10, 15, 10, 30)), event('Almoço', local(2026, 10, 15, 12, 0), local(2026, 10, 15, 13, 0))],
      tasks: { overdue: [task('Enviar proposta', '2026-10-13')], today: [task('Revisar plano'), task('Pagar conta')] }
    })
    expect(text).toBe('Bom dia, Érik. 2 compromissos na agenda; o próximo é Daily, às 10:00. 2 tarefas para hoje e uma atrasada. Eu começaria por Enviar proposta. É isso.')
    expect(speech).toBe(text)
  })

  it('brief an empty day in English', () => {
    const { text } = composeBriefing({ now: local(2026, 10, 15, 19, 0), locale: 'en', name: '', events: [], tasks: { overdue: [], today: [] } })
    expect(text).toBe('Good evening. Nothing on the calendar today. No tasks for today. That is all.')
  })

  it('say when the calendar is behind and count all-day events', () => {
    const { text } = composeBriefing({
      now: local(2026, 10, 15, 18, 0),
      locale: 'en',
      name: 'Ana',
      events: [event('Standup', local(2026, 10, 15, 9, 0), local(2026, 10, 15, 9, 15)), event('Holiday', local(2026, 10, 15), local(2026, 10, 16), true)],
      tasks: { overdue: [task('Old thing')], today: [] }
    })
    expect(text).toBe('Good evening, Ana. 1 things were on the calendar today; they are behind you. One all-day event. One task overdue. I would begin with Old thing. That is all.')
  })

  it('remind of a task', () => {
    const base = { key: 'k', rowId: 'r', title: 'Ligar para o banco', at: 0, due: '2026-10-15T10:00', atDue: true }
    expect(composeReminder(base, 'pt-BR').text).toBe('Ligar para o banco: são 10:00, a hora que você marcou.')
    expect(composeReminder({ ...base, atDue: false }, 'en').text).toBe('Reminder: Ligar para o banco, due at 10:00 AM.')
    expect(composeReminder({ ...base, atDue: false, due: '2026-10-15' }, 'en').text).toBe('Reminder: Ligar para o banco.')
  })
})

// ---- the clock ----

/** Lets the promises started by a tick (reading the day, the AI) finish. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function harness(settings: Record<string, unknown>, options: { now: number; rows?: Block[]; recording?: boolean; write?: AlarmsDeps['writeBriefing'] }) {
  const store = new Map<string, unknown>(Object.entries(settings))
  let now = options.now
  let id = 0
  const timers: { run: () => void; at: number; handle: number }[] = []
  const said: Announcement[] = []
  const day: Briefing = {
    date: '2026-10-15',
    greeting: '',
    phrase: null,
    hasPhrases: false,
    events: { today: [], calendars: [] },
    tasks: { overdue: [], today: [task('Write the report')], more: 0 },
    updatedAt: 0
  }
  const deps: AlarmsDeps = {
    getSetting: (key) => store.get(key) ?? null,
    setSetting: (key, value) => void store.set(key, value),
    now: () => now,
    id: () => `n${++id}`,
    timers: {
      set: (run, ms) => {
        const handle = timers.length + 1
        timers.push({ run, at: now + ms, handle })
        return handle
      },
      clear: (handle) => {
        const index = timers.findIndex((t) => t.handle === handle)
        if (index >= 0) timers[index].at = Number.POSITIVE_INFINITY
      }
    },
    briefing: async () => day,
    tasks: () => (options.rows ? { database: db, rows: options.rows } : null),
    locale: () => 'en',
    recording: () => options.recording === true,
    deliver: (a) => void said.push(a),
    ...(options.write ? { writeBriefing: options.write } : {}),
    log: () => undefined
  }
  const service = new AlarmsService(deps)
  /** Moves the clock to `to`, running the timers due on the way. */
  const advance = async (to: number): Promise<void> => {
    for (;;) {
      const next = timers.filter((t) => t.at <= to).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      now = next.at
      next.at = Number.POSITIVE_INFINITY
      next.run()
      await settle()
    }
    now = to
    await settle()
  }
  return { service, said, store, advance, setRecording: (on: boolean) => (options.recording = on) }
}

const times = [{ id: 'work', time: '08:30', days: [1, 2, 3, 4, 5], enabled: true }]

describe('the clock', () => {
  it('rings at the time, once, and remembers it', async () => {
    const h = harness({ [ALARMS_SETTING.times]: times }, { now: local(2026, 10, 15, 8, 0) })
    h.service.plan()
    await h.advance(local(2026, 10, 15, 8, 29))
    expect(h.said).toEqual([])
    await h.advance(local(2026, 10, 15, 8, 31))
    expect(h.said.length).toBe(1)
    expect(h.said[0]).toMatchObject({ kind: 'briefing', sound: true, voice: true, locale: 'en', at: local(2026, 10, 15, 8, 30) })
    expect(h.said[0].text).toContain('I would begin with Write the report.')
    expect(h.store.get(ALARMS_FIRED_KEY)).toEqual({ 'a:work': local(2026, 10, 15, 8, 30) })
    expect(h.service.pendingAnnouncement()?.id).toBe(h.said[0].id)
    h.service.heard(h.said[0].id)
    expect(h.service.pendingAnnouncement()).toBeNull()
    await h.advance(local(2026, 10, 15, 12, 0))
    expect(h.said.length).toBe(1)
  })

  it('rings a briefing missed while asleep when it starts within the grace period', async () => {
    const h = harness({ [ALARMS_SETTING.times]: times }, { now: local(2026, 10, 15, 8, 45) })
    h.service.plan()
    await h.advance(local(2026, 10, 15, 8, 45))
    expect(h.said.length).toBe(1)
  })

  it('waits while a meeting is recorded', async () => {
    const h = harness({ [ALARMS_SETTING.times]: times }, { now: local(2026, 10, 15, 8, 30), recording: true })
    h.service.plan()
    await h.advance(local(2026, 10, 15, 8, 30))
    expect(h.said).toEqual([])
    h.setRecording(false)
    await h.advance(local(2026, 10, 15, 8, 32))
    expect(h.said.length).toBe(1)
  })

  it('gives reminders of tasks', async () => {
    const rows = [row('Call the bank', { 'tasks.due': { start: '2026-10-15T10:00' } })]
    const h = harness({}, { now: local(2026, 10, 15, 9, 0), rows })
    h.service.plan()
    await h.advance(local(2026, 10, 15, 10, 1))
    expect(h.said.length).toBe(1)
    expect(h.said[0]).toMatchObject({ kind: 'reminder', pageId: 'Call the bank' })
    expect(h.said[0].text).toBe('Call the bank: it is 10:00 AM, the time you gave it.')
    await h.advance(local(2026, 10, 15, 10, 20))
    expect(h.said.length).toBe(1)
  })

  it('stays silent with reminders off', async () => {
    const rows = [row('Call the bank', { 'tasks.due': { start: '2026-10-15T10:00' } })]
    const h = harness({ [ALARMS_SETTING.reminders]: false }, { now: local(2026, 10, 15, 9, 0), rows })
    h.service.plan()
    await h.advance(local(2026, 10, 15, 10, 5))
    expect(h.said).toEqual([])
  })

  it('asks the AI ahead of time and uses its words', async () => {
    const write = vi.fn(async () => 'Morning. Two meetings, one report. Start with the report.')
    const h = harness({ [ALARMS_SETTING.times]: times, [ALARMS_SETTING.ai]: true }, { now: local(2026, 10, 15, 8, 0), write })
    h.service.plan()
    await h.advance(local(2026, 10, 15, 8, 30) - PREPARE_MS + MIN)
    expect(write).toHaveBeenCalledTimes(1)
    await h.advance(local(2026, 10, 15, 8, 30))
    expect(h.said[0]).toMatchObject({ text: 'Morning. Two meetings, one report. Start with the report.', ai: true })
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('falls back to his own words when the AI fails', async () => {
    const write = vi.fn(async () => {
      throw new Error('no program')
    })
    const h = harness({ [ALARMS_SETTING.times]: times, [ALARMS_SETTING.ai]: true }, { now: local(2026, 10, 15, 8, 0), write })
    h.service.plan()
    await h.advance(local(2026, 10, 15, 8, 31))
    expect(h.said.length).toBe(1)
    expect(h.said[0].ai).toBeUndefined()
    expect(h.said[0].text).toContain('Write the report')
  })

  it('briefs on demand without remembering it as rung', async () => {
    const h = harness({ [ALARMS_SETTING.times]: times, [ALARMS_SETTING.sound]: false }, { now: local(2026, 10, 15, 8, 0) })
    await h.service.test()
    expect(h.said.length).toBe(1)
    expect(h.said[0].sound).toBe(false)
    expect(h.store.get(ALARMS_FIRED_KEY)).toBeUndefined()
  })
})
