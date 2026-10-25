import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type Scenario, select, validate } from './registry'

const run = async (): Promise<void> => {}
const scenario = (id: string, extra: Partial<Scenario> = {}): Scenario => ({ id, description: `the ${id}`, run, ...extra })

describe('the registered scenarios', () => {
  it('load from every file in scenarios/, with unique kebab-case ids, and include the five starters', async () => {
    const dir = fileURLToPath(new URL('./scenarios/', import.meta.url))
    const files: Record<string, unknown> = {}
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      files[file] = ((await import(`${dir}${file}`)) as { default: unknown }).default
    }
    const ids = validate(files).map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining(['today', 'page-notes', 'tasks-table', 'tasks-board', 'tasks-calendar']))
  })
})

describe('validate', () => {
  it('names every problem: duplicates across files, bad ids, missing parts', () => {
    const files = {
      'a.ts': [scenario('one'), scenario('Two_Bad'), scenario('all')],
      'b.ts': [scenario('one'), { id: 'three', description: '' }, scenario('four', { themes: [] })],
      'c.ts': 'not a list'
    }
    expect(() => validate(files)).toThrowError(
      /Two_Bad[\s\S]*"all"[\s\S]*"one" is already defined in a\.ts[\s\S]*"three" has no description[\s\S]*"three" has no run[\s\S]*"four" has themes[\s\S]*c\.ts: the default export/
    )
  })

  it('returns the scenarios of all files', () => {
    expect(validate({ 'b.ts': [scenario('b')], 'a.ts': [scenario('a')] }).map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('select', () => {
  const all = [scenario('today'), scenario('page-notes'), scenario('tasks-table')]

  it('keeps the block order and reports unknown ids', () => {
    const { chosen, unknown } = select(['tasks-table', 'nope-not-a-scenario', 'today'], all)
    expect(chosen.map((s) => s.id)).toEqual(['tasks-table', 'today'])
    expect(unknown).toEqual(['nope-not-a-scenario'])
  })

  it('expands all to every scenario, once', () => {
    expect(select(['today', 'all'], all).chosen.map((s) => s.id)).toEqual(['today', 'page-notes', 'tasks-table'])
  })
})
