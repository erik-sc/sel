import { describe, expect, it } from 'vitest'
import { NOTEBOOK_TITLES, type NotebookLocale } from '../../../shared/notebook'
import { SHORTCUT_GROUPS, shownShortcuts } from '../shortcuts/catalog'
import { CLOSE_COPY, COPY } from './copy'

/** The words the notebook went by before it was Meditations. */
const OLD_NAME = /notebook|caderno|tinta|\bink\b/i

function texts(copy: object): string[] {
  return Object.values(copy).flatMap((value: unknown) =>
    typeof value === 'string' ? [value] : Array.isArray(value) ? (value as string[]) : typeof value === 'function' ? [(value as (n: number, m?: number) => string)(2, 4)] : []
  )
}

describe('the words of Meditations', () => {
  const locales: NotebookLocale[] = ['en', 'pt-BR']

  it('name it Meditations / Meditações, and the old name nowhere', () => {
    expect(NOTEBOOK_TITLES).toEqual({ en: 'Meditations', 'pt-BR': 'Meditações' })
    for (const locale of locales) {
      expect(COPY[locale].title).toBe(NOTEBOOK_TITLES[locale])
      for (const text of [...texts(COPY[locale]), ...texts(CLOSE_COPY[locale])]) expect(text, `${locale}: ${text}`).not.toMatch(OLD_NAME)
    }
  })

  it('still say that a day stays as it was once it has ended', () => {
    expect(COPY.en.inkNote).toMatch(/midnight/)
    expect(COPY['pt-BR'].inkNote).toMatch(/meia-noite/)
  })

  it('are listed under the new name in the shortcuts, found by the old one too, on Ctrl+Alt+N', () => {
    const entry = SHORTCUT_GROUPS.flatMap((group) => group.entries).find((e) => e.id === 'open-notebook')
    expect(entry?.label).toBe('Meditations')
    const found = (query: string): string[] =>
      shownShortcuts({ mac: false, ai: true, query })
        .flatMap((group) => group.entries)
        .map((e) => `${e.label} ${e.keys.join(' / ')}`)
    for (const query of ['meditations', 'meditações', 'notebook', 'ink', 'caderno']) expect(found(query), query).toContain('Meditations Ctrl+Alt+N')
  })
})
