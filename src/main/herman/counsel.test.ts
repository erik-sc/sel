/**
 * Herman's counsel without AI: which line he chooses from the state of the day, and the bank
 * of lines itself. Pure: a fixed clock and fixed dice.
 */
import { describe, expect, it } from 'vitest'
import { HERMAN_NUDGE_KINDS, type HermanLocale, type HermanNudgeKind } from '../../shared/herman'
import { compose, COUNSEL_DEFAULTS, ONCE_A_DAY, tidyTitle, TITLE_CHARS, type CounselInput } from './counsel'
import { agoWords, capitalize, LINES, numberWord, PHRASES, sinceWords, spanWords, type Words } from './lines'

const MIN = 60_000
/** A local time on Wednesday 14 October 2026. */
const at = (hour: number, minute = 0): number => new Date(2026, 9, 14, hour, minute).getTime()
const first = (): number => 0
const base = (patch: Partial<CounselInput> = {}): CounselInput => ({
  now: at(10),
  locale: 'en',
  tasks: { overdue: [], today: [] },
  events: [],
  random: first,
  ...patch
})
const task = (title: string, due?: string, pageId = 'page-1'): { title: string; pageId: string; due?: string } => ({
  title,
  pageId,
  ...(due ? { due } : {})
})
const event = (title: string, start: number, minutes = 30): { title: string; start: number; end: number; allDay: boolean } => ({
  title,
  start,
  end: start + minutes * MIN,
  allDay: false
})

describe('the Inbox', () => {
  it('says when tasks have sat in the Inbox for days, and offers to refine them', () => {
    const counsel = compose(base({ inbox: { waiting: 3, title: 'Buy bread', days: 3 } }))
    expect(counsel).toMatchObject({ kind: 'inbox', variant: 'inbox:0' })
    // Wednesday 14 October: three days back is a Sunday.
    expect(counsel?.text).toBe('Three things have waited in the Inbox since Sunday. A minute to sort them?')
    expect(counsel?.action).toEqual({ label: 'Refine now', command: { type: 'refine-inbox' } })
    const pt = compose(base({ locale: 'pt-BR', inbox: { waiting: 1, title: 'Comprar pão', days: 2 } }))
    expect(pt?.text).toBe('Uma coisa espera no Inbox desde segunda. Um minuto para pontuar?')
    expect(pt?.action).toEqual({ label: 'Refinar agora', command: { type: 'refine-inbox' } })
  })

  it('has nothing to say of an Inbox with nothing waiting, or when told not to', () => {
    expect(compose(base({ inbox: { waiting: 0, title: '', days: 0 } }))).toBeNull()
    expect(compose(base({ inbox: null }))).toBeNull()
  })

  it('comes after everything more timely', () => {
    const both = base({ tasks: { overdue: [task('Old', '2026-10-01')], today: [] }, inbox: { waiting: 1, title: 'Buy bread', days: 2 } })
    expect(compose(both)?.kind).toBe('overdue')
    expect(compose({ ...both, saidToday: ['overdue'] })?.kind).toBe('inbox')
  })
})

