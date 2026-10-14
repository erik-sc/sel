import { describe, expect, it } from 'vitest'
import { RECENT_LIMIT, noteRecent, rankCommands, readRecent, scoreCommand, scoreWord } from './match'

const commands = [
  { id: 'new-page', title: 'New page', keywords: ['create', 'add'] },
  { id: 'new-tab', title: 'New tab' },
  { id: 'toggle-theme', title: 'Toggle theme', keywords: ['dark mode', 'light'] },
  { id: 'settings-general', title: 'Settings: General', keywords: ['preferences'] },
  { id: 'settings-sync', title: 'Settings: Sync', keywords: ['preferences', 'git'] },
  { id: 'today', title: 'Today' },
  { id: 'prefs', title: 'Preferências do usuário' },
  { id: 'renew', title: 'Renew licence' }
]

const ids = (query: string, recent: string[] = []): string[] => rankCommands(commands, query, recent).map((r) => r.command.id)

describe('scoreWord', () => {
  it('ranks the start of the text over a later word over the middle of a word', () => {
    expect(scoreWord('new page', 'new')).toBe(100)
    expect(scoreWord('new page', 'page')).toBe(80)
    expect(scoreWord('renew licence', 'new')).toBe(50)
  })

  it('takes the best of several occurrences', () => {
    expect(scoreWord('renew new', 'new')).toBe(80)
  })

  it('finds letters in order below any match as written', () => {
    const fuzzy = scoreWord('toggle theme', 'tgth')
    expect(fuzzy).toBeGreaterThan(0)
    expect(fuzzy).toBeLessThan(50)
    expect(scoreWord('toggle theme', 'xyz')).toBe(0)
    expect(scoreWord('toggle theme', 'emt')).toBe(0)
  })

  it('still finds letters in order when jumping to a word start would skip them', () => {
    expect(scoreWord('xa c a', 'ac')).toBeGreaterThan(0)
  })

  it('does not find letters scattered through the middle of words', () => {
    expect(scoreWord('report a bug or suggest a feature', 'page')).toBe(0)
    expect(scoreWord('use the light theme', 'thme')).toBeGreaterThan(0)
  })

  it('finds nothing for an empty word', () => {
    expect(scoreWord('anything', '')).toBe(0)
  })
})

describe('scoreCommand', () => {
  it('needs every word of the query', () => {
    expect(scoreCommand(commands[0], 'new page')).toBeGreaterThan(0)
    expect(scoreCommand(commands[0], 'new window')).toBe(0)
  })

  it('finds a command by its keywords, a little below its title', () => {
    expect(scoreCommand(commands[2], 'dark')).toBeGreaterThan(0)
    expect(scoreCommand(commands[2], 'dark')).toBeLessThan(scoreCommand(commands[2], 'toggle'))
  })

  it('does not find keywords by letters in order only', () => {
    expect(scoreCommand(commands[2], 'drkmd')).toBe(0)
  })

  it('ignores case and accents', () => {
    expect(scoreCommand(commands[6], 'PREFERENCIAS')).toBe(100)
    expect(scoreCommand(commands[6], 'usuario')).toBe(80)
  })
})

describe('rankCommands', () => {
  it('lists everything in order for an empty query', () => {
    expect(ids('')).toEqual(commands.map((c) => c.id))
    expect(ids('   ')).toEqual(commands.map((c) => c.id))
  })

  it('puts recently used commands first for an empty query, most recent first', () => {
    const ranked = rankCommands(commands, '', ['today', 'missing', 'new-tab'])
    expect(ranked.slice(0, 3).map((r) => [r.command.id, r.recent])).toEqual([
      ['today', true],
      ['new-tab', true],
      ['new-page', false]
    ])
    expect(ranked).toHaveLength(commands.length)
  })

  it('orders matches best first and leaves out what does not match', () => {
    expect(ids('new')).toEqual(['new-page', 'new-tab', 'renew'])
    expect(ids('sync')).toEqual(['settings-sync'])
  })

  it('finds a phrase spanning words', () => {
    expect(ids('settings sy')).toEqual(['settings-sync'])
    expect(ids('settings:')[0]).toBe('settings-general')
  })

  it('lets a recently used command float above an equal match', () => {
    expect(ids('new', ['new-tab'])).toEqual(['new-tab', 'new-page', 'renew'])
    expect(rankCommands(commands, 'new', ['new-tab'])[0].recent).toBe(true)
  })

  it('does not let recency beat a much better match', () => {
    // "renew" has "new" inside a word (50 + 30 for being recent) against "New page" (100).
    expect(ids('new', ['renew'])[0]).toBe('new-page')
  })
})

describe('recent list', () => {
  it('moves a run command to the front and keeps the list short', () => {
    expect(noteRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    const long = Array.from({ length: RECENT_LIMIT }, (_, i) => `c${i}`)
    const next = noteRecent(long, 'new')
    expect(next).toHaveLength(RECENT_LIMIT)
    expect(next[0]).toBe('new')
    expect(next).not.toContain(`c${RECENT_LIMIT - 1}`)
  })

  it('cleans a stored list', () => {
    expect(readRecent(null)).toEqual([])
    expect(readRecent('new-page')).toEqual([])
    expect(readRecent(['a', 3, 'a', '', 'b', { id: 'c' }])).toEqual(['a', 'b'])
    expect(readRecent(Array.from({ length: 20 }, (_, i) => `c${i}`))).toHaveLength(RECENT_LIMIT)
  })
})
