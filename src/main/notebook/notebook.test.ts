import { beforeEach, describe, expect, it } from 'vitest'
import { localDay } from '../../shared/briefing'
import { entryId, NOTEBOOK_ID } from '../../shared/notebook'
import type { Block } from '../../shared/types'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import { workspaceFromRows } from '../sync/format'
import { checkWorkspace, diffWorkspace, emptyWorkspace, mergeWorkspace } from '../sync/merge'
import { NotebookService } from './service'

/** Noon, local time, on a day of October 2026. */
const at = (date: number, hour = 12, minute = 0): number => new Date(2026, 9, date, hour, minute).getTime()

let clock: { t: number }
let repo: Repository
let notebook: NotebookService

function open(start: number): { clock: { t: number }; repo: Repository; notebook: NotebookService } {
  const c = { t: start }
  const r = openTestRepository(':memory:', { clock: () => c.t })
  return { clock: c, repo: r, notebook: new NotebookService({ repo: r, now: () => c.t, systemLocale: () => 'en-US' }) }
}

beforeEach(() => {
  ;({ clock, repo, notebook } = open(at(15)))
})

const today = (): string => localDay(clock.t)

describe('the notebook page', () => {
  it('is started on first use with its fixed id, once', () => {
    expect(repo.get(NOTEBOOK_ID)).toBeNull()
    expect(notebook.get().entries).toEqual([])
    // Reading starts nothing.
    expect(repo.get(NOTEBOOK_ID)).toBeNull()
    notebook.ensure()
    notebook.ensure()
    notebook.write(today(), 'first line')
    const root = repo.get(NOTEBOOK_ID) as Block
    expect(root).toMatchObject({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { system: 'notebook', title: [['Meditations']] } })
    expect(repo.rootOrder().order.filter((id) => id === NOTEBOOK_ID)).toHaveLength(1)
    expect(root.content).toEqual([entryId(today())])
  })

  it('takes its name in the language of the screens', () => {
    const pt = open(at(15))
    pt.repo.setSetting('ai.language', 'pt-BR')
    pt.notebook.ensure()
    expect(pt.repo.get(NOTEBOOK_ID)?.props.title).toEqual([['Meditações']])
  })

  it('cannot be trashed, deleted for good, moved into a page or made twice', () => {
    notebook.ensure()
    const other = repo.create({ type: 'page', parentId: null, props: { title: [['Other']] } })
    expect(() => repo.delete(NOTEBOOK_ID)).toThrow(/cannot be deleted/)
    expect(() => repo.apply([{ op: 'delete', id: NOTEBOOK_ID }])).toThrow(/cannot be deleted/)
    expect(() => repo.deleteForever(NOTEBOOK_ID)).toThrow(/cannot be deleted/)
    expect(() => repo.move(NOTEBOOK_ID, other.id)).toThrow(/cannot be moved/)
    expect(() => repo.update(NOTEBOOK_ID, { props: { system: null } })).toThrow(/cannot stop being one/)
    expect(repo.get(NOTEBOOK_ID)?.trashedAt).toBeNull()
    // Only the page with the fixed id is the notebook.
    expect(() => repo.create({ type: 'page', parentId: null, props: { system: 'notebook' } })).toThrow(/page of its own/)
    expect(() => repo.create({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { system: 'notebook' } })).toThrow(/already exists/)
  })

  it('refuses to start over a block that took its id', () => {
    repo.create({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { title: [['Mine']] } })
    expect(() => notebook.ensure()).toThrow(/could not be opened/)
    // An ordinary page with that id holds whatever it likes: the rules are the notebook's only.
    expect(() => repo.create({ type: 'text', parentId: NOTEBOOK_ID, props: { title: [['free']] } })).not.toThrow()
  })
})

