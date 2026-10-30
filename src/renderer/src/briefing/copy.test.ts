import { describe, expect, it } from 'vitest'
import { BRIEFING_COPY, briefingCopy } from './copy'

describe('the words of the Today task list', () => {
  it('names the task that was done, in both languages', () => {
    expect(BRIEFING_COPY.en.done('Pay the rent')).toBe('Done: Pay the rent')
    expect(BRIEFING_COPY['pt-BR'].done('Pagar o aluguel')).toBe('Feita: Pagar o aluguel')
    expect(BRIEFING_COPY.en.done('Water', 'Tomorrow')).toBe('Done: Water. Next: Tomorrow.')
    expect(BRIEFING_COPY['pt-BR'].done('Regar', 'Amanhã')).toBe('Feita: Regar. Próxima: Amanhã.')
  })

  it('writes the labels of Portuguese in lower case', () => {
    const words = briefingCopy('pt-BR')
    for (const text of [words.openTasks, ...Object.values(words.groups)]) expect(text).toBe(text.toLowerCase())
    expect(words.openTasks).toBe('tarefas abertas')
    expect(words.groups).toEqual({ overdue: 'atrasadas', today: 'hoje', noDate: 'sem data' })
    expect(words.undo).toBe('Desfazer')
  })

  it('keeps English as it was', () => {
    expect(briefingCopy('en').openTasks).toBe('Open tasks')
    expect(briefingCopy('en').groups).toEqual({ overdue: 'Overdue', today: 'Today', noDate: 'No date' })
  })

  it('says every word in both languages', () => {
    expect(Object.keys(BRIEFING_COPY.en)).toEqual(Object.keys(BRIEFING_COPY['pt-BR']))
  })
})