describe('what he notices', () => {
  it('says nothing when there is nothing to say', () => {
    expect(compose(base())).toBeNull()
    expect(compose(base({ now: at(14), editingMs: 10 * MIN, streak: 2, reopened: { pageId: 'p', days: 3 } }))).toBeNull()
  })

  it('remarks on what is overdue, counting it and naming how long the oldest has waited', () => {
    const counsel = compose(
      base({
        tasks: {
          overdue: [
            task('Send the invoice', '2026-10-12'),
            task('Call the bank', '2026-10-08', 'page-2'),
            task('Renew the domain', '2026-10-13')
          ],
          today: [task('Other')]
        }
      })
    )
    expect(counsel).toMatchObject({ kind: 'overdue', variant: 'overdue:0' })
    // The owner's own example, word for word: three things, since Thursday.
    expect(counsel?.text).toBe('Three things have been waiting since Thursday. Which one is actually yours to do?')
    expect(counsel?.action).toEqual({ label: 'Open Today', command: { type: 'open-today' } })
  })

  it('names the oldest task in a line that has a title, and offers to open it', () => {
    const input = base({
      tasks: { overdue: [task('Send the invoice', '2026-10-13'), task('Call the bank', '2026-10-01', 'page-2')], today: [] },
      recent: ['overdue:0', 'overdue:1']
    })
    const counsel = compose(input)
    expect(counsel?.variant).toBe('overdue:2')
    expect(counsel?.text).toBe('“Call the bank” has waited since last week. Do it, or drop it.')
    expect(counsel?.action).toEqual({ label: 'Open it', command: { type: 'open-page', pageId: 'page-2' } })
  })

  it('speaks of today only when nothing is overdue', () => {
    const today = [task('Write the review'), task('Water the plants')]
    expect(compose(base({ tasks: { overdue: [], today } }))).toMatchObject({ kind: 'today', text: 'Two for today. Which one first?' })
    expect(compose(base({ tasks: { overdue: [task('Old', '2026-10-01')], today } }))?.kind).toBe('overdue')
    expect(compose(base({ tasks: { overdue: [], today: [task('Only one')] } }))?.text).toBe('One for today. When will you do it?')
  })

  it('leaves an event about to start to the alarms', () => {
    // The alarms announce it, and offer to record a meeting: he would only say it twice.
    expect(compose(base({ events: [event('Standup', at(10, 10))] }))).toBeNull()
  })

  it('finds a free stretch on a day that has a calendar', () => {
    const counsel = compose(base({ now: at(13), events: [event('Standup', at(9)), event('Review', at(15))] }))
    expect(counsel).toMatchObject({ kind: 'free-block', variant: 'free-block:0' })
    expect(counsel?.text).toMatch(/^Nothing scheduled until 3:00\sPM\. What deserves it\?$/)
    expect(counsel?.action).toEqual({ label: 'Ask Herman', command: { type: 'ask', question: 'What should I do first today?' } })
    expect(compose(base({ now: at(13), events: [event('Standup', at(9)), event('Review', at(15))], recent: ['free-block:0'] }))?.text).toBe(
      'Two hours free. Give it to deep work.'
    )
    // Nothing left today: the rest of the working day is free.
    expect(compose(base({ now: at(13), events: [event('Standup', at(9))] }))?.text).toBe(
      'Nothing scheduled for the rest of the day. What deserves it?'
    )
    // Not without a calendar, not in the middle of a meeting, not for a short gap.
    expect(compose(base({ now: at(13) }))).toBeNull()
    expect(compose(base({ now: at(13), events: [event('Workshop', at(12), 120)] }))).toBeNull()
    expect(compose(base({ now: at(13), events: [event('Standup', at(9)), event('Review', at(14))] }))).toBeNull()
  })

  it('notices a long sitting, a page opened after a long time, and a streak', () => {
    expect(compose(base({ now: at(14), editingMs: 52 * MIN }))).toMatchObject({ kind: 'long-session', text: 'Fifty minutes. Stand up.' })
    expect(compose(base({ now: at(14), editingMs: 52 * MIN }))?.action).toBeUndefined()
    expect(compose(base({ now: at(14), editingMs: 49 * MIN }))).toBeNull()
    const reopened = compose(base({ now: at(14), reopened: { pageId: 'old', days: 61 } }))
    expect(reopened).toMatchObject({ kind: 'reopened', text: 'Untouched for two months. Still true?' })
    expect(reopened?.action).toEqual({ label: 'Ask Herman', command: { type: 'ask', question: 'What is this page really about?' } })
    expect(compose(base({ now: at(14), reopened: { pageId: 'old', days: 29 } }))).toBeNull()
    expect(compose(base({ now: at(14), streak: 3 }))).toMatchObject({ kind: 'streak', text: 'Three done. Notice how that feels.' })
  })

  it('greets the first start of the day in the morning, and closes the day in the evening', () => {
    expect(compose(base({ now: at(8, 30), firstLaunch: true }))).toMatchObject({ kind: 'morning', text: 'Morning. What is the one thing?' })
    expect(compose(base({ now: at(8, 30), firstLaunch: false }))).toBeNull()
    expect(compose(base({ now: at(13), firstLaunch: true }))).toBeNull()
    expect(compose(base({ now: at(4, 30), firstLaunch: true }))).toBeNull()
    const evening = compose(base({ now: at(18) }))
    expect(evening).toMatchObject({ kind: 'evening', text: 'Enough for today. What is worth keeping?' })
    expect(evening?.action).toEqual({ label: 'Close the day', command: { type: 'close-day' } })
    expect(compose(base({ now: at(17, 29) }))).toBeNull()
    expect(compose(base({ now: at(22) }))).toBeNull()
  })

  it('puts the most timely thing first when several apply', () => {
    const everything = base({
      now: at(9),
      firstLaunch: true,
      streak: 3,
      editingMs: 60 * MIN,
      reopened: { pageId: 'old', days: 90 },
      tasks: { overdue: [task('Old', '2026-10-01')], today: [] },
      events: [event('Standup', at(9, 10))],
      inbox: { waiting: 2, title: 'Buy bread', days: 3 }
    })
    const order: HermanNudgeKind[] = []
    let last: HermanNudgeKind | null = null
    const said: HermanNudgeKind[] = []
    for (let round = 0; round < 7; round++) {
      // Each kind once: what was said is left out of the next round, as if its cause had passed.
      const counsel = compose({ ...everything, lastKind: last, only: HERMAN_NUDGE_KINDS.filter((kind) => !said.includes(kind)) })
      if (!counsel) break
      order.push(counsel.kind)
      said.push(counsel.kind)
      last = counsel.kind
    }
    expect(order).toEqual(['streak', 'long-session', 'reopened', 'morning', 'overdue', 'inbox'])
    expect(HERMAN_NUDGE_KINDS).toEqual([
      'streak',
      'long-session',
      'reopened',
      'morning',
      'evening',
      'free-block',
      'overdue',
      'today',
      'inbox'
    ])
  })
})

