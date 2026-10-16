// Using a template: every block is made with a new id, in one transaction, with what points at
// a block rewritten; "empty" makes no rows; and what is made is read by the database engine
// exactly as it was written (no view repaired, every formula and rollup computed).
import { describe, expect, it, vi } from 'vitest'
import { getTemplate, listTemplates, TEMPLATE_IDS, TEMPLATE_LOCALES, templateNodes, type Template } from '../../shared/templates'
import { sourceIdOf } from '../../shared/linked'
import { plainText } from '../../shared/richtext'
import type { Block, PropertySchema } from '../../shared/types'
import { evaluateCalc } from '../../renderer/src/database/logic/calc'
import { cellText } from '../../renderer/src/database/logic/cell'
import { computeFormula } from '../../renderer/src/database/logic/formula'
import { normalizeDatabase } from '../../renderer/src/database/logic/normalize'
import { queryRows } from '../../renderer/src/database/logic/query'
import { cellContext, normalizeResolved, resolveDatabase } from '../../renderer/src/database/logic/resolve'
import { computeRollup } from '../../renderer/src/database/logic/rollup'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import { instantiateTemplate, planTemplate, resolveDate } from './instantiate'
import { templateRequest } from './register'

/** Every block under `rootId`, the root included, rows of databases and nested pages too. */
function everything(repo: Repository, rootId: string): Block[] {
  const out: Block[] = []
  const queue = [rootId]
  while (queue.length) {
    const block = repo.get(queue.shift() as string)
    if (!block) continue
    out.push(block)
    queue.push(...block.content)
  }
  return out
}

const titleOf = (block: Block): string => plainText(block.props.title)
const databases = (blocks: Block[]): Block[] => blocks.filter((b) => b.type === 'database' && sourceIdOf(b) === null)
const linkedViews = (blocks: Block[]): Block[] => blocks.filter((b) => sourceIdOf(b) !== null)
const exampleRows = (template: Template): number =>
  [...templateNodes(template)].reduce((sum, node) => sum + (node.kind === 'database' ? node.rows.length : 0), 0)

describe('a template, made', () => {
  it.each(TEMPLATE_IDS.flatMap((id) => TEMPLATE_LOCALES.map((locale) => [id, locale] as const)))(
    '%s (%s) is made whole, and the database engine reads it as written',
    (id, locale) => {
      const repo = openTestRepository()
      const template = getTemplate(id, locale)
      const page = instantiateTemplate(repo, template, { parentId: null, examples: true })
      expect(page.parentId).toBeNull()
      expect(titleOf(page)).toBe(plainText(template.page.props?.title))
      expect(repo.listRoot().map((b) => b.id)).toEqual([page.id])

      const blocks = everything(repo, page.id)
      const byId = new Map(blocks.map((b) => [b.id, b]))
      const lookup = { get: (blockId: string) => byId.get(blockId) }
      const ctx = cellContext(lookup)
      const nodes = [...templateNodes(template)]
      // Every node and every example row became one block.
      expect(blocks.length).toBe(nodes.length + exampleRows(template))

      for (const db of databases(blocks)) {
        const normalized = normalizeDatabase(db)
        expect([titleOf(db), normalized.changed]).toEqual([titleOf(db), false])
        const rows = db.content.map((rowId) => byId.get(rowId) as Block)
        const schema = normalized.schema
        for (const property of Object.values(schema) as PropertySchema[]) {
          for (const row of rows) {
            if (property.type === 'formula') {
              const outcome = computeFormula(row, property, ctx)
              expect([titleOf(db), property.name, titleOf(row), outcome?.ok ? 'ok' : outcome?.error]).toEqual([titleOf(db), property.name, titleOf(row), 'ok'])
            }
            if (property.type === 'rollup') expect(computeRollup(row, property, ctx), `${titleOf(db)} › ${property.name}`).not.toBeNull()
            if (property.type === 'relation') {
              // Links point at rows of the related database, and a two-way link is there on both sides.
              const target = byId.get(property.relation?.databaseId ?? '')
              const linked = (row.props.values?.[property.id] as string[] | undefined) ?? []
              for (const to of linked) {
                expect(target?.content).toContain(to)
                const partner = property.relation?.syncedPropertyId
                if (partner) expect(byId.get(to)?.props.values?.[partner]).toContain(row.id)
              }
            }
          }
        }
        for (const view of normalized.views) {
          for (const calc of view.calcs ?? []) {
            if (view.type !== 'calc') continue
            const result = evaluateCalc(calc, queryRows(rows, schema, view, '', ctx), schema)
            expect([view.name, calc.name, result.ok]).toEqual([view.name, calc.name, true])
          }
        }
      }

      for (const view of linkedViews(blocks)) {
        const resolved = resolveDatabase(view, lookup)
        expect(resolved.status).toBe('ok')
        expect(resolved.source?.parentId).not.toBeUndefined()
        const normalized = normalizeResolved(resolved)
        expect(normalized.changed).toBe(false)
        const rows = (resolved.source as Block).content.map((rowId) => byId.get(rowId) as Block)
        for (const v of normalized.views) {
          if (v.type !== 'calc') continue
          for (const calc of v.calcs ?? []) expect(evaluateCalc(calc, queryRows(rows, normalized.schema, v, '', ctx), normalized.schema).ok).toBe(true)
        }
      }
    }
  )
})

