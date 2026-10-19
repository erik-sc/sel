import { describe, expect, it } from 'vitest'
import type { ChangeEvent } from '../shared/types'
import { ChangeFeed } from './changes'

function feed(): { feed: ChangeFeed; sent: ChangeEvent[]; turns: (() => void)[] } {
  const sent: ChangeEvent[] = []
  const turns: (() => void)[] = []
  return {
    feed: new ChangeFeed(
      (c) => sent.push(c),
      (flush) => turns.push(flush)
    ),
    sent,
    turns
  }
}

describe('ChangeFeed', () => {
  it('merges a burst from one origin into one event with each id once', () => {
    const { feed: f, sent, turns } = feed()
    f.add('a', ['1', '2'])
    f.add('a', ['2', '3'])
    f.add('a', [])
    expect(sent).toEqual([])
    expect(turns).toHaveLength(1)
    turns[0]()
    expect(sent).toEqual([{ origin: 'a', ids: ['1', '2', '3'] }])
  })

  it('carries the pages reset by a restore, each once, to the origin that restored', () => {
    const { feed: f, sent, turns } = feed()
    f.add('a', ['1', 'p'], ['p'])
    f.add('a', ['2'], ['p', 'q'])
    f.add('b', ['3'])
    turns[0]()
    expect(sent).toEqual([
      { origin: 'a', ids: ['1', 'p', '2'], reset: ['p', 'q'] },
      { origin: 'b', ids: ['3'] }
    ])
    f.add('a', ['4'])
    turns[1]()
    expect(sent[2]).toEqual({ origin: 'a', ids: ['4'] })
  })

  it('keeps origins apart and schedules again after a flush', () => {
    const { feed: f, sent, turns } = feed()
    f.add('a', ['1'])
    f.add('b', ['1', '9'])
    turns[0]()
    expect(sent).toEqual([
      { origin: 'a', ids: ['1'] },
      { origin: 'b', ids: ['1', '9'] }
    ])
    f.add('a', ['4'])
    expect(turns).toHaveLength(2)
    turns[1]()
    expect(sent[2]).toEqual({ origin: 'a', ids: ['4'] })
  })

  it('sends nothing for reads and survives a failing delivery', () => {
    const turns: (() => void)[] = []
    const sent: string[] = []
    const f = new ChangeFeed(
      (c) => {
        if (c.origin === 'bad') throw new Error('window gone')
        sent.push(c.origin)
      },
      (flush) => turns.push(flush)
    )
    f.add('a', [])
    expect(turns).toHaveLength(0)
    f.add('bad', ['1'])
    f.add('good', ['1'])
    turns[0]()
    expect(sent).toEqual(['good'])
  })
})
