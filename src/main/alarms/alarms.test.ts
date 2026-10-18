process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it, vi } from 'vitest'
import { ALARMS_FIRED_KEY, ALARMS_SETTING, ALARMS_SNOOZED_KEY, cleanAlarmsSetting, cleanAlarmTimes, readAlarmSettings, SNOOZE_MS, type Announcement } from '../../shared/alarms'
import type { Briefing, BriefingEvent, BriefingTask } from '../../shared/briefing'
import type { Block, BlockProps } from '../../shared/types'
import { expandCalendar, parseCalendar } from '../briefing/ical'
import { composeBriefing, composeEvents, composeReminder } from './compose'
import { asksToRecord, dueEventAlarms, eventAlarmsOf, nextEventAlarmAt, readSnoozed, snoozeOf } from './events'
import { dueReminders, momentOf, nextReminderAt, remindersOf, tasksDatabase } from './reminders'
import { AlarmsService, PREPARE_MS, type AlarmsDeps } from './service'
import { isQuickAddUrl } from './windows'

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
    expect(cleanAlarmsSetting(ALARMS_SNOOZED_KEY, [])).toBeUndefined()
    expect(cleanAlarmsSetting(ALARMS_SETTING.eventLead, 10)).toBe(10)
    expect(cleanAlarmsSetting(ALARMS_SETTING.eventLead, 7)).toBeUndefined()
    expect(cleanAlarmsSetting(ALARMS_SETTING.askRecord, 'all')).toBe('all')
    expect(cleanAlarmsSetting(ALARMS_SETTING.askRecord, 'always')).toBeUndefined()
    expect(readAlarmSettings(() => null)).toMatchObject({ events: true, eventLead: 5, askRecord: 'meetings', tray: false })
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

