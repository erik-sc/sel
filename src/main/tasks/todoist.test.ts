import { beforeEach, describe, expect, it } from 'vitest'
import { cleanAccelerator, cleanGlobalShortcut, DEFAULT_GLOBAL_SHORTCUT } from '../../shared/tasks/api'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import type { PropertyValue } from '../../shared/types'
import type { Repository } from '../db/repository'
import { ensureTasksDatabase } from '../db/tasks'
import { openTestRepository } from '../db/testing'
import { importTodoistFiles } from './import'
import { parseCsv, projectNameOf, readTodoistCsv } from './todoist'

const NOW = new Date(2026, 9, 15, 10, 0)

/** A Todoist export as the app writes it (columns as of 2026). */
const EXPORT = [
  'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG',
  'section,Errands,,,,,,,,,,,,',
  'task,Buy paint @errands @home,For the fence,4,1,Érik (1),,Oct 20 2026 9:00 AM,en,America/Sao_Paulo,,,,',
  'task,Pick the colour,,1,2,Érik (1),,,en,America/Sao_Paulo,,,,',
  'task,Ask about primer,,2,3,Érik (1),,,en,America/Sao_Paulo,,,,',
  'note,"Shop closes at 6, ""really""",,,,Érik (1),,,,,,,,',
  ',,,,,,,,,,,,,',
  'task,Water the plants,,1,1,Érik (1),,every day,en,America/Sao_Paulo,,,,',
  'task,"Pagar aluguel, sem falta",,3,1,Érik (1),,todo dia 5,pt,America/Sao_Paulo,,,,',
  'task,Someday,,1,1,Érik (1),,whenever I feel like it,en,America/Sao_Paulo,,,,',
  'task,Back to top,,1,1,Érik (1),,16 out 2026,pt,America/Sao_Paulo,,,,'
].join('\r\n')

describe('reading CSV', () => {
  it('handles quotes, doubled quotes, line breaks inside quotes and both line ends', () => {
    expect(parseCsv('\ufeffa,"b, c","d ""e"""\r\n"line\none",2\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['line\none', '2']
    ])
    expect(parseCsv('x,y')).toEqual([['x', 'y']])
  })
})

describe('a Todoist export', () => {
  it('becomes tasks with priorities, dates, repeats, labels, subtasks and notes', () => {
    const { tasks, skipped } = readTodoistCsv(EXPORT, NOW)
    expect(skipped).toBe(1)
    expect(tasks.map((task) => task.title)).toEqual([
      'Buy paint',
      'Pick the colour',
      'Ask about primer',
      'Water the plants',
      'Pagar aluguel, sem falta',
      'Someday',
      'Back to top'
    ])
    expect(tasks[0]).toMatchObject({
      priority: 1,
      due: '2026-10-20T09:00',
      labels: ['errands', 'home'],
      parent: null,
      notes: ['For the fence']
    })
    expect(tasks[1]).toMatchObject({ priority: null, parent: 0 })
    expect(tasks[2]).toMatchObject({ priority: 3, parent: 1, notes: ['Shop closes at 6, "really"'] })
    expect(tasks[3].recurrence?.rule).toBe('FREQ=DAILY')
    expect(tasks[4]).toMatchObject({ priority: 2, due: '2026-11-05' })
    expect(tasks[4].recurrence?.rule).toBe('FREQ=MONTHLY;BYMONTHDAY=5')
    expect(tasks[5]).toMatchObject({ due: null, recurrence: null, unreadDate: 'whenever I feel like it' })
    expect(tasks[6]).toMatchObject({ due: '2026-10-16', parent: null })
  })

  it('without the columns it needs is not one', () => {
    expect(readTodoistCsv('name,date\nx,y', NOW).tasks).toEqual([])
    expect(readTodoistCsv('', NOW).tasks).toEqual([])
  })

  it('names its project after the file', () => {
    expect(projectNameOf('C:\\Users\\me\\Downloads\\Work [2203306141].csv')).toBe('Work')
    expect(projectNameOf('Casa.CSV')).toBe('Casa')
    expect(projectNameOf('.csv')).toBe('Todoist')
  })
})

