import { describe, expect, it } from 'vitest'
import { SIDEBAR_ITEMS } from '@shared/sidebar'
import { SIDEBAR_COPY, sidebarLocale } from './sidebarCopy'

describe('the words of the sidebar', () => {
  it('name every item in both languages', () => {
    for (const copy of Object.values(SIDEBAR_COPY)) {
      expect(Object.keys(copy.items).sort()).toEqual([...SIDEBAR_ITEMS].sort())
      for (const id of SIDEBAR_ITEMS) expect(copy.items[id].trim()).not.toBe('')
    }
    expect(SIDEBAR_COPY['pt-BR'].hide).toBe('Esconder da barra lateral')
    expect(SIDEBAR_COPY['pt-BR'].customize).toBe('Personalizar barra lateral…')
    expect(`${SIDEBAR_COPY['pt-BR'].empty} · ${SIDEBAR_COPY['pt-BR'].emptyAction}`).toBe('Barra lateral vazia · Personalizar')
  })

  it('speak the language set for AI answers, else the system one', () => {
    expect(sidebarLocale('pt-BR', 'en-US')).toBe('pt-BR')
    expect(sidebarLocale('en', 'pt-BR')).toBe('en')
    expect(sidebarLocale(null, 'pt-BR')).toBe('pt-BR')
    expect(sidebarLocale(undefined, 'de-DE')).toBe('en')
  })
})
