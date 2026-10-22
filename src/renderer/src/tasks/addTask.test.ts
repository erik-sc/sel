import { describe, expect, it } from 'vitest'
import { TASK_PROPS } from '@shared/tasks'
import { parseTask } from '@shared/tasks/parse'
import { findOption, fragmentAt, listDefaults, localeDayFirst, readName, renamedValues, shiftIgnored, suggest, taskValues } from './addTask'

const NOW = new Date(2026, 9, 15, 10, 0)
const TODAY = '2026-10-15'

describe('the values a line stores', () => {
  it('every field the parser read', () => {
    const parsed = parseTask('Consulta toda segunda 15h p2 lembrar 8h', { now: NOW })
    expect(taskValues(parsed, { project: 'home', labels: ['calls'] })).toEqual({
      [TASK_PROPS.due]: { start: '2026-10-19T15:00' },
      [TASK_PROPS.priority]: 'tasks.p2',
      [TASK_PROPS.project]: 'home',
      [TASK_PROPS.labels]: ['calls'],
      [TASK_PROPS.recurrence]: JSON.stringify({ rule: 'FREQ=WEEKLY;BYDAY=MO', from: 'due', text: 'toda segunda' }),
      [TASK_PROPS.remind]: { start: '2026-10-19T08:00' }
    })
  })

  it('what the list implies, unless the line says otherwise', () => {
    const plain = parseTask('Ler', { now: NOW })
    expect(taskValues(plain, { project: null, labels: [] }, listDefaults({ kind: 'today' }, TODAY))).toEqual({
      [TASK_PROPS.due]: { start: TODAY }
    })
    const dated = parseTask('Ler amanhã', { now: NOW })
    expect(taskValues(dated, { project: null, labels: [] }, listDefaults({ kind: 'today' }, TODAY))).toEqual({
      [TASK_PROPS.due]: { start: '2026-10-16' }
    })
    expect(taskValues(plain, { project: 'work', labels: [] }, listDefaults({ kind: 'project', id: 'home' }, TODAY))).toEqual({
      [TASK_PROPS.project]: 'work'
    })
    expect(taskValues(plain, { project: null, labels: ['b'] }, listDefaults({ kind: 'label', id: 'a' }, TODAY))).toEqual({
      [TASK_PROPS.labels]: ['a', 'b']
    })
    expect(listDefaults({ kind: 'upcoming' }, TODAY)).toEqual({ [TASK_PROPS.due]: { start: '2026-10-16' } })
    expect(listDefaults({ kind: 'inbox' }, TODAY)).toEqual({})
  })
})

describe('un-recognised spans across edits', () => {
  const span = { start: 17, text: 'segunda' }
  const text = 'Comprar tinta de segunda mão'

  it('stay put when the edit is after them', () => {
    expect(shiftIgnored([span], text, `${text} azul`)).toEqual([span])
  })

  it('move with the text when the edit is before them', () => {
    expect(shiftIgnored([span], text, `Já ${text}`)).toEqual([{ start: 20, text: 'segunda' }])
    expect(shiftIgnored([span], text, text.replace('Comprar ', ''))).toEqual([{ start: 9, text: 'segunda' }])
  })

  it('are dropped when the edit touches them', () => {
    expect(shiftIgnored([span], text, text.replace('segunda', 'segundo'))).toEqual([])
  })
})

describe('the #project or @label being typed', () => {
  it('is found right before the caret', () => {
    expect(fragmentAt('Pagar #ca', 9)).toEqual({ sigil: '#', start: 6, text: 'ca' })
    expect(fragmentAt('Pagar @', 7)).toEqual({ sigil: '@', start: 6, text: '' })
    expect(fragmentAt('#ca', 3)).toEqual({ sigil: '#', start: 0, text: 'ca' })
  })

  it('is not there after a space, inside a word or in an address', () => {
    expect(fragmentAt('Pagar #casa ', 12)).toBeNull()
    expect(fragmentAt('ana@exemplo', 11)).toBeNull()
    expect(fragmentAt('Pagar', 5)).toBeNull()
  })

  it('suggests names that start with it, then names that contain it', () => {
    const options = [
      { id: '1', name: 'Trabalho', color: 'blue' },
      { id: '2', name: 'Casa', color: 'green' },
      { id: '3', name: 'Casamento', color: 'pink' },
      { id: '4', name: 'Encasar', color: 'gray' }
    ]
    expect(suggest(options, 'cas').map((option) => option.name)).toEqual(['Casa', 'Casamento', 'Encasar'])
    expect(suggest(options, '').map((option) => option.name)).toEqual(['Trabalho', 'Casa', 'Casamento', 'Encasar'])
    expect(findOption(options, 'CASA')?.id).toBe('2')
    expect(findOption(options, 'Cas')).toBeUndefined()
  })
})

describe('the order of numbers in dates', () => {
  it('follows the locale', () => {
    expect(localeDayFirst('pt-BR')).toBe(true)
    expect(localeDayFirst('en-GB')).toBe(true)
    expect(localeDayFirst('en-US')).toBe(false)
  })
})

describe('renaming a task in a list', () => {
  const names = { projects: ['Casa'], labels: ['calls'] }
  const current = {
    title: 'Pagar aluguel',
    values: { [TASK_PROPS.project]: 'work', [TASK_PROPS.labels]: ['errands'], [TASK_PROPS.priority]: 'tasks.p3' }
  }

  it('applies the date and priority the new name gives ("amanhã p1"), keeping the title', () => {
    const parsed = readName('amanhã p1', names, [], NOW)
    expect(renamedValues(parsed, { project: null, labels: [] }, current)).toEqual({
      title: 'Pagar aluguel',
      values: { ...current.values, [TASK_PROPS.due]: { start: '2026-10-16' }, [TASK_PROPS.priority]: 'tasks.p1' }
    })
  })

  it('takes the title the words leave, and adds the labels they name', () => {
    const parsed = readName('Pagar o aluguel sexta 15h #Casa @calls', names, [], NOW)
    expect(parsed.project).toBe('Casa')
    expect(renamedValues(parsed, { project: 'home', labels: ['calls'] }, current)).toEqual({
      title: 'Pagar o aluguel',
      values: {
        [TASK_PROPS.project]: 'home',
        [TASK_PROPS.labels]: ['errands', 'calls'],
        [TASK_PROPS.priority]: 'tasks.p3',
        [TASK_PROPS.due]: { start: '2026-10-16T15:00' }
      }
    })
  })

  it('keeps words kept as text out of the fields', () => {
    const parsed = readName('Ligar amanhã', names, [{ start: 6, text: 'amanhã' }], NOW)
    expect(parsed.title).toBe('Ligar amanhã')
    expect(parsed.due).toBeNull()
  })
})