describe('his restraint in what he says', () => {
  const overdue = { overdue: [task('Old', '2026-10-01')], today: [] }

  it('never speaks of the same kind twice in a row', () => {
    expect(compose(base({ tasks: overdue, lastKind: 'overdue' }))).toBeNull()
    expect(compose(base({ now: at(14), editingMs: 60 * MIN, tasks: overdue, lastKind: 'long-session' }))?.kind).toBe('overdue')
    expect(compose(base({ now: at(14), editingMs: 60 * MIN, tasks: overdue, lastKind: 'overdue' }))?.kind).toBe('long-session')
  })

  it('says the things that last all day once a day', () => {
    expect([...ONCE_A_DAY].sort()).toEqual(['evening', 'free-block', 'inbox', 'morning', 'overdue', 'today'])
    expect(compose(base({ inbox: { waiting: 1, title: 'Buy bread', days: 2 }, saidToday: ['inbox'] }))).toBeNull()
    expect(compose(base({ tasks: overdue, saidToday: ['overdue'] }))).toBeNull()
    expect(compose(base({ now: at(18), saidToday: ['evening'] }))).toBeNull()
    expect(compose(base({ now: at(8), firstLaunch: true, saidToday: ['morning'] }))).toBeNull()
    // A long sitting can come up again later the same day.
    expect(compose(base({ now: at(14), editingMs: 60 * MIN, saidToday: ['long-session'] }))?.kind).toBe('long-session')
  })

  it('passes over a kind the user asked to see less of, as often as its weight says', () => {
    const dice = (...values: number[]): (() => number) => {
      let index = 0
      return () => values[Math.min(index++, values.length - 1)]
    }
    // Weight 0.5: a roll under it lets the kind through, a roll at or over it does not.
    expect(compose(base({ tasks: overdue, weights: { overdue: 0.5 }, random: dice(0.49, 0) }))?.kind).toBe('overdue')
    expect(compose(base({ tasks: overdue, weights: { overdue: 0.5 }, random: dice(0.5, 0) }))).toBeNull()
    // Passed over, the next kind in line gets its turn.
    expect(
      compose(base({ now: at(14), editingMs: 60 * MIN, tasks: overdue, weights: { 'long-session': 0.125 }, random: dice(0.9, 0) }))?.kind
    ).toBe('overdue')
    // No weight, or a full one, costs no roll at all.
    expect(compose(base({ tasks: overdue, weights: { overdue: 1 }, random: dice(0.99) }))?.kind).toBe('overdue')
    let hits = 0
    let seed = 7
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let round = 0; round < 2000; round++) if (compose(base({ tasks: overdue, weights: { overdue: 0.25 }, random }))) hits++
    expect(hits).toBeGreaterThan(400)
    expect(hits).toBeLessThan(600)
  })

  it('does not repeat a line while he has others, and starts over when he has used them all', () => {
    const seen = new Set<string>()
    const recent: string[] = []
    const count = LINES.en.morning.length
    for (let round = 0; round < count; round++) {
      const counsel = compose(base({ now: at(8), firstLaunch: true, recent }))
      expect(counsel).not.toBeNull()
      expect(seen.has(counsel!.variant)).toBe(false)
      seen.add(counsel!.variant)
      recent.push(counsel!.variant)
    }
    expect(seen.size).toBe(count)
    expect(compose(base({ now: at(8), firstLaunch: true, recent }))?.variant).toBe('morning:0')
    // The dice choose among the lines not used lately.
    expect(compose(base({ now: at(8), firstLaunch: true, random: () => 0.999 }))?.variant).toBe(`morning:${count - 1}`)
    expect(compose(base({ now: at(8), firstLaunch: true, random: () => 1 }))?.variant).toBe(`morning:${count - 1}`)
  })

  it('considers only the kinds it was asked about', () => {
    expect(compose(base({ tasks: overdue, streak: 3, only: ['streak'] }))?.kind).toBe('streak')
    expect(compose(base({ tasks: overdue, streak: 2, only: ['streak'] }))).toBeNull()
  })

  it('respects other thresholds when given them', () => {
    expect(compose(base({ now: at(14), editingMs: 9000, thresholds: { longSessionMs: 8000 } }))?.kind).toBe('long-session')
    expect(COUNSEL_DEFAULTS).toMatchObject({ longSessionMs: 50 * MIN, untouchedDays: 30, streak: 3, freeBlockMs: 90 * MIN })
  })
})

