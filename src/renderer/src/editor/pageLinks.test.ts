import { describe, expect, it } from 'vitest'
import type { SearchResult } from '@shared/types'
import { PAGE_SUGGESTIONS, pageSuggestions, readLinkInput } from './pageLinks'

const hit = (pageId: string, id = pageId): SearchResult => ({ id, pageId, title: pageId, path: [] })

describe('readLinkInput', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['https://example.com', 'url'],
    ['sel://page/abc', 'url'],
    ['mailto:a@example.com', 'url'],
    ['example.com', 'address'],
    ['example.com/', 'address'],
    ['ana@example.com', 'address'],
    ['Reunião', 'words'],
    ['projeto atlas', 'words'],
    ['Pauta: reunião', 'words'],
    ['notas de 1.2', 'words']
  ])('%j reads as %s', (text, kind) => {
    expect(readLinkInput(text)).toBe(kind)
  })
})

describe('pageSuggestions', () => {
  it('offers each page once, never the one being edited, at most a few', () => {
    const results = [hit('a'), hit('here'), hit('a', 'block-in-a'), hit('b'), ...Array.from({ length: 10 }, (_, i) => hit(`p${i}`))]
    const offered = pageSuggestions(results, 'here').map((r) => r.pageId)
    expect(offered).toEqual(['a', 'b', 'p0', 'p1', 'p2', 'p3'])
    expect(offered).toHaveLength(PAGE_SUGGESTIONS)
    expect(pageSuggestions([], null)).toEqual([])
  })
})
