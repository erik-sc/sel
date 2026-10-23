/**
 * The weekly word about the rhythm (D4): what is noticed in the log's aggregates, how it is said in
 * both languages, and the rule of one look a week, off unless turned on.
 */
import { describe, expect, it } from 'vitest'
import { ACTIVITY_RHYTHM_KEY, ACTIVITY_RHYTHM_SAID_KEY, type ActivityKind, type ActivityRow } from '../../shared/activity'
import {
  observe,
  partOf,
  partsOf,
  readSaid,
  type RhythmContext,
  type RhythmFacts,
  rhythmDue,
  rhythmFacts,
  rhythmText,
  tidyProject,
  weeklyRhythm
} from './rhythm'

const empty = (): number[][] => Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
const grid = (cells: [weekday: number, hour: number, count: number][]): number[][] => {
  const out = empty()
  for (const [weekday, hour, count] of cells) out[weekday][hour] += count
  return out
}
const facts = (extra: Partial<RhythmFacts> = {}): RhythmFacts => ({
  writing: empty(),
  done: empty(),
  focus: empty(),
  project: null,
  weeks: 6,
  ...extra
})

/** Tuesday mornings full of writing, a little everywhere else. */
const tuesdayMornings = grid([
  [2, 9, 20],
  [2, 10, 15],
  [1, 15, 3],
  [3, 15, 3],
  [4, 20, 3]
])

describe('what is noticed', () => {
  it('splits the day in mornings, afternoons and evenings, and leaves the night out', () => {
    expect([partOf(6), partOf(11), partOf(12), partOf(18), partOf(22), partOf(23), partOf(3)]).toEqual([
      'morning',
      'morning',
      'afternoon',
      'evening',
      'evening',
      null,
      null
    ])
    expect(partsOf(tuesdayMornings)[2]).toEqual([35, 0, 0])
  })

  it('finds the weekday and part of the day where the writing gathers', () => {
    expect(observe(facts({ writing: tuesdayMornings }))).toEqual({ kind: 'writing', weekday: 2, part: 'morning' })
  })

  it('says nothing of writing spread evenly, or too thin to be a rhythm', () => {
    const even = empty()
    for (let weekday = 0; weekday < 7; weekday++) for (const hour of [9, 14, 20]) even[weekday][hour] = 3
    expect(observe(facts({ writing: even }))).toBeNull()
    expect(observe(facts({ writing: grid([[2, 9, 8]]) }))).toBeNull()
  })

  it('finds the part of the day when most tasks get done', () => {
    const done = grid([
      [1, 15, 4],
      [2, 14, 4],
      [3, 9, 2],
      [4, 16, 2]
    ])
    expect(observe(facts({ done }))).toEqual({ kind: 'done', part: 'afternoon' })
    // Spread over the day: nothing to say.
    expect(
      observe(
        facts({
          done: grid([
            [1, 9, 4],
            [2, 14, 4],
            [3, 20, 4]
          ])
        })
      )
    ).toBeNull()
  })

  it('finds the weekday focus gathers on', () => {
    const focus = grid([
      [4, 9, 4],
      [4, 14, 2],
      [1, 10, 1]
    ])
    expect(observe(facts({ focus }))).toEqual({ kind: 'focus', weekday: 4 })
  })

  it('waits for two weeks of history', () => {
    expect(observe(facts({ writing: tuesdayMornings, weeks: 1 }))).toBeNull()
  })

  it('takes turns: what was said last week is tried last', () => {
    const focus = grid([[4, 9, 7]])
    const both = facts({ writing: tuesdayMornings, focus })
    expect(observe(both)?.kind).toBe('writing')
    expect(observe(both, 'writing')?.kind).toBe('focus')
    expect(observe(both, 'focus')?.kind).toBe('writing')
  })
})

describe('how it is said', () => {
  it('in English and in Portuguese, with or without a project, with no number and no judgement', () => {
    const writing = { kind: 'writing', weekday: 2, part: 'morning' } as const
    expect(rhythmText(writing, 'Thesis', 'en')).toBe(
      'Your Tuesday mornings seem to be when the writing happens. Want to keep the next one for Thesis?'
    )
    expect(rhythmText(writing, 'Tese', 'pt-BR')).toBe('Suas manhãs de terça rendem para escrever. Quer guardar a próxima para Tese?')
    expect(rhythmText(writing, null, 'pt-BR')).toBe('Suas manhãs de terça rendem para escrever. Vale deixar a próxima livre?')
    expect(rhythmText({ kind: 'focus', weekday: 6 }, 'Casa', 'pt-BR')).toBe(
      'Seus focos costumam se juntar aos sábados. Quer guardar o próximo para Casa?'
    )
    expect(rhythmText({ kind: 'done', part: 'evening' }, null, 'pt-BR')).toBe(
      'Quase tudo o que você conclui, conclui à noite. Talvez seja o trecho do dia para proteger.'
    )
    for (const locale of ['en', 'pt-BR'] as const)
      for (const observation of [
        writing,
        { kind: 'done', part: 'afternoon' } as const,
        { kind: 'focus', weekday: 0 } as const,
        { kind: 'writing', weekday: 6, part: 'evening' } as const
      ])
        for (const project of [null, 'Work']) {
          const text = rhythmText(observation, project, locale)
          expect(text.length).toBeLessThanOrEqual(120)
          expect(text).not.toMatch(/\d|!|Herman|Hermine|streak|record|sequência|recorde/i)
        }
  })

  it('keeps a project name to one short line', () => {
    expect(tidyProject('  "Big"\nproject  ')).toBe('Big project')
    expect(tidyProject('x'.repeat(60))).toHaveLength(40)
    expect(tidyProject('  ')).toBeNull()
  })
})

