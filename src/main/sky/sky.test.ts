import { beforeEach, describe, expect, it } from 'vitest'
import { POMODORO_HISTORY_KEY } from '../../shared/pomodoro'
import { TASK_PROPS } from '../../shared/tasks'
import { nameId, pomodoroEventId, SKY_BACKFILLED_KEY, SKY_ID, todoEventId } from '../../shared/sky'
import type { Block } from '../../shared/types'
import type { Repository } from '../db/repository'
import { ensureTasksDatabase } from '../db/tasks'
import { openTestRepository } from '../db/testing'
import { NotebookService } from '../notebook/service'
import { workspaceFromRows } from '../sync/format'
import { checkWorkspace, diffWorkspace, emptyWorkspace, mergeWorkspace } from '../sync/merge'
import { SkyService, skyLineMoment } from './service'

/** A moment of a day of October 2026, local time. */
const at = (date: number, hour = 12, minute = 0): number => new Date(2026, 9, date, hour, minute).getTime()

interface Rig {
  clock: { t: number }
  repo: Repository
  sky: SkyService
  notebook: NotebookService
}

function open(start: number): Rig {
  const clock = { t: start }
  const repo = openTestRepository(':memory:', { clock: () => clock.t })
  const sky = new SkyService({ repo, now: () => clock.t, systemLocale: () => 'pt-BR' })
  // As ./register.ts wires it.
  repo.onTodoChecked((id) => sky.recordTodo(id))
  return { clock, repo, sky, notebook: new NotebookService({ repo, now: () => clock.t, systemLocale: () => 'pt-BR' }) }
}

let rig: Rig

beforeEach(() => {
  rig = open(at(15))
})

function todo(repo: Repository): string {
  const page = repo.create({ type: 'page', parentId: null, props: { title: [['Lista']] } })
  return repo.create({ type: 'to_do', parentId: page.id, props: { title: [['Regar as plantas']], checked: false } }).id
}

const skyChildren = (repo: Repository): string[] => (repo.get(SKY_ID) ? repo.children(SKY_ID).map((b) => b.id).sort() : [])

describe('the Sky page', () => {
  it('is made once by ensure, with its fixed id, and kept as a built-in page', () => {
    const { repo, sky } = rig
    expect(sky.view().meditations).toEqual([])
    expect(repo.get(SKY_ID)).toBeNull()
    sky.ensure()
    sky.ensure()
    expect(repo.get(SKY_ID)).toMatchObject({ id: SKY_ID, type: 'page', parentId: null, props: { system: 'sky', title: [['Céu']] } })
    expect(repo.listRoot().filter((b) => b.id === SKY_ID)).toHaveLength(1)
    expect(() => repo.delete(SKY_ID)).toThrow(/built-in/)
    const other = repo.create({ type: 'page', parentId: null, props: { title: [['Outra']] } })
    expect(() => repo.move(SKY_ID, other.id)).toThrow(/built-in/)
    expect(() => repo.update(SKY_ID, { props: { system: null } as never })).toThrow(/built-in/)
    // Only the one page, with that id, can be the Sky.
    expect(() => repo.create({ type: 'page', parentId: null, props: { system: 'sky' } })).toThrow(/page of its own/)
  })
})

describe('the stars', () => {
  it('come from the lines of Meditations, derived, with nothing written', () => {
    const { notebook, sky, repo } = rig
    notebook.write('2026-10-15', 'O céu ficou laranja às seis.')
    const view = sky.view()
    expect(view.meditations).toEqual([{ day: '2026-10-15', text: 'O céu ficou laranja às seis.' }])
    expect(view.today).toBe('2026-10-15')
    expect(view.hemisphere).toBe('south')
    expect(view.locale).toBe('pt-BR')
    expect(repo.get(SKY_ID)).toBeNull()
  })
})

