import { describe, expect, it } from 'vitest'
import { cleanAiSetting } from './ai'
import {
  AI_APPLIED_KEY,
  AI_CONVERSATIONS_KEY,
  AI_HISTORY_CAPS,
  cleanAppliedLog,
  cleanConversations,
  conversationTitle,
  fitAppliedLog,
  fitConversations,
  type AppliedEntry,
  type StoredConversation
} from './aiHistory'
import type { Op } from './types'

const conversation = (id: string, updatedAt: number, text = 'hello'): StoredConversation => ({
  id,
  title: `Title ${id}`,
  createdAt: updatedAt - 10,
  updatedAt,
  pageId: null,
  messages: [
    { role: 'user', text, at: updatedAt - 5 },
    { role: 'assistant', text: `answer to ${text}`, at: updatedAt, status: 'done' }
  ]
})

const entry = (id: string, at: number, inverse: unknown[] = [{ op: 'delete', id: 'b1' }]): AppliedEntry => ({
  id,
  at,
  request: 'make a page',
  done: ['Created “Trip”'],
  skipped: [],
  pages: [{ id: 'p1', title: 'Trip' }],
  blocks: 1,
  undo: { restore: [], inverse: inverse as Op[] }
})

describe('stored conversations', () => {
  it('are settings of the AI, cleaned by main', () => {
    expect(cleanAiSetting(AI_CONVERSATIONS_KEY, [conversation('c1', 100)])).toEqual([conversation('c1', 100)])
    expect(cleanAiSetting(AI_CONVERSATIONS_KEY, 'nope')).toBeUndefined()
    expect(cleanAiSetting(AI_APPLIED_KEY, {})).toBeUndefined()
  })

  it('keep only what they can read', () => {
    const cleaned = cleanConversations([
      conversation('c1', 100),
      { id: 'bad id!', messages: [{ role: 'user', text: 'x' }] },
      { id: 'c2', messages: [] },
      {
        id: 'c3',
        updatedAt: 50,
        messages: [
          { role: 'system', text: 'x' },
          { role: 'user', text: 'kept', at: 1, extra: true }
        ]
      },
      null
    ])
    expect(cleaned?.map((entry) => entry.id)).toEqual(['c1', 'c3'])
    expect(cleaned?.[1].messages).toEqual([{ role: 'user', text: 'kept', at: 1 }])
  })

  it('keep the error, the sent note and the proposal of an answer, and drop what is not theirs', () => {
    const [cleaned] =
      cleanConversations([
        {
          ...conversation('c1', 100),
          messages: [
            { role: 'user', text: 'q', at: 1, scope: { pageId: 'page-1', today: true }, withSelection: true },
            {
              role: 'assistant',
              text: 'a',
              at: 2,
              status: 'error',
              error: { code: 'timeout', message: 'Too slow', bogus: 1 },
              sent: { context: true, pages: ['A', 3], servers: ['Veleiro'] },
              proposal: { state: 'applied', done: ['x'], skipped: [], open: 'p1', logId: 'a1' }
            }
          ]
        }
      ]) ?? []
    expect(cleaned.messages[0]).toEqual({ role: 'user', text: 'q', at: 1, scope: { pageId: 'page-1' }, withSelection: true })
    expect(cleaned.messages[1]).toEqual({
      role: 'assistant',
      text: 'a',
      at: 2,
      status: 'error',
      error: { code: 'timeout', message: 'Too slow' },
      sent: { context: true, pages: ['A'], servers: ['Veleiro'] },
      proposal: { state: 'applied', done: ['x'], skipped: [], open: 'p1', logId: 'a1' }
    })
  })

  it('are kept newest first, at most the cap, the oldest dropped to fit the size', () => {
    const many = Array.from({ length: AI_HISTORY_CAPS.conversations + 5 }, (_, index) => conversation(`c${index}`, index))
    const fitted = fitConversations(many)
    expect(fitted).toHaveLength(AI_HISTORY_CAPS.conversations)
    expect(fitted[0].id).toBe(`c${AI_HISTORY_CAPS.conversations + 4}`)

    const big = 'x'.repeat(AI_HISTORY_CAPS.messageChars)
    const heavy = Array.from({ length: 30 }, (_, index) => conversation(`h${index}`, index, big))
    const kept = fitConversations(heavy)
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(AI_HISTORY_CAPS.conversationsChars)
    expect(kept[0].id).toBe('h29')
    expect(kept.length).toBeLessThan(30)
  })

  it('cap a message and a conversation', () => {
    const long = conversation('c1', 1, 'y'.repeat(AI_HISTORY_CAPS.messageChars + 50))
    long.messages = Array.from({ length: AI_HISTORY_CAPS.messages + 4 }, () => long.messages[0])
    const [cleaned] = cleanConversations([long]) ?? []
    expect(cleaned.messages).toHaveLength(AI_HISTORY_CAPS.messages)
    expect(cleaned.messages[0].text).toHaveLength(AI_HISTORY_CAPS.messageChars)
  })

  it('are titled by their first question, on one line', () => {
    expect(conversationTitle('  What is\n this  page about? ')).toBe('What is this page about?')
    expect(conversationTitle('a'.repeat(200))).toHaveLength(AI_HISTORY_CAPS.title)
  })
})

describe('the log of what was applied', () => {
  it('keeps entries it can read, newest first', () => {
    const log = cleanAppliedLog([entry('a1', 10), entry('a2', 20), { id: 'x', at: 'later' }, { id: 'a3' }])
    expect(log?.map((item) => item.id)).toEqual(['a2', 'a1'])
    expect(cleanAppliedLog('nope')).toBeUndefined()
  })

  it('drops an undo it cannot trust, and keeps the entry', () => {
    const [bad] = cleanAppliedLog([entry('a1', 10, [{ op: 'explode', id: 'b1' }])]) ?? []
    expect(bad.undo).toBeNull()
    expect(bad.done).toEqual(['Created “Trip”'])
    const [noId] = cleanAppliedLog([entry('a1', 10, [{ op: 'update', patch: {} }])]) ?? []
    expect(noId.undo).toBeNull()
  })

  it('keeps an undone mark and the conversation', () => {
    const [kept] = cleanAppliedLog([{ ...entry('a1', 10), undoneAt: 30, conversationId: 'c1' }]) ?? []
    expect(kept).toMatchObject({ undoneAt: 30, conversationId: 'c1' })
  })

  it('drops an undo too large to keep, then the oldest entries until it fits', () => {
    const huge = Array.from({ length: 2000 }, (_, index) => ({
      op: 'update',
      id: `b${index}`,
      patch: { props: { title: [['z'.repeat(100)]] } }
    }))
    const [one] = fitAppliedLog([entry('a1', 1, huge)])
    expect(one.undo).toBeNull()
    const many = Array.from({ length: AI_HISTORY_CAPS.applied + 3 }, (_, index) => entry(`a${index}`, index))
    expect(fitAppliedLog(many)).toHaveLength(AI_HISTORY_CAPS.applied)
  })
})