function harness(
  settings: Record<string, unknown>,
  options: { now: number; rows?: Block[]; recording?: boolean; write?: AlarmsDeps['writeBriefing']; events?: BriefingEvent[]; locale?: 'en' | 'pt-BR' }
) {
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
    ...(options.events ? { calendar: async (from: number, to: number) => options.events!.filter((e) => e.end > from && e.start < to) } : {}),
    locale: () => options.locale ?? 'en',
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

// ---- the calendar's events ----

const ev = (id: string, start: number, extra: Partial<BriefingEvent> = {}): BriefingEvent => ({
  id: `cal:${id}:${start}`,
  calendarId: 'cal',
  uid: id,
  title: id,
  start,
  end: start + 30 * MIN,
  allDay: false,
  recurring: false,
  ...extra
})

describe('event alarms', () => {
  const ten = local(2026, 10, 15, 10, 0)

  it('ring each timed event its lead before it starts', () => {
    const alarms = eventAlarmsOf([ev('Standup', ten), ev('Lunch', ten + 120 * MIN)], 5)
    expect(alarms.map((a) => [a.event.title, a.at])).toEqual([
      ['Standup', ten - 5 * MIN],
      ['Lunch', ten + 115 * MIN]
    ])
    expect(eventAlarmsOf([ev('Standup', ten)], 0)[0].at).toBe(ten)
    expect(eventAlarmsOf([ev('Standup', ten)], 15)[0].at).toBe(ten - 15 * MIN)
    expect(nextEventAlarmAt(alarms, ten - 10 * MIN)).toBe(ten - 5 * MIN)
    expect(nextEventAlarmAt(alarms, ten)).toBe(ten + 115 * MIN)
    // A key short enough for the record, the same for the same occurrence.
    expect(alarms[0].key).toMatch(/^e:[0-9a-z]{2,14}$/)
    expect(eventAlarmsOf([ev('Standup', ten, { id: 'x'.repeat(500) })], 5)[0].key.length).toBeLessThanOrEqual(16)
  })

  it('leave out all-day events, those shown as free, and those declined', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'X-WR-CALNAME:me@example.com',
      'BEGIN:VEVENT',
      'UID:review',
      'SUMMARY:Review',
      'DTSTART:20261015T130000Z',
      'DTEND:20261015T140000Z',
      'ATTENDEE:mailto:ana@example.com',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:holiday',
      'SUMMARY:Holiday',
      'DTSTART;VALUE=DATE:20261015',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:focus',
      'SUMMARY:Focus time',
      'DTSTART:20261015T150000Z',
      'DTEND:20261015T160000Z',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:declined',
      'SUMMARY:Declined',
      'DTSTART:20261015T170000Z',
      'DTEND:20261015T180000Z',
      'ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const occurrences = expandCalendar(parseCalendar(text), { from: local(2026, 10, 15), to: local(2026, 10, 16) }, { calendarId: 'cal' })
    expect(occurrences.map((o) => o.title).sort()).toEqual(['Focus time', 'Holiday', 'Review'])
    const alarms = eventAlarmsOf(occurrences, 5)
    expect(alarms.map((a) => [a.event.title, a.meeting])).toEqual([['Review', true]])
  })

  it('are due within their grace period, once, and not once the event is over', () => {
    const alarms = eventAlarmsOf([ev('Standup', ten, { end: ten + 10 * MIN })], 5)
    expect(dueEventAlarms(alarms, {}, ten - 6 * MIN)).toEqual([])
    expect(dueEventAlarms(alarms, {}, ten - 5 * MIN).length).toBe(1)
    expect(dueEventAlarms(alarms, { [alarms[0].key]: ten - 5 * MIN }, ten - 4 * MIN)).toEqual([])
    expect(dueEventAlarms(alarms, {}, ten + 9 * MIN).length).toBe(1)
    expect(dueEventAlarms(alarms, {}, ten + 16 * MIN)).toEqual([])
  })

  it('say how soon, in his two languages', () => {
    expect(composeEvents([{ title: 'Standup', start: ten, meeting: true }], ten - 5 * MIN, 'pt-BR')).toEqual({
      title: 'Reunião em 5 min',
      text: 'Reunião em 5 min: Standup.',
      speech: 'Reunião em 5 minutos: Standup.'
    })
    expect(composeEvents([{ title: 'Dentist', start: ten, meeting: false }], ten - 10 * MIN, 'en').text).toBe('In 10 min: Dentist.')
    expect(composeEvents([{ title: 'Standup', start: ten, meeting: true }], ten, 'en').text).toBe('Meeting now: Standup.')
    expect(composeEvents([{ title: 'Standup', start: ten, meeting: true }], ten + 3 * MIN, 'pt-BR').text).toBe('Começou há 3 min: Standup.')
    expect(composeEvents([{ title: 'A', start: ten, meeting: true }, { title: 'B', start: ten, meeting: false }], ten - 5 * MIN, 'en').text).toBe('Meeting in 5 min: A. Also: B.')
  })

  it('ask to record a meeting, or every event, or none', () => {
    expect(asksToRecord('meetings', true)).toBe(true)
    expect(asksToRecord('meetings', false)).toBe(false)
    expect(asksToRecord('all', false)).toBe(true)
    expect(asksToRecord('never', true)).toBe(false)
  })

  it('read back what was snoozed, and drop what is malformed or long past', () => {
    const now = ten
    const entry = snoozeOf({ kind: 'event', events: [{ id: 'cal:a:1', title: 'A', start: ten, end: ten + MIN, meeting: true, ask: true }] }, now)
    expect(entry.at).toBe(now + SNOOZE_MS)
    expect(readSnoozed([entry, { kind: 'event', at: now, events: [{ title: 'no id' }] }, { kind: 'other', at: now }, 'junk'], now)).toEqual([entry])
    expect(readSnoozed([entry], now + SNOOZE_MS + 16 * MIN)).toEqual([])
    expect(readSnoozed('junk', now)).toEqual([])
  })
})

