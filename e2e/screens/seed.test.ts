import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { Repository } from '../../src/main/db/repository'
import { ensureTasksDatabase } from '../../src/main/db/tasks'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../src/shared/tasks'
import { localDay, SEED_IDS, seedWorkspace } from './seed'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function seeded(options: Partial<Parameters<typeof seedWorkspace>[2]> = {}): { repo: Repository; now: Date } {
  const dir = mkdtempSync(join(tmpdir(), 'sel-screens-'))
  dirs.push(dir)
  const file = join(dir, 'sel.db')
  const now = new Date(2026, 9, 21, 14, 30)
  seedWorkspace({ Repository, ensureTasksDatabase }, file, { theme: 'dark', locale: 'en', now, ...options })
  return { repo: new Repository(new DatabaseSync(file)), now }
}

describe('seedWorkspace', () => {
  it('writes a sel.db the Repository opens, with the Notes page, the Tasks views, a task due today and seeded set', () => {
    const { repo, now } = seeded()
    try {
      expect(repo.getSetting('seeded')).toBe(true)
      expect(repo.getSetting('ai.onboarded')).toBe(true)
      expect(repo.getSetting('theme')).toBe('dark')
      expect(repo.getSetting('ai.language')).toBe('en')

      const notes = repo.get(SEED_IDS.notes)
      expect(notes?.type).toBe('page')
      expect(notes?.props.title).toEqual([['Notes']])
      const kinds = repo.children(SEED_IDS.notes).map((b) => b.type)
      expect(kinds).toEqual(expect.arrayContaining(['heading_1', 'text', 'heading_2', 'to_do', 'callout', 'toggle']))
      expect(repo.children(SEED_IDS.projects).map((b) => b.id)).toEqual([SEED_IDS.projectWebsite, SEED_IDS.projectGarden])

      const database = repo.get(TASKS_DATABASE_ID)
      expect(database?.props.system).toBe('tasks')
      const views = database?.props.views ?? []
      expect(new Set(views.map((v) => v.type))).toEqual(new Set(['table', 'board', 'calendar']))
      expect(views.find((v) => v.type === 'board' && v.groupBy === TASK_PROPS.priority)).toBeTruthy()

      const rows = repo.children(TASKS_DATABASE_ID)
      expect(rows.length).toBe(12)
      const due = (offset: number): number =>
        rows.filter((r) => (r.props.values?.[TASK_PROPS.due] as { start?: string } | undefined)?.start === localDay(now, offset)).length
      expect(due(0)).toBeGreaterThan(0)
      expect(due(-3)).toBe(1)
      expect(rows.filter((r) => r.props.values?.[TASK_PROPS.done] === true).length).toBe(2)
    } finally {
      repo.close()
    }
  })

  it('stores the theme and locale asked for, and runs the scenario’s workspace', () => {
    const { repo } = seeded({
      theme: 'light',
      locale: 'pt-BR',
      workspace: (r) => {
        r.create({ id: 'extra-page', type: 'page', parentId: null, props: { title: [['Extra']] } })
      }
    })
    try {
      expect(repo.getSetting('theme')).toBe('light')
      expect(repo.getSetting('ai.language')).toBe('pt-BR')
      expect(repo.get('extra-page')?.props.title).toEqual([['Extra']])
    } finally {
      repo.close()
    }
  })

  it('counts days in local time across a month end', () => {
    expect(localDay(new Date(2026, 9, 31, 23, 50), 1)).toBe('2026-11-01')
    expect(localDay(new Date(2026, 0, 1, 0, 5), -1)).toBe('2025-12-31')
  })
})
