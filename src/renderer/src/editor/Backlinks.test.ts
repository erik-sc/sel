import { describe, expect, it } from 'vitest'
import type { ChangeEvent, SearchResult } from '@shared/types'
import { changesBacklinks } from './Backlinks'

const shown: SearchResult[] = [{ id: 'link-block', pageId: 'linking-page', title: 'Linking page', path: [] }]
const change = (event: Partial<ChangeEvent>): ChangeEvent => ({ ids: ['typed'], origin: 'me', ...event })

describe('when "Linked from" looks again', () => {
  it('not for typing in this window in a block without a link', () => {
    expect(changesBacklinks(change({}), 'me', shown)).toBe(false)
    expect(changesBacklinks(change({}), 'me', [])).toBe(false)
    expect(changesBacklinks(change({ links: [] }), 'me', shown)).toBe(false)
  })

  it('for a block whose text holds or held a page link', () => {
    expect(changesBacklinks(change({ links: ['typed'] }), 'me', [])).toBe(true)
  })

  it('for any change from another window or from sync, which says nothing about links', () => {
    expect(changesBacklinks(change({ origin: 'other window' }), 'me', [])).toBe(true)
    expect(changesBacklinks(change({ origin: 'sync' }), 'me', shown)).toBe(true)
  })

  it('for a change to a page or block it shows: renamed, moved to the trash', () => {
    expect(changesBacklinks(change({ ids: ['linking-page'] }), 'me', shown)).toBe(true)
    expect(changesBacklinks(change({ ids: ['link-block'] }), 'me', shown)).toBe(true)
  })
})