describe('a day of the notebook', () => {
  it('is written, rewritten and taken back while it lasts', () => {
    expect(notebook.write(today(), '  the river was high  ').text).toBe('the river was high')
    expect(notebook.write(today(), 'the river was higher').text).toBe('the river was higher')
    expect(notebook.get().entries.map((e) => e.text)).toEqual(['the river was higher'])
    notebook.write(today(), '')
    expect(notebook.get().entries).toEqual([])
    expect(notebook.get().todayEntry).toMatchObject({ day: today(), text: '' })
  })

  it('is not created by an empty line', () => {
    notebook.write(today(), '   ')
    expect(repo.get(entryId(today()))).toBeNull()
  })

  it('is ink once it has ended, whoever writes', () => {
    notebook.write(today(), 'written on the 15th')
    const id = entryId('2026-10-15')
    clock.t = at(16, 0, 0)
    expect(() => notebook.write('2026-10-15', 'changed')).toThrow(/has ended/)
    expect(() => repo.update(id, { props: { title: [['changed']] } })).toThrow(/has ended/)
    expect(() => repo.apply([{ op: 'update', id, patch: { props: { title: [['changed']] } } }])).toThrow(/has ended/)
    expect(() => repo.update(id, { type: 'heading_1' })).toThrow(/has ended/)
    expect(() => repo.delete(id)).toThrow(/has ended/)
    expect(() => repo.deleteForever(id)).toThrow(/has ended/)
    expect(() => repo.move(id, NOTEBOOK_ID, null)).toThrow(/stays where it was written/)
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Elsewhere']] } })
    expect(() => repo.move(id, page.id)).toThrow(/stays where it was written/)
    expect(repo.get(id)?.props.title).toEqual([['written on the 15th']])
    expect(notebook.get().entries.map((e) => e.day)).toEqual(['2026-10-15'])
  })

  it('cannot be written for a day that has ended or before it comes', () => {
    notebook.ensure()
    expect(() => notebook.write('2026-10-14', 'late')).toThrow(/has ended/)
    expect(() => notebook.write('2026-10-16', 'early')).toThrow(/once it comes/)
    expect(() => repo.create({ id: entryId('2026-10-14'), type: 'text', parentId: NOTEBOOK_ID, props: { title: [['backdated']] } })).toThrow(/has ended/)
    expect(() => notebook.write('yesterday', 'x')).toThrow(/Invalid day/)
  })

  it('is the only thing the notebook holds, and holds nothing itself', () => {
    notebook.write(today(), 'a line')
    const id = entryId(today())
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Notes']] } })
    const loose = repo.create({ type: 'text', parentId: page.id, props: { title: [['loose']] } })
    expect(() => repo.create({ type: 'text', parentId: NOTEBOOK_ID, props: { title: [['random id']] } })).toThrow(/one line a day/)
    expect(() => repo.create({ id: entryId('2026-10-16'), type: 'to_do', parentId: NOTEBOOK_ID })).toThrow(/one line a day/)
    expect(() => repo.create({ type: 'text', parentId: id, props: { title: [['nested']] } })).toThrow(/holds its line/)
    expect(() => repo.createTree({ type: 'text', props: { title: [['tree']] } }, NOTEBOOK_ID)).toThrow(/Nothing can be added/)
    expect(() => repo.move(loose.id, NOTEBOOK_ID)).toThrow(/Nothing can be moved into/)
    expect(() => repo.move(loose.id, id)).toThrow(/Nothing can be moved into/)
    expect(() => repo.update(id, { type: 'heading_1' })).toThrow(/stays a line/)
  })

  it('may be removed by a writer while the day lasts', () => {
    notebook.write(today(), 'a line')
    repo.delete(entryId(today()))
    expect(repo.get(entryId(today()))).toBeNull()
  })

  it('keeps the notebook from going back to an earlier version', () => {
    notebook.write(today(), 'first')
    const version = repo.saveVersion(NOTEBOOK_ID, 'before')
    notebook.write(today(), 'second')
    expect(() => repo.restoreVersion(version.id, 'replace')).toThrow(/never change/)
    expect(repo.get(entryId(today()))?.props.title).toEqual([['second']])
  })

  it('arrives from another device through sync even when its day has ended here', () => {
    notebook.ensure()
    clock.t = at(17)
    const late: Block = { id: entryId('2026-10-15'), type: 'text', parentId: NOTEBOOK_ID, content: [], props: { title: [['written elsewhere']] }, createdAt: at(15), updatedAt: at(15, 23), trashedAt: null }
    const root = repo.get(NOTEBOOK_ID) as Block
    repo.applySync({ put: [{ ...root, content: [late.id] }, late], remove: [], snapshots: [], foreign: [], resetPages: [], settings: {} })
    expect(notebook.get().entries.map((e) => [e.day, e.text])).toEqual([['2026-10-15', 'written elsewhere']])
  })
})

