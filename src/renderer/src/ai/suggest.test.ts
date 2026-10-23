import { describe, expect, it } from 'vitest'
import { MAX_SUGGESTIONS, SUGGESTION_WORDS, suggestionsFor, type Moment } from './suggest'

const moment = (over: Partial<Moment> = {}): Moment => ({ hour: 14, page: null, today: false, overdue: 0, meeting: false, ...over })
const page = { id: 'p1', kind: 'page' as const, empty: false }
const ids = (m: Moment): string[] => suggestionsFor(m, 'pt-BR').map((s) => s.id)

describe('suggestions for the moment', () => {
  it('offers nothing in the middle of an ordinary afternoon with no page open', () => {
    expect(suggestionsFor(moment(), 'en')).toEqual([])
  })

  it('offers to summarize an open page and turn it into tasks', () => {
    const list = suggestionsFor(moment({ page }), 'pt-BR')
    expect(list.map((s) => s.label)).toEqual(['Resumir esta página', 'Transformar em tarefas'])
    expect(list.every((s) => s.scope === 'page')).toBe(true)
    expect(list[0].prompt).toBe(SUGGESTION_WORDS['pt-BR'].summarizePrompt)
  })

  it('has nothing to summarize on an empty page, and no tasks from a database', () => {
    expect(ids(moment({ page: { ...page, empty: true } }))).toEqual([])
    expect(ids(moment({ page: { ...page, kind: 'database' } }))).toEqual(['summarize'])
  })

  it('offers nothing about a page private from the AI, only the day', () => {
    const secret = { ...page, private: true }
    expect(ids(moment({ page: secret }))).toEqual([])
    expect(ids(moment({ page: secret, meeting: true, overdue: 2, hour: 9 }))).toEqual(['plan-day', 'overdue'])
  })

  it('counts the overdue tasks, about the day', () => {
    const [first] = suggestionsFor(moment({ overdue: 3 }), 'pt-BR')
    expect(first).toMatchObject({ id: 'overdue', label: 'Replanejar 3 atrasadas', scope: 'today' })
    expect(first.prompt).toContain('3 tarefas atrasadas')
    expect(suggestionsFor(moment({ overdue: 1 }), 'en')[0].label).toBe('Replan 1 overdue')
  })

  it('puts a transcribed meeting first, as the page action that writes its notes', () => {
    const list = suggestionsFor(moment({ page, meeting: true, overdue: 2 }), 'pt-BR')
    expect(list[0]).toMatchObject({ id: 'meeting', label: 'Escrever a ata', run: 'consolidate' })
    // A meeting is not turned into tasks from here: its notes are what is wanted.
    expect(list.map((s) => s.id)).not.toContain('tasks')
  })

  it('plans the day in the morning and closes it in the evening', () => {
    expect(ids(moment({ hour: 8 }))).toEqual(['plan-day'])
    expect(ids(moment({ hour: 19 }))).toEqual(['close-day'])
    expect(ids(moment({ hour: 3 }))).toEqual([])
    expect(suggestionsFor(moment({ hour: 8 }), 'pt-BR')[0]).toMatchObject({ label: 'Planejar o dia', scope: 'today' })
    expect(suggestionsFor(moment({ hour: 21 }), 'pt-BR')[0]).toMatchObject({ label: 'Fechar o dia', scope: 'today' })
  })

  it('puts the day first on Today, and the page first when one is open', () => {
    expect(ids(moment({ hour: 9, today: true, overdue: 2 }))).toEqual(['plan-day', 'overdue'])
    expect(ids(moment({ hour: 9, page, overdue: 2 }))).toEqual(['overdue', 'summarize', 'plan-day', 'tasks'])
  })

  it('offers at most four, the most relevant first', () => {
    const list = suggestionsFor(moment({ hour: 18, page, overdue: 5, meeting: true }), 'en')
    expect(list.length).toBeLessThanOrEqual(MAX_SUGGESTIONS)
    expect(list.map((s) => s.id)).toEqual(['meeting', 'overdue', 'summarize', 'close-day'])
    const busy = suggestionsFor(moment({ hour: 9, page, overdue: 5 }), 'en')
    expect(busy).toHaveLength(MAX_SUGGESTIONS)
  })
})