describe('importing into the Tasks database', () => {
  let repo: Repository
  beforeEach(() => {
    repo = openTestRepository()
  })

  const rows = (): { title: string; values: Record<string, PropertyValue>; texts: string[] }[] =>
    repo.children(TASKS_DATABASE_ID).map((row) => ({
      title: String(row.props.title?.[0]?.[0] ?? ''),
      values: (row.props.values ?? {}) as Record<string, PropertyValue>,
      texts: repo.children(row.id).map((block) => String(block.props.title?.[0]?.[0] ?? ''))
    }))

  it('adds every task, a project per file and labels as options, in one go', () => {
    const result = importTodoistFiles(repo, [{ name: 'Home [123].csv', text: EXPORT }], NOW)
    expect(result).toEqual({ imported: true, tasks: 7, projects: ['Home'], skipped: 1 })
    const schema = repo.get(TASKS_DATABASE_ID)!.props.schema!
    const project = schema[TASK_PROPS.project].options!.find((option) => option.name === 'Home')!
    const labels = schema[TASK_PROPS.labels].options!.map((option) => option.name)
    expect(labels).toEqual(['errands', 'home'])
    const imported = rows()
    expect(imported.every((row) => row.values[TASK_PROPS.project] === project.id)).toBe(true)
    const paint = imported[0]
    expect(paint.values[TASK_PROPS.priority]).toBe('tasks.p1')
    expect(paint.values[TASK_PROPS.due]).toEqual({ start: '2026-10-20T09:00' })
    expect(paint.texts).toEqual(['For the fence'])
    const children = repo.children(TASKS_DATABASE_ID)
    expect(imported[1].values[TASK_PROPS.parent]).toEqual([children[0].id])
    expect(imported[2].values[TASK_PROPS.parent]).toEqual([children[1].id])
    expect(JSON.parse(String(imported[3].values[TASK_PROPS.recurrence])).rule).toBe('FREQ=DAILY')
    expect(imported[5].texts).toEqual(['Due in Todoist: whenever I feel like it'])
  })

  it('reuses projects and labels that are already there', () => {
    importTodoistFiles(repo, [{ name: 'Home.csv', text: EXPORT }], NOW)
    importTodoistFiles(repo, [{ name: 'home.csv', text: EXPORT }], NOW)
    const schema = repo.get(TASKS_DATABASE_ID)!.props.schema!
    expect(schema[TASK_PROPS.project].options).toHaveLength(1)
    expect(schema[TASK_PROPS.labels].options).toHaveLength(2)
    expect(repo.children(TASKS_DATABASE_ID)).toHaveLength(14)
  })

  it('writes nothing for a file without tasks', () => {
    ensureTasksDatabase(repo)
    const before = repo.get(TASKS_DATABASE_ID)
    expect(importTodoistFiles(repo, [{ name: 'x.csv', text: 'nothing,here' }], NOW)).toMatchObject({ tasks: 0, projects: [] })
    expect(repo.get(TASKS_DATABASE_ID)).toEqual(before)
    expect(repo.children(TASKS_DATABASE_ID)).toHaveLength(0)
  })
})

describe('the system-wide shortcut setting', () => {
  it('takes accelerators with a modifier and one key', () => {
    expect(cleanAccelerator('CommandOrControl+Alt+Space')).toBe('CommandOrControl+Alt+Space')
    expect(cleanAccelerator(' Ctrl + Shift + A ')).toBe('Ctrl+Shift+A')
    expect(cleanAccelerator('Alt+F12')).toBe('Alt+F12')
    for (const bad of ['A', 'Space', 'Ctrl+Alt', 'Ctrl+Ctrl+A', 'Ctrl+A+B', 'Hyper+A', '', 'Ctrl+', 7, null])
      expect(cleanAccelerator(bad)).toBeNull()
  })

  it('is off unless stored on, and falls back on the default keys', () => {
    expect(cleanGlobalShortcut(undefined)).toEqual(DEFAULT_GLOBAL_SHORTCUT)
    expect(cleanGlobalShortcut({ enabled: true, accelerator: 'nope' })).toEqual({
      enabled: true,
      accelerator: DEFAULT_GLOBAL_SHORTCUT.accelerator
    })
    expect(cleanGlobalShortcut({ enabled: 'yes', accelerator: 'Alt+Shift+T' })).toEqual({ enabled: false, accelerator: 'Alt+Shift+T' })
  })
})