describe('on this day', () => {
  it('shows the lines of the same date in earlier years under today', () => {
    for (const [year, text] of [
      [2024, 'two years ago'],
      [2025, 'a year ago']
    ] as const) {
      clock.t = new Date(year, 9, 15, 9).getTime()
      notebook.write(localDay(clock.t), text)
    }
    clock.t = new Date(2025, 9, 16, 9).getTime()
    notebook.write(localDay(clock.t), 'the day after')
    clock.t = at(15)
    const view = notebook.get()
    expect(view.today).toBe('2026-10-15')
    expect(view.onThisDay.map((o) => [o.years, o.entry.text])).toEqual([
      [1, 'a year ago'],
      [2, 'two years ago']
    ])
    expect(view.entries.map((e) => e.day)).toEqual(['2025-10-16', '2025-10-15', '2024-10-15'])
  })
})

describe('two devices', () => {
  it('that start the notebook on their own merge into one page with every day', () => {
    const a = open(at(15, 9))
    const b = open(at(15, 10))
    a.notebook.write('2026-10-15', 'from the desk')
    b.clock.t = at(16, 8)
    b.notebook.write('2026-10-16', 'from the laptop')
    const wsA = workspaceFromRows(a.repo.syncRows(), a.repo.rootOrder())
    const wsB = workspaceFromRows(b.repo.syncRows(), b.repo.rootOrder())
    const { result, conflicts } = mergeWorkspace(emptyWorkspace(), wsA, wsB)
    expect(checkWorkspace(result)).toEqual([])
    expect(result.root.filter((id) => id === NOTEBOOK_ID)).toHaveLength(1)
    expect([...(result.blocks.get(NOTEBOOK_ID)?.content ?? [])].sort()).toEqual([entryId('2026-10-15'), entryId('2026-10-16')])
    // Only the page itself was made twice; the days do not collide.
    expect(conflicts.every((c) => c.blockId === NOTEBOOK_ID)).toBe(true)

    // Device A takes the merged workspace, a day later than both lines.
    a.clock.t = at(17)
    const diff = diffWorkspace(wsA, result)
    a.repo.applySync({ put: diff.put as Block[], remove: diff.remove, root: { order: result.root, at: result.rootAt ?? 0 }, snapshots: [], foreign: [], resetPages: [], settings: {} })
    expect(a.notebook.get().entries.map((e) => [e.day, e.text])).toEqual([
      ['2026-10-16', 'from the laptop'],
      ['2026-10-15', 'from the desk']
    ])
    expect(a.repo.listRoot().filter((block) => block.id === NOTEBOOK_ID)).toHaveLength(1)
  })

  it('that both wrote the same day keep one line for it, the later one', () => {
    const a = open(at(15, 9))
    const b = open(at(15, 21))
    a.notebook.write('2026-10-15', 'morning version')
    b.notebook.write('2026-10-15', 'evening version')
    const wsA = workspaceFromRows(a.repo.syncRows(), a.repo.rootOrder())
    const wsB = workspaceFromRows(b.repo.syncRows(), b.repo.rootOrder())
    const { result } = mergeWorkspace(emptyWorkspace(), wsA, wsB)
    expect(checkWorkspace(result)).toEqual([])
    expect(result.blocks.get(NOTEBOOK_ID)?.content).toEqual([entryId('2026-10-15')])
    expect(result.blocks.get(entryId('2026-10-15'))?.props['title']).toEqual([['evening version']])
  })
})