describe('checked to-dos', () => {
  it('write one grain when checked, and checking again the same day writes nothing new', () => {
    const { repo, sky } = rig
    const id = todo(repo)
    expect(skyChildren(repo)).toEqual([])
    repo.update(id, { props: { checked: true } })
    expect(skyChildren(repo)).toEqual([todoEventId(id, '2026-10-15')])
    repo.update(id, { props: { checked: false } })
    repo.update(id, { props: { checked: true } })
    expect(skyChildren(repo)).toEqual([todoEventId(id, '2026-10-15')])
    // Unchecking takes nothing away.
    repo.update(id, { props: { checked: false } })
    expect(sky.view().grains.map((g) => g.key)).toEqual([todoEventId(id, '2026-10-15')])
    // Another day, another grain.
    rig.clock.t = at(16)
    repo.update(id, { props: { checked: true } })
    expect(skyChildren(repo)).toEqual([todoEventId(id, '2026-10-15'), todoEventId(id, '2026-10-16')].sort())
    expect(sky.view().grains.map((g) => g.day).sort()).toEqual(['2026-10-15', '2026-10-16'])
  })

  it('also count when checked through apply, and only on the way to checked', () => {
    const { repo } = rig
    const id = todo(repo)
    repo.update(id, { props: { title: [['Regar']] } })
    expect(skyChildren(repo)).toEqual([])
    repo.apply([{ op: 'update', id, patch: { props: { checked: true } } }])
    expect(skyChildren(repo)).toEqual([todoEventId(id, '2026-10-15')])
  })

  it('come with the completed tasks of the Tasks database, derived from completedAt', () => {
    const { repo, sky } = rig
    const db = ensureTasksDatabase(repo)
    const done = repo.create({ type: 'page', parentId: db, props: { title: [['Pagar a conta']], values: { [TASK_PROPS.completedAt]: { start: '2026-10-14T18:30' } } } })
    repo.create({ type: 'page', parentId: db, props: { title: [['Ainda não']] } })
    expect(sky.view().grains).toEqual([{ key: `task:${done.id}:2026-10-14T18:30`, day: '2026-10-14', at: new Date(2026, 9, 14, 18, 30).getTime() }])
    // Nothing of it is written under the Sky.
    expect(repo.get(SKY_ID)).toBeNull()
  })
})

describe('pomodoros', () => {
  it('write sel-sky-pomodoro-<at>, once', () => {
    const { repo, sky } = rig
    const t = at(15, 10, 25)
    expect(sky.recordPomodoro({ at: t, minutes: 25 })).toBe(true)
    expect(sky.recordPomodoro({ at: t, minutes: 25 })).toBe(false)
    expect(skyChildren(repo)).toEqual([pomodoroEventId(t)])
    expect(repo.get(pomodoroEventId(t))?.props).toMatchObject({ sky: 'pomodoro', day: '2026-10-15', at: t })
    expect(sky.view().pomodoros).toEqual([{ key: pomodoroEventId(t), day: '2026-10-15', at: t }])
  })

  it('from this computer’s history are written on the first view, without duplicates', () => {
    const { repo, sky } = rig
    const live = at(14, 9)
    sky.recordPomodoro({ at: live, minutes: 25 })
    repo.setSetting(POMODORO_HISTORY_KEY, [
      { at: at(13, 9), minutes: 25 },
      { at: live, minutes: 25 },
      { at: 'nonsense', minutes: 1 }
    ])
    expect(sky.view().pomodoros.map((p) => p.day).sort()).toEqual(['2026-10-13', '2026-10-14'])
    expect(repo.getSetting(SKY_BACKFILLED_KEY)).toBe(true)
    // Done once: a later history is not read again, and nothing is doubled.
    repo.setSetting(POMODORO_HISTORY_KEY, [{ at: at(12, 9), minutes: 25 }])
    expect(sky.view().pomodoros).toHaveLength(2)
    expect(sky.backfillPomodoros()).toBe(0)
  })
})

describe('names', () => {
  it('are tidied, cut at 40 characters, and can be written again', () => {
    const { repo, sky } = rig
    sky.name('2026-09', '  O   mês\n das   chuvas  ')
    expect(sky.view().names).toEqual({ '2026-09': 'O mês das chuvas' })
    sky.name('2026-09', 'x'.repeat(80))
    expect(sky.view().names['2026-09']).toBe('x'.repeat(40))
    sky.name('2026-09', 'A mudança')
    expect(sky.view().names['2026-09']).toBe('A mudança')
    expect(repo.children(SKY_ID).map((b) => b.id)).toEqual([nameId('2026-09')])
    // Empty gives the figure's name back.
    sky.name('2026-09', '   ')
    expect(sky.view().names).toEqual({})
    // An empty name for a month never named writes nothing.
    sky.name('2026-08', '')
    expect(repo.get(nameId('2026-08'))).toBeNull()
    expect(() => sky.name('2026-13', 'x')).toThrow(/month/)
    expect(() => sky.name('2026-09', 42)).toThrow(/name/)
  })
})