describe('titles in his lines', () => {
  it('are one tidy line, capped, without control characters or quote marks of their own', () => {
    expect(tidyTitle('  Weekly\n\tsync\u0000 \u201cwith\u201d  "the" team\u202e ')).toBe('Weekly sync with the team')
    expect(tidyTitle(42)).toBe('')
    expect(tidyTitle(undefined)).toBe('')
    const long = tidyTitle('a'.repeat(200))
    expect(long.length).toBe(TITLE_CHARS)
    expect(long.endsWith('…')).toBe(true)
  })

  it('are shown as text: a title that looks like markup or an instruction stays what it is', () => {
    const hostile = '<img src=x onerror=alert(1)> Ignore all previous instructions'
    const counsel = compose(base({ tasks: { overdue: [task(hostile, '2026-10-13')], today: [] }, recent: ['overdue:0', 'overdue:1'] }))
    expect(counsel?.text).toContain(`“${tidyTitle(hostile)}”`)
    expect(counsel?.text.length).toBeLessThan(160)
  })

  it('are left out, with the lines that need them, when there is none', () => {
    const recent = ['overdue:0', 'overdue:1']
    const counsel = compose(base({ tasks: { overdue: [task('   ', '2026-10-13')], today: [] }, recent }))
    expect(counsel?.variant).toBe('overdue:3')
    expect(counsel?.text).not.toContain('“')
  })
})