describe('instantiateTemplate', () => {
  it('gives every block a new id, so a template can be used twice without collision', () => {
    const repo = openTestRepository()
    const template = getTemplate('trip', 'en')
    const first = instantiateTemplate(repo, template, { parentId: null, examples: true })
    const second = instantiateTemplate(repo, template, { parentId: null, examples: true })
    const a = everything(repo, first.id)
    const b = everything(repo, second.id)
    expect(a.length).toBe(b.length)
    const ids = new Set(a.map((x) => x.id))
    expect(b.some((x) => ids.has(x.id))).toBe(false)
    // No id of the template survives: keys are local to it.
    const keys = new Set([...templateNodes(template)].map((n) => n.key).filter(Boolean))
    expect([...a, ...b].some((x) => keys.has(x.id))).toBe(false)
    // Each copy points at its own databases.
    for (const [blocks, own] of [
      [a, ids],
      [b, new Set(b.map((x) => x.id))]
    ] as const) {
      for (const view of linkedViews(blocks)) expect(own.has(sourceIdOf(view) as string)).toBe(true)
      for (const db of databases(blocks)) {
        for (const property of Object.values(db.props.schema ?? {})) {
          if (property.type === 'relation') expect(own.has(property.relation?.databaseId ?? '')).toBe(true)
        }
      }
    }
    expect(repo.listRoot().map((x) => x.id)).toEqual([first.id, second.id])
  })

  it('writes everything in one transaction', () => {
    const repo = openTestRepository()
    const spy = vi.spyOn(repo, 'transaction')
    instantiateTemplate(repo, getTemplate('finances', 'pt-BR'), { parentId: null, examples: true })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('leaves nothing behind when a block cannot be written', () => {
    const repo = openTestRepository()
    const broken = structuredClone(getTemplate('kitchen', 'en'))
    // The last block of the page cannot be made: the whole template is rolled back.
    broken.page.children?.push({ kind: 'block', type: 'nonsense' as 'text' })
    expect(() => instantiateTemplate(repo, broken, { parentId: null, examples: true })).toThrow(/block type/)
    expect(repo.listRoot()).toEqual([])
    expect(repo.isEmpty()).toBe(true)
  })

  it('makes no rows when used empty, but every database, view and linked view', () => {
    const repo = openTestRepository()
    for (const template of listTemplates('pt-BR')) {
      const page = instantiateTemplate(repo, template, { parentId: null, examples: false })
      const blocks = everything(repo, page.id)
      for (const db of databases(blocks)) expect([titleOf(db), db.content]).toEqual([titleOf(db), []])
      expect(blocks.length).toBe([...templateNodes(template)].filter((n) => !(n.kind === 'block' && isRowChild(template, n))).length)
      for (const view of linkedViews(blocks)) expect(normalizeResolved(resolveDatabase(view, { get: (x) => repo.get(x) ?? undefined })).changed).toBe(false)
      // A filter on example rows is left out with them, never kept pointing at nothing.
      for (const block of blocks) {
        for (const view of block.props.views ?? []) {
          for (const filter of view.filters) if (Array.isArray(filter.value)) expect(filter.value.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('puts the page inside the page it is asked to, after what is already there', () => {
    const repo = openTestRepository()
    const home = repo.create({ type: 'page', parentId: null, props: { title: [['Home']] } })
    const note = repo.create({ type: 'text', parentId: home.id, props: { title: [['A line']] } })
    const page = instantiateTemplate(repo, getTemplate('library', 'en'), { parentId: home.id, examples: false })
    expect(page.parentId).toBe(home.id)
    expect(repo.get(home.id)?.content).toEqual([note.id, page.id])
  })

  it('keeps the order of the page, linked views included', () => {
    const repo = openTestRepository()
    const template = getTemplate('finances', 'en')
    const page = instantiateTemplate(repo, template, { parentId: null, examples: true })
    const made = repo.children(page.id).map((b) => (b.type === 'database' ? (sourceIdOf(b) ? 'linked' : 'database') : b.type))
    const planned = (template.page.children ?? []).map((n) => (n.kind === 'block' ? n.type : n.kind))
    expect(made).toEqual(planned)
  })

  it('writes the ops in an order the repository accepts: a linked view after its source', () => {
    let n = 0
    const plan = planTemplate(getTemplate('project', 'pt-BR'), { parentId: null, examples: true, newId: () => `id${++n}` })
    const made = new Set<string>()
    for (const op of plan.ops) {
      if (op.op !== 'create') throw new Error('only creates')
      const source = op.input.props?.sourceId
      if (source) expect(made.has(source)).toBe(true)
      if (op.input.parentId) expect(made.has(op.input.parentId) || op.input.parentId === null).toBe(true)
      made.add(op.input.id as string)
    }
    expect(plan.rootId).toBe('id1')
  })
})

/** Whether a node belongs to an example row's own page (made only with examples). */
function isRowChild(template: Template, node: unknown): boolean {
  for (const db of [...templateNodes(template)]) {
    if (db.kind !== 'database') continue
    for (const row of db.rows) if (row.children && [...walk(row.children)].includes(node as never)) return true
  }
  return false
}

function* walk(nodes: Template['page']['children'] = []): Generator<unknown> {
  for (const node of nodes) {
    yield node
    if (node.kind === 'block') yield* walk(node.children)
  }
}

describe('resolveDate', () => {
  const today = new Date(2026, 9, 15) // Thursday 15 October 2026

  it('counts days from today, with a time and an end', () => {
    expect(resolveDate({ days: 0 }, today)).toEqual({ start: '2026-10-15' })
    expect(resolveDate({ days: 20 }, today)).toEqual({ start: '2026-11-04' })
    expect(resolveDate({ days: -16 }, today)).toEqual({ start: '2026-09-29' })
    expect(resolveDate({ days: 30, time: '22:40', endDays: 31, endTime: '12:15' }, today)).toEqual({ start: '2026-11-14T22:40', end: '2026-11-15T12:15' })
    expect(resolveDate({ days: 1, endDays: 4 }, today)).toEqual({ start: '2026-10-16', end: '2026-10-19' })
    expect(() => resolveDate({ days: 0, time: '25:00' }, today)).toThrow(/time/)
  })

  it('places a day of a month, never after today when it already happened', () => {
    expect(resolveDate({ month: 0, day: 5 }, today)).toEqual({ start: '2026-10-05' })
    expect(resolveDate({ month: 0, day: 28 }, today)).toEqual({ start: '2026-10-15' })
    expect(resolveDate({ month: -1, day: 31 }, today)).toEqual({ start: '2026-09-30' })
    expect(resolveDate({ month: -2, day: 10 }, today)).toEqual({ start: '2026-08-10' })
    expect(resolveDate({ month: 1, day: 28 }, today)).toEqual({ start: '2026-11-28' })
    expect(resolveDate({ month: -9, day: 29 }, new Date(2027, 0, 31))).toEqual({ start: '2026-04-29' })
  })

  it('finds a weekday of this week, Sunday first like the "this week" filter', () => {
    expect(resolveDate({ week: 0, weekday: 0 }, today)).toEqual({ start: '2026-10-11' })
    expect(resolveDate({ week: 0, weekday: 1 }, today)).toEqual({ start: '2026-10-12' })
    expect(resolveDate({ week: 0, weekday: 6 }, today)).toEqual({ start: '2026-10-17' })
    expect(resolveDate({ week: 1, weekday: 1 }, today)).toEqual({ start: '2026-10-19' })
    // On a Sunday the week is the one that starts that day.
    expect(resolveDate({ week: 0, weekday: 1 }, new Date(2026, 9, 18))).toEqual({ start: '2026-10-19' })
  })
})

describe('the templates:create request', () => {
  it('takes a known template, a language, examples or not and a place', () => {
    expect(templateRequest({ id: 'kitchen', locale: 'pt-BR', examples: false, parentId: null })).toEqual({ id: 'kitchen', locale: 'pt-BR', examples: false, parentId: null })
    expect(templateRequest({ id: 'trip', locale: 'en', examples: true, parentId: 'abc-123' }).parentId).toBe('abc-123')
  })

  it('refuses anything else', () => {
    expect(() => templateRequest(null)).toThrow()
    expect(() => templateRequest({ id: 'toString', locale: 'en', examples: true, parentId: null })).toThrow(/Unknown template/)
    expect(() => templateRequest({ id: 'trip', locale: 'fr', examples: true, parentId: null })).toThrow(/language/)
    expect(() => templateRequest({ id: 'trip', locale: 'en', examples: 'yes', parentId: null })).toThrow(/examples/)
    expect(() => templateRequest({ id: 'trip', locale: 'en', examples: true, parentId: '../x' })).toThrow(/parentId/)
  })
})

describe('what the examples say', () => {
  const made = (id: Parameters<typeof getTemplate>[0], locale: Parameters<typeof getTemplate>[1]) => {
    const repo = openTestRepository()
    const page = instantiateTemplate(repo, getTemplate(id, locale), { parentId: null, examples: true })
    const blocks = everything(repo, page.id)
    const byId = new Map(blocks.map((b) => [b.id, b]))
    const ctx = cellContext({ get: (x) => byId.get(x) })
    const db = (title: string): Block => databases(blocks).find((b) => titleOf(b) === title) as Block
    const rowsOf = (title: string): Block[] => db(title).content.map((x) => byId.get(x) as Block)
    const cell = (title: string, row: string, property: string): string => {
      const database = db(title)
      const r = rowsOf(title).find((x) => titleOf(x) === row) as Block
      return cellText(r, database.props.schema?.[property] as PropertySchema, ctx, { locale: locale === 'pt-BR' ? 'pt-BR' : 'en-US' })
    }
    return { cell, rowsOf }
  }

  it('finances: a category compares its budget with its average month, an account keeps its balance', () => {
    const { cell } = made('finances', 'pt-BR')
    expect(cell('Categorias', 'Moradia', 'budget')).toMatch(/R\$\s?2\.000,00/)
    expect(cell('Categorias', 'Moradia', 'average')).toMatch(/R\$/)
    expect(cell('Categorias', 'Moradia', 'status')).not.toBe('')
    expect(cell('Categorias', 'Salário', 'status')).toBe('')
    expect(cell('Contas', 'Poupança', 'balance')).toMatch(/^R\$\s?\d/)
    const en = made('finances', 'en')
    expect(en.cell('Accounts', 'Savings account', 'balance')).toMatch(/^\$\d/)
  })

  it('project: a milestone whose tasks are all done is reached', () => {
    const { cell } = made('project', 'en')
    expect(cell('Milestones', 'Discovery done', 'progress')).toBe('100%')
    expect(cell('Milestones', 'Discovery done', 'state')).toBe('Reached')
    expect(cell('Milestones', 'Site live', 'progress')).toBe('0%')
    expect(cell('Tasks', 'Choose type and colours', 'late')).toBe('Yes')
  })

  it('trip: spending in euros is converted back home', () => {
    const { cell } = made('trip', 'pt-BR')
    expect(cell('Moedas', 'Euro (€)', 'total')).toBe('1.100')
    expect(cell('Moedas', 'Euro (€)', 'home')).toMatch(/R\$\s?6\.820,00/)
  })
})