const MIN = 60_000
const DAY = 24 * 60 * MIN
/** Local times, so that the expectations hold in any time zone. Oct 2026: the 20th is a Tuesday. */
const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime()
const row = (time: number, kind: ActivityKind, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  at: time,
  kind,
  area: null,
  pageId: null,
  project: null,
  count: 1,
  minutes: null,
  ...extra
})

/** Five weeks of Tuesday-morning writing, and tasks of one project. */
function history(): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (let week = 0; week < 5; week++) {
    const tuesday = at(20, 9) - week * 7 * DAY
    for (let minute = 0; minute < 10; minute++) rows.push(row(tuesday + minute * MIN, 'edit'))
    rows.push(row(tuesday + 2 * DAY + 6 * 60 * MIN, 'edit'))
    rows.push(row(tuesday + DAY, 'task.created', { project: 'p1' }))
  }
  return rows.sort((a, b) => a.at - b.at)
}

function context(settings: Record<string, unknown>, now: number, extra: Partial<RhythmContext> = {}): RhythmContext {
  const rows = history()
  return {
    getSetting: (key) => settings[key] ?? null,
    setSetting: (key, value) => {
      settings[key] = value
    },
    logEnabled: () => true,
    rows: (from, to) => rows.filter((r) => r.at >= from && r.at < to),
    oldest: () => rows[0].at,
    projectName: (id) => (id === 'p1' ? 'Thesis' : null),
    now,
    locale: 'en',
    ...extra
  }
}

describe('the weekly word', () => {
  it('reads the grids and the busiest project from the rows', () => {
    const now = at(22, 12)
    const read = rhythmFacts(history(), history()[0].at, now, (id) => (id === 'p1' ? 'Thesis' : null))
    expect(read.writing[2][9]).toBe(50)
    expect(read.project).toBe('Thesis')
    expect(read.weeks).toBe(4)
  })

  it('is off unless turned on, and quiet while the log is off', () => {
    expect(weeklyRhythm(context({}, at(22, 12)))).toBeNull()
    expect(weeklyRhythm(context({ [ACTIVITY_RHYTHM_KEY]: true }, at(22, 12), { logEnabled: () => false }))).toBeNull()
  })

  it('is said once a week, with a way to the flows, and the week is remembered', () => {
    const settings: Record<string, unknown> = { [ACTIVITY_RHYTHM_KEY]: true }
    const line = weeklyRhythm(context(settings, at(22, 12)))
    expect(line).toEqual({
      kind: 'writing',
      text: 'Your Tuesday mornings seem to be when the writing happens. Want to keep the next one for Thesis?',
      action: { label: 'See flows', command: { type: 'open-flows' } }
    })
    expect(settings[ACTIVITY_RHYTHM_SAID_KEY]).toEqual({ week: '2026-10-19', kind: 'writing' })
    // The same week, even on Sunday night: nothing more.
    expect(weeklyRhythm(context(settings, at(25, 20)))).toBeNull()
    // The next week, again; and not the same remark when another one is there to make.
    const next = weeklyRhythm(context(settings, at(27, 12), { locale: 'pt-BR' }))
    expect(next?.text).toMatch(/^Suas manhãs de terça|^Quase tudo/)
  })

  it('marks a week with nothing to say, so the log is read once a week', () => {
    const settings: Record<string, unknown> = { [ACTIVITY_RHYTHM_KEY]: true }
    let reads = 0
    const quiet = context(settings, at(22, 12), {
      rows: () => {
        reads++
        return []
      }
    })
    expect(weeklyRhythm(quiet)).toBeNull()
    expect(weeklyRhythm(quiet)).toBeNull()
    expect(reads).toBe(1)
    expect(readSaid(settings[ACTIVITY_RHYTHM_SAID_KEY])).toEqual({ week: '2026-10-19', kind: null })
  })

  it('reads what it remembers with care', () => {
    expect(readSaid(null)).toBeNull()
    expect(readSaid({ week: 'soon' })).toBeNull()
    expect(readSaid({ week: '2026-10-19', kind: 'boasting' })).toEqual({ week: '2026-10-19', kind: null })
    expect(rhythmDue(null, at(22, 12))).toBe(true)
    expect(rhythmDue({ week: '2026-10-19', kind: null }, at(25, 23))).toBe(false)
    expect(rhythmDue({ week: '2026-10-19', kind: null }, at(26, 0, 1))).toBe(true)
  })
})
