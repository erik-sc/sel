import { describe, expect, it } from 'vitest'
import { ARCHIVE_COPY, archiveLocale } from './copy'

describe('archive copy', () => {
  it('speaks the AI answer language when it is one of the two, else the system one', () => {
    expect(archiveLocale('pt-BR', 'en-US')).toBe('pt-BR')
    expect(archiveLocale('en', 'pt-BR')).toBe('en')
    expect(archiveLocale('fr', 'pt-BR')).toBe('en')
    expect(archiveLocale(null, 'pt-BR')).toBe('pt-BR')
    expect(archiveLocale(undefined, 'pt')).toBe('pt-BR')
    expect(archiveLocale('auto', 'de-DE')).toBe('en')
    expect(archiveLocale(null, undefined)).toBe('en')
  })

  it('has every word in both languages', () => {
    const en = ARCHIVE_COPY.en
    const pt = ARCHIVE_COPY['pt-BR']
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort())
    for (const copy of [en, pt]) {
      for (const [key, value] of Object.entries(copy)) {
        const text = typeof value === 'function' ? value('3 Oct') : value
        expect(typeof text === 'string' && text.trim().length > 0, key).toBe(true)
      }
    }
    expect(pt.archive).toBe('Arquivar')
    expect(pt.unarchive).toBe('Desarquivar')
    expect(pt.section).toBe('Arquivo')
    expect(pt.badge).toBe('Arquivada')
    expect(en.badge).toBe('Archived')
  })
})