describe('the clock and the calendar', () => {
  const ten = local(2026, 10, 15, 10, 0)

  it('announces an event its lead before, as a meeting that asks to be recorded', async () => {
    const h = harness({}, { now: ten - 30 * MIN, events: [ev('Standup', ten, { attendees: 3, meetingUrl: 'https://meet.google.com/abc-defg-hij' })], locale: 'pt-BR' })
    h.service.plan()
    await h.advance(ten - 6 * MIN)
    expect(h.said).toEqual([])
    await h.advance(ten - 5 * MIN)
    expect(h.said.length).toBe(1)
    expect(h.said[0]).toMatchObject({
      kind: 'event',
      title: 'Reunião em 5 min',
      text: 'Reunião em 5 min: Standup.',
      snooze: true,
      at: ten - 5 * MIN,
      event: { uid: 'Standup', title: 'Standup', start: ten, meeting: true, ask: true, meetingUrl: 'https://meet.google.com/abc-defg-hij' }
    })
    await h.advance(ten + 20 * MIN)
    expect(h.said.length).toBe(1)
  })

  it('follows the lead and the question in the settings', async () => {
    const settings = { [ALARMS_SETTING.eventLead]: 15, [ALARMS_SETTING.askRecord]: 'never' }
    const h = harness(settings, { now: ten - 30 * MIN, events: [ev('Standup', ten, { attendees: 1 })] })
    h.service.plan()
    await h.advance(ten - 15 * MIN)
    expect(h.said.map((a) => [a.text, a.event?.ask])).toEqual([['Meeting in 15 min: Standup.', false]])
  })

  it('offers a plain event to record only when asked for every event', async () => {
    const h = harness({ [ALARMS_SETTING.askRecord]: 'all' }, { now: ten - 30 * MIN, events: [ev('Dentist', ten)] })
    h.service.plan()
    await h.advance(ten - 5 * MIN)
    expect(h.said[0]).toMatchObject({ text: 'In 5 min: Dentist.', event: { meeting: false, ask: true } })
    const quiet = harness({}, { now: ten - 30 * MIN, events: [ev('Dentist', ten)] })
    quiet.service.plan()
    await quiet.advance(ten - 5 * MIN)
    expect(quiet.said[0].event?.ask).toBe(false)
  })

  it('stays silent with events off, and for all-day and free events', async () => {
    const off = harness({ [ALARMS_SETTING.events]: false }, { now: ten - 30 * MIN, events: [ev('Standup', ten)] })
    off.service.plan()
    await off.advance(ten + 5 * MIN)
    expect(off.said).toEqual([])
    const skipped = harness({}, { now: ten - 30 * MIN, events: [ev('Holiday', local(2026, 10, 15), { allDay: true, end: local(2026, 10, 16) }), ev('Focus', ten, { transparent: true })] })
    skipped.service.plan()
    await skipped.advance(ten + 5 * MIN)
    expect(skipped.said).toEqual([])
  })

  it('waits while a meeting is recorded, then still announces the event', async () => {
    const h = harness({}, { now: ten - 30 * MIN, events: [ev('Standup', ten)], recording: true })
    h.service.plan()
    await h.advance(ten - 2 * MIN)
    expect(h.said).toEqual([])
    h.setRecording(false)
    await h.advance(ten)
    expect(h.said.length).toBe(1)
    // Tried again a minute after the recording ended: it says how soon it is then.
    expect(h.said[0].text).toBe('In 1 min: Standup.')
  })

  it('snoozes an event ten minutes, and says it again then, also after a restart', async () => {
    const h = harness({}, { now: ten - 30 * MIN, events: [ev('Standup', ten, { end: ten + 60 * MIN, attendees: 2 })] })
    h.service.plan()
    await h.advance(ten - 5 * MIN)
    const first = h.said[0]
    h.service.snooze(first.id)
    expect(h.store.get(ALARMS_SNOOZED_KEY)).toMatchObject([{ kind: 'event', at: ten + 5 * MIN }])
    // Snoozing twice, or something that cannot be, does nothing more.
    h.service.snooze(first.id)
    h.service.snooze('unknown')
    await h.advance(ten + 4 * MIN)
    expect(h.said.length).toBe(1)
    await h.advance(ten + 5 * MIN)
    expect(h.said.length).toBe(2)
    expect(h.said[1]).toMatchObject({ kind: 'event', text: 'Started 5 min ago: Standup.', at: ten + 5 * MIN, event: { ask: true } })
    expect(h.store.get(ALARMS_SNOOZED_KEY)).toBeNull()
  })

  it('snoozes a reminder, and nothing rings while recording', async () => {
    const rows = [row('Call the bank', { 'tasks.due': { start: '2026-10-15T10:00' } })]
    const h = harness({}, { now: ten - MIN, rows })
    h.service.plan()
    await h.advance(ten)
    expect(h.said[0]).toMatchObject({ kind: 'reminder', title: 'Reminder', snooze: true })
    h.service.snooze(h.said[0].id)
    h.setRecording(true)
    await h.advance(ten + 12 * MIN)
    expect(h.said.length).toBe(1)
    h.setRecording(false)
    await h.advance(ten + 13 * MIN)
    expect(h.said.length).toBe(2)
    expect(h.said[1]).toMatchObject({ kind: 'reminder', text: 'Call the bank: it is 10:00 AM, the time you gave it.', pageId: 'Call the bank', at: ten + 10 * MIN })
  })

  it('does not snooze a briefing', async () => {
    const h = harness({}, { now: ten })
    await h.service.test()
    expect(h.said[0].snooze).toBeUndefined()
    h.service.snooze(h.said[0].id)
    expect(h.store.get(ALARMS_SNOOZED_KEY)).toBeUndefined()
  })
})

describe('the windows that speak', () => {
  it('leave out the quick-add window', () => {
    expect(isQuickAddUrl('file:///C:/sel/out/renderer/index.html?quickadd=1')).toBe(true)
    expect(isQuickAddUrl('http://localhost:5173/?quickadd=1')).toBe(true)
    expect(isQuickAddUrl('file:///C:/sel/out/renderer/index.html')).toBe(false)
    expect(isQuickAddUrl('file:///C:/sel/out/renderer/index.html?quickadd=0')).toBe(false)
    expect(isQuickAddUrl('')).toBe(false)
  })
})