describe('things set aside for tomorrow', () => {
  it('go onto tomorrow’s day, come back the next morning and are put away there', () => {
    notebook.write('2026-10-15', 'closed the day')
    const planned = notebook.plan('2026-10-16', ['  call Ana ', '', 'buy bread', 'fix the bike', 'a fourth'])
    expect(planned).toMatchObject({ day: '2026-10-16', text: '', plans: ['call Ana', 'buy bread', 'fix the bike'], plansDismissed: false })
    // Tomorrow's block holds no line yet: the notebook does not list it.
    expect(notebook.get().entries.map((e) => e.day)).toEqual(['2026-10-15'])
    expect(notebook.review().tomorrowPlans).toEqual(['call Ana', 'buy bread', 'fix the bike'])

    clock.t = at(16, 7)
    const morning = notebook.get()
    expect(morning.todayEntry).toMatchObject({ day: '2026-10-16', plans: ['call Ana', 'buy bread', 'fix the bike'], plansDismissed: false })
    notebook.dismissPlans('2026-10-16')
    expect(notebook.get().todayEntry).toMatchObject({ plans: ['call Ana', 'buy bread', 'fix the bike'], plansDismissed: true })
    // The day's line is still written on the same block.
    expect(notebook.write('2026-10-16', 'a new day').plans).toEqual(['call Ana', 'buy bread', 'fix the bike'])

    // Once the 16th has ended, its plans are ink like its line.
    clock.t = at(17)
    expect(() => notebook.plan('2026-10-16', ['too late'])).toThrow(/has ended/)
    expect(() => repo.update(entryId('2026-10-16'), { props: { plansDismissed: null } } as never)).toThrow(/has ended/)
    expect(() => notebook.dismissPlans('2026-10-16')).not.toThrow()
  })

  it('are replaced by a second closing and taken back by an empty one', () => {
    notebook.plan('2026-10-16', ['one', 'two'])
    expect(notebook.plan('2026-10-16', ['three']).plans).toEqual(['three'])
    expect(notebook.plan('2026-10-16', ['', ' ']).plans).toEqual([])
    expect(notebook.review().tomorrowPlans).toEqual([])
  })

  it('make nothing when there is nothing to set aside', () => {
    notebook.plan('2026-10-16', [])
    expect(repo.get(entryId('2026-10-16'))).toBeNull()
    expect(() => notebook.plan('2026-10-16', 'one' as never)).toThrow(/Invalid plans/)
    expect(() => notebook.plan('2026-10-14', ['late'])).toThrow(/has ended/)
  })
})

describe('the review of the day', () => {
  it('reads the tasks done and the pages written today from the workspace', () => {
    clock.t = at(15, 8)
    const db = repo.create({
      type: 'database',
      parentId: null,
      props: { title: [['Tasks']], schema: { title: { id: 'title', name: 'Name', type: 'title' }, done: { id: 'done', name: 'Done', type: 'checkbox' } } }
    })
    const row = repo.create({ type: 'page', parentId: db.id, props: { title: [['Post the letter']], values: { done: false } } })
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Garden plan']] } })
    clock.t = at(15, 18)
    repo.update(row.id, { props: { values: { done: true } } })
    repo.create({ type: 'to_do', parentId: page.id, props: { title: [['Buy seeds']], checked: true } })
    notebook.write('2026-10-15', 'the garden, at last')
    const review = notebook.review()
    expect(review).toMatchObject({ locale: 'en', today: '2026-10-15', line: 'the garden, at last', tomorrowPlans: [] })
    expect(review.completed.map((item) => item.title)).toEqual(['Buy seeds', 'Post the letter'])
    expect(review.edited.map((item) => item.title)).toEqual(['Garden plan'])

    // The next day, yesterday's work is not today's.
    clock.t = at(16, 9)
    expect(notebook.review()).toMatchObject({ completed: [], edited: [], line: '' })
  })
})
