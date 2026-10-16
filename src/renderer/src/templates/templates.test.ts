import { describe, expect, it } from 'vitest'
import { getTemplate, listTemplates } from '@shared/templates'
import { TEMPLATES_COPY } from './copy'
import { templateOutline } from './outline'

describe('the gallery', () => {
  it('has every word in both languages', () => {
    expect(Object.keys(TEMPLATES_COPY.en).sort()).toEqual(Object.keys(TEMPLATES_COPY['pt-BR']).sort())
    expect(Object.keys(TEMPLATES_COPY.en.views).sort()).toEqual(Object.keys(TEMPLATES_COPY['pt-BR'].views).sort())
    expect(TEMPLATES_COPY['pt-BR'].rows(1)).toBe('1 exemplo')
    expect(TEMPLATES_COPY.en.properties(3)).toBe('3 properties')
  })

  it('outlines what a template makes, section by section', () => {
    const outline = templateOutline(getTemplate('project', 'en'))
    expect(outline[0]).toEqual({ kind: 'section', title: 'In progress' })
    expect(outline[1]).toEqual({ kind: 'linked', title: 'Tasks', source: 'Tasks', views: ['board'] })
    const tasks = outline.find((item) => item.kind === 'database' && item.title === 'Tasks')
    expect(tasks).toMatchObject({ kind: 'database', icon: 'icon:page', rows: 11, views: ['board', 'table', 'calendar'] })
  })

  it('never shows a section with nothing under it', () => {
    for (const template of [...listTemplates('en'), ...listTemplates('pt-BR')]) {
      const outline = templateOutline(template)
      outline.forEach((item, i) => {
        if (item.kind === 'section') expect(outline[i + 1]?.kind).not.toBe('section')
      })
      expect(outline.at(-1)?.kind).not.toBe('section')
      expect(outline.filter((item) => item.kind === 'database').length).toBeGreaterThanOrEqual(2)
    }
  })
})