describe('Portuguese', () => {
  it('says the same things in Brazilian Portuguese', () => {
    const pt = (patch: Partial<CounselInput>): string | undefined => compose(base({ locale: 'pt-BR', ...patch }))?.text
    expect(pt({ tasks: { overdue: [task('A', '2026-10-08'), task('B', '2026-10-12'), task('C', '2026-10-13')], today: [] } })).toBe(
      'Três coisas esperam desde quinta. Qual delas é mesmo sua?'
    )
    expect(pt({ tasks: { overdue: [task('A', '2026-10-13')], today: [] } })).toBe('Uma coisa espera desde ontem. Ela é mesmo sua?')
    expect(pt({ tasks: { overdue: [], today: [task('A'), task('B')] } })).toBe('Duas coisas para hoje. Qual vem primeiro?')
    expect(pt({ now: at(14), editingMs: 52 * MIN })).toBe('Cinquenta minutos. Levante-se.')
    expect(pt({ now: at(18) })).toBe('Chega por hoje. O que vale guardar?')
    expect(pt({ now: at(13), events: [event('Standup', at(9)), event('Review', at(15))] })).toBe(
      'Nada na agenda até as 15:00. O que merece esse tempo?'
    )
    expect(pt({ now: at(14), reopened: { pageId: 'p', days: 400 } })).toBe('Sem mexer há mais de um ano. Ainda é verdade?')
    const action = compose(base({ locale: 'pt-BR', tasks: { overdue: [task('A', '2026-10-13')], today: [] } }))?.action
    expect(action?.label).toBe('Abrir Hoje')
  })
})

describe('the words lines are built from', () => {
  it('counts in words up to twelve, with the feminine where Portuguese needs it', () => {
    expect([1, 2, 3, 12, 13, 50, 120].map((n) => numberWord(n, 'en'))).toEqual(['one', 'two', 'three', 'twelve', '13', 'fifty', '120'])
    expect([1, 2, 3, 15, 50].map((n) => numberWord(n, 'pt-BR'))).toEqual(['um', 'dois', 'três', 'quinze', 'cinquenta'])
    expect([1, 2, 3].map((n) => numberWord(n, 'pt-BR', true))).toEqual(['uma', 'duas', 'três'])
    expect(capitalize('três')).toBe('Três')
    expect(capitalize('')).toBe('')
  })

  it('says how long something has waited', () => {
    const today = new Date(2026, 9, 14)
    expect([1, 2, 6, 7, 13, 14, 90].map((days) => sinceWords(days, today, 'en'))).toEqual([
      'since yesterday',
      'since Monday',
      'since Thursday',
      'since last week',
      'since last week',
      'for weeks',
      'for weeks'
    ])
    expect([1, 6, 10, 30].map((days) => sinceWords(days, today, 'pt-BR'))).toEqual([
      'desde ontem',
      'desde quinta',
      'desde a semana passada',
      'há semanas'
    ])
  })

  it('says how long a page went untouched, and how long a free stretch is', () => {
    expect([30, 44, 61, 300, 365, 400].map((days) => agoWords(days, 'en'))).toEqual([
      'a month',
      'a month',
      'two months',
      'ten months',
      'a year',
      'more than a year'
    ])
    expect([30, 61, 400].map((days) => agoWords(days, 'pt-BR'))).toEqual(['um mês', 'dois meses', 'mais de um ano'])
    expect([60, 90, 119, 120, 150, 240].map((minutes) => spanWords(minutes, 'en'))).toEqual([
      'an hour',
      'an hour and a half',
      'an hour and a half',
      'two hours',
      'two and a half hours',
      'four hours'
    ])
    expect([90, 120, 150].map((minutes) => spanWords(minutes, 'pt-BR'))).toEqual(['uma hora e meia', 'duas horas', 'duas horas e meia'])
  })
})