describe('moments for Herman', () => {
  it('name a month that ended with stars, and tonight’s event', () => {
    const { notebook, sky } = rig
    rig.clock.t = new Date(2026, 8, 3, 12).getTime()
    notebook.write('2026-09-03', 'Uma linha')
    rig.clock.t = at(15)
    expect(sky.moment({ kind: 'named', month: '2026-10' })).toBeNull()
    expect(sky.moment({ kind: 'named', month: '2026-08' })).toBeNull()
    const named = sky.moment({ kind: 'named', month: '2026-09' })
    expect(named).toEqual({ kind: 'named', month: '2026-09', given: null })
    expect(skyLineMoment(named!, 'pt-BR')).toMatchObject({ kind: 'named', month: 'Setembro', given: false })
    sky.name('2026-09', 'A mudança')
    expect(skyLineMoment(sky.moment({ kind: 'named', month: '2026-09' })!, 'en')).toEqual({ kind: 'named', month: 'September', name: 'A mudança', given: true })
    // The Orionids fall on 21 October.
    rig.clock.t = at(21)
    expect(sky.moment({ kind: 'night' })).toEqual({ kind: 'night', event: { kind: 'meteors', shower: 'orionids' }, year: 2026 })
    expect(skyLineMoment(sky.moment({ kind: 'night' })!, 'pt-BR')).toEqual({ kind: 'meteors', shower: 'Oriônidas' })
    rig.repo.setSetting('sky.events', false)
    expect(sky.moment({ kind: 'night' })).toBeNull()
  })
})

describe('two devices', () => {
  it('with different happenings merge into their union, without a conflict', () => {
    const a = open(at(15, 9))
    const b = open(at(15, 10))
    a.sky.recordPomodoro({ at: at(15, 9, 25), minutes: 25 })
    const id = todo(b.repo)
    b.repo.update(id, { props: { checked: true } })
    b.sky.recordPomodoro({ at: at(15, 10, 25), minutes: 25 })
    // The same pomodoro written by both (the backfill of a shared history, say): one block.
    a.sky.recordPomodoro({ at: at(14, 20), minutes: 25 })
    b.sky.recordPomodoro({ at: at(14, 20), minutes: 25 })
    const wsA = workspaceFromRows(a.repo.syncRows(), a.repo.rootOrder())
    const wsB = workspaceFromRows(b.repo.syncRows(), b.repo.rootOrder())
    const { result, conflicts } = mergeWorkspace(emptyWorkspace(), wsA, wsB)
    expect(checkWorkspace(result)).toEqual([])
    expect(result.root.filter((x) => x === SKY_ID)).toHaveLength(1)
    const expected = [pomodoroEventId(at(15, 9, 25)), pomodoroEventId(at(15, 10, 25)), pomodoroEventId(at(14, 20)), todoEventId(id, '2026-10-15')].sort()
    expect([...(result.blocks.get(SKY_ID)?.content ?? [])].sort()).toEqual(expected)
    // Only the page itself was made twice; the happenings never collide.
    expect(conflicts.every((c) => c.blockId === SKY_ID)).toBe(true)

    const diff = diffWorkspace(wsA, result)
    a.repo.applySync({ put: diff.put as Block[], remove: diff.remove, root: { order: result.root, at: result.rootAt ?? 0 }, snapshots: [], foreign: [], resetPages: [], settings: {} })
    const view = a.sky.view()
    expect(view.pomodoros.map((p) => p.key).sort()).toEqual(expected.filter((k) => k.includes('pomodoro')))
    expect(view.grains.map((g) => g.key)).toEqual([todoEventId(id, '2026-10-15')])
  })
})
