// ruleText: a rule in words, pt-BR and en, and the words typed back into the quick add.
import { describe, expect, it } from 'vitest'
import { ruleText, type RuleLocale } from './rrule'
import { parseTask } from './tasks/parse'
import { presetRule, REPEAT_PRESETS, ruleOf, defaultForm } from './tasks/repeat'

/** Thursday 15 October 2026. */
const NOW = (): Date => new Date(2026, 9, 15, 10, 0)

describe('ruleText', () => {
  const cases: [string, string, string][] = [
    ['FREQ=DAILY', 'todo dia', 'every day'],
    ['FREQ=DAILY;INTERVAL=3', 'a cada 3 dias', 'every 3 days'],
    ['FREQ=WEEKLY', 'toda semana', 'every week'],
    ['FREQ=WEEKLY;INTERVAL=2', 'a cada 2 semanas', 'every 2 weeks'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'dias úteis', 'every weekday'],
    ['FREQ=WEEKLY;BYDAY=MO', 'toda segunda', 'every Monday'],
    ['FREQ=WEEKLY;BYDAY=SA', 'todo sábado', 'every Saturday'],
    ['FREQ=WEEKLY;BYDAY=WE,MO,FR', 'toda segunda, quarta e sexta', 'every Monday, Wednesday and Friday'],
    ['FREQ=WEEKLY;BYDAY=SA,SU', 'todo sábado e domingo', 'every Saturday and Sunday'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', 'a cada 2 semanas na terça e quinta', 'every 2 weeks on Tuesday and Thursday'],
    ['FREQ=MONTHLY', 'todo mês', 'every month'],
    ['FREQ=MONTHLY;BYMONTHDAY=5', 'todo mês no dia 5', 'every month on the 5th'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'todo mês no último dia', 'every month on the last day'],
    ['FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=21', 'a cada 3 meses no dia 21', 'every 3 months on the 21st'],
    ['FREQ=MONTHLY;BYMONTHDAY=1,15', 'todo mês nos dias 1 e 15', 'every month on the 1st and the 15th'],
    ['FREQ=MONTHLY;BYDAY=1MO', 'todo mês na primeira segunda', 'every month on the first Monday'],
    ['FREQ=MONTHLY;BYDAY=-1SA', 'todo mês no último sábado', 'every month on the last Saturday'],
    ['FREQ=YEARLY', 'todo ano', 'every year'],
    ['FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=20', 'todo ano em 20 de outubro', 'every year on October 20'],
    ['FREQ=YEARLY;INTERVAL=2', 'a cada 2 anos', 'every 2 years'],
    ['FREQ=DAILY;COUNT=5', 'todo dia, 5 vezes', 'every day, 5 times'],
    ['FREQ=WEEKLY;BYDAY=MO;COUNT=1', 'toda segunda, 1 vez', 'every Monday, 1 time'],
    ['FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231', 'toda sexta, até 31 de dezembro de 2026', 'every Friday, until December 31, 2026'],
    ['RRULE:FREQ=DAILY', 'todo dia', 'every day']
  ]
  for (const [rule, pt, en] of cases) {
    it(rule, () => {
      expect(ruleText(rule, 'pt-BR')).toBe(pt)
      expect(ruleText(rule, 'en')).toBe(en)
    })
  }

  it('gives back what it cannot say', () => {
    expect(ruleText('FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1', 'en')).toBe('FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-1')
    expect(ruleText('FREQ=HOURLY', 'pt-BR')).toBe('FREQ=HOURLY')
    expect(ruleText('nonsense', 'en')).toBe('nonsense')
  })
})

describe('ruleText and the quick add, there and back', () => {
  const locales: RuleLocale[] = ['pt-BR', 'en']
  // Every preset, anchored on days that exercise its words.
  const anchors = ['2026-10-15', '2026-10-17', '2026-10-18', '2026-10-31', '2027-02-01']
  for (const locale of locales) {
    for (const anchor of anchors) {
      for (const preset of REPEAT_PRESETS) {
        const rule = presetRule(preset, anchor)
        it(`${locale}: ${preset} from ${anchor} (${rule})`, () => {
          const text = ruleText(rule, locale)
          expect(parseTask(`Tarefa ${text}`, { now: NOW() })).toMatchObject({ title: 'Tarefa', recurrence: { rule, from: 'due' } })
        })
      }
    }
    // And the Custom rules the parser has words for.
    const custom = [
      ruleOf({ ...defaultForm(), freq: 'DAILY', interval: 2 }),
      ruleOf({ ...defaultForm(), freq: 'WEEKLY', interval: 3 }),
      ruleOf({ ...defaultForm(), freq: 'WEEKLY', interval: 2, weekdays: [2, 4] }),
      ruleOf({ ...defaultForm(), freq: 'WEEKLY', weekdays: [6, 0] }),
      ruleOf({ ...defaultForm(), freq: 'MONTHLY', interval: 2, monthDay: 10 }),
      ruleOf({ ...defaultForm(), freq: 'MONTHLY', monthDay: -1 }),
      ruleOf({ ...defaultForm(), freq: 'YEARLY', interval: 2 })
    ]
    for (const rule of custom) {
      it(`${locale}: custom ${rule}`, () => {
        expect(parseTask(`Tarefa ${ruleText(rule, locale)}`, { now: NOW() }).recurrence?.rule).toBe(rule)
      })
    }
  }

  it('starts a picked repeat on its first day', () => {
    expect(parseTask('x todo mês no dia 20', { now: NOW() }).due).toBe('2026-10-20')
    expect(parseTask('x every year on March 1', { now: NOW() }).due).toBe('2027-03-01')
    expect(parseTask('x a cada 2 semanas na segunda', { now: NOW() }).due).toBe('2026-10-19')
    expect(parseTask('x todo mês no último dia', { now: NOW() }).due).toBe('2026-10-31')
  })
})