describe('the bank of lines', () => {
  const locales: HermanLocale[] = ['en', 'pt-BR']
  const sample = (locale: HermanLocale, one: boolean): Words => ({
    n: one ? numberWord(1, locale, true) : numberWord(3, locale, true),
    N: capitalize(one ? numberWord(1, locale, true) : numberWord(3, locale, true)),
    one,
    title: 'Send the invoice',
    since: sinceWords(3, new Date(2026, 9, 14), locale),
    minutes: numberWord(50, locale),
    Minutes: capitalize(numberWord(50, locale)),
    until: locale === 'en' ? 'until 3:00 PM' : 'até as 15:00',
    span: spanWords(120, locale),
    Span: capitalize(spanWords(120, locale)),
    ago: agoWords(61, locale),
    Ago: capitalize(agoWords(61, locale))
  })

  it('has eight to twelve lines for every kind, the same number in both languages', () => {
    for (const kind of HERMAN_NUDGE_KINDS) {
      expect(LINES.en[kind].length, kind).toBeGreaterThanOrEqual(8)
      expect(LINES.en[kind].length, kind).toBeLessThanOrEqual(12)
      expect(LINES['pt-BR'][kind].length, kind).toBe(LINES.en[kind].length)
      // A line names a title in one language exactly when it does in the other.
      expect(LINES['pt-BR'][kind].map((line) => !!line.title)).toEqual(LINES.en[kind].map((line) => !!line.title))
      // Every kind can speak without a title.
      expect(LINES.en[kind].some((line) => !line.title)).toBe(true)
    }
    expect(Object.keys(LINES.en).sort()).toEqual([...HERMAN_NUDGE_KINDS].sort())
  })

  it('calls the notebook by its name, Meditations / Meditações', () => {
    for (const locale of locales) {
      const texts = HERMAN_NUDGE_KINDS.flatMap((kind) => LINES[locale][kind].map((line) => line.text(sample(locale, false))))
      for (const text of texts) expect(text).not.toMatch(/notebook|caderno|tinta|\bink\b/i)
      expect(texts.some((text) => text.includes(locale === 'en' ? 'Meditations' : 'Meditações'))).toBe(true)
    }
  })

  it('holds short, finished sentences: no blanks left unfilled, no emoji, no exclamation, nothing quoted', () => {
    for (const locale of locales) {
      const seen = new Set<string>()
      for (const kind of HERMAN_NUDGE_KINDS) {
        for (const line of LINES[locale][kind]) {
          for (const one of [false, true]) {
            const text = line.text(sample(locale, one))
            const where = `${locale} ${kind}: ${text}`
            expect(text.length, where).toBeGreaterThan(20)
            expect(text.length, where).toBeLessThanOrEqual(90)
            expect(text, where).not.toMatch(/undefined|null|NaN|\$\{|\s{2,}|^\s|\s$/)
            expect(text, where).toMatch(/^[\p{Lu}“]/u)
            expect(text, where).toMatch(/[.?]$/)
            expect(text, where).not.toMatch(/!|\p{Extended_Pictographic}/u)
            // The only quotation marks are the ones around a title of the user's own.
            expect(text.replace('“Send the invoice”', ''), where).not.toMatch(/["“”«»]/)
            expect(!!line.title, where).toBe(text.includes('Send the invoice'))
            if (!one) {
              expect(seen.has(text), `said twice: ${where}`).toBe(false)
              seen.add(text)
            }
          }
        }
      }
    }
  })

  it('never puts English into a Portuguese line, or the reverse', () => {
    for (const kind of HERMAN_NUDGE_KINDS) {
      for (const line of LINES['pt-BR'][kind])
        expect(line.text({ ...sample('pt-BR', false), title: 'Zzz' })).not.toMatch(/\b(the|you|your|what|minutes|since|until)\b/i)
      for (const line of LINES.en[kind])
        expect(line.text({ ...sample('en', false), title: 'Zzz' })).not.toMatch(/\b(para|hoje|minutos|desde|uma)\b/i)
    }
  })

  it('greets and gives his name, and says nothing more about himself', () => {
    for (const locale of locales) {
      const { greeting } = PHRASES[locale]
      expect(greeting).toContain('Herman')
      expect(greeting.length).toBeLessThanOrEqual(30)
      expect(PHRASES[locale].aiOff.length).toBeLessThanOrEqual(40)
    }
    expect(Object.keys(PHRASES.en).sort()).toEqual(Object.keys(PHRASES['pt-BR']).sort())
  })
})
