// Every template, held to what makes one sound (./check.ts), in both languages.
import { describe, expect, it } from 'vitest'
import { formulaRefs, templateProblems, templateShape } from './check'
import { getTemplate, listTemplates, TEMPLATE_IDS, TEMPLATE_LOCALES, templateDatabases, type Template } from './index'

describe.each(TEMPLATE_IDS)('the %s template', (id) => {
  const pt = getTemplate(id, 'pt-BR')
  const en = getTemplate(id, 'en')

  it.each([pt, en])('points only at what it holds, and its views read properties that exist ($locale)', (template) => {
    expect(templateProblems(template)).toEqual([])
  })

  it('has the same structure in Portuguese and in English', () => {
    expect(templateShape(pt)).toEqual(templateShape(en))
  })

  it('is told apart by its words: a name, one line, an icon and examples in each language', () => {
    for (const template of [pt, en]) {
      expect(template.name).not.toBe('')
      expect(template.description.length).toBeLessThan(110)
      expect(template.description).not.toContain('\n')
      expect(template.icon).toMatch(/^[a-z]+$/)
      expect(template.page.props?.icon).toBe(`icon:${template.icon}`)
      expect(templateDatabases(template).every((db) => db.rows.length > 0)).toBe(true)
    }
    expect(pt.name).not.toBe(en.name)
  })

  it('is written in its own language (no database or row is left untranslated by mistake)', () => {
    const titles = (template: Template): string[] => templateDatabases(template).map((db) => db.title)
    expect(titles(pt)).not.toEqual(titles(en))
  })

  it('names in its formulas only properties of their own database', () => {
    for (const db of templateDatabases(pt)) {
      for (const property of Object.values(db.schema)) {
        if (property.type === 'formula') expect(formulaRefs(property.formula?.expression ?? '').every((ref) => ref in db.schema)).toBe(true)
      }
    }
  })
})

describe('the templates', () => {
  it('are the seven of the release, in the same order in both languages', () => {
    for (const locale of TEMPLATE_LOCALES) {
      expect(listTemplates(locale).map((t) => t.id)).toEqual(['finances', 'household', 'trip', 'project', 'library', 'studies', 'kitchen'])
      expect(listTemplates(locale).every((t) => t.locale === locale)).toBe(true)
    }
  })

  it('never use the built-in Tasks database or Meditations', () => {
    for (const locale of TEMPLATE_LOCALES) {
      for (const template of listTemplates(locale)) expect(JSON.stringify(template)).not.toMatch(/"system"|_notebook|"sourceId"/)
    }
  })

  it('catch a template that points outside itself', () => {
    const template = structuredClone(getTemplate('project', 'en'))
    const tasks = templateDatabases(template).find((db) => db.key === 'tasks')
    if (!tasks) throw new Error('no tasks')
    tasks.schema.milestone = { ...tasks.schema.milestone, relation: { databaseId: 'nowhere' } }
    tasks.views[0] = { ...tasks.views[0], visibleProperties: ['title', 'ghost'] }
    tasks.rows[0] = { ...tasks.rows[0], values: { ...tasks.rows[0].values, status: 'unknown-option' } }
    const problems = templateProblems(template).join('\n')
    expect(problems).toMatch(/relation "milestone" points at no database/)
    expect(problems).toMatch(/shows "ghost"/)
    expect(problems).toMatch(/"unknown-option" is not an option/)
  })
})
