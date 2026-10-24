import { describe, expect, it } from 'vitest'
import { parseBlock, planFor, sameBlock } from './block'

const fence = '```'

describe('parseBlock', () => {
  it('finds no block in a body without one, or without a body', () => {
    expect(parseBlock('Fixes the board.\n\n```ts\nconst a = 1\n```\n')).toBeNull()
    expect(parseBlock('')).toBeNull()
    expect(parseBlock(null)).toBeNull()
    expect(parseBlock(undefined)).toBeNull()
  })

  it('reads ids with and without text, skipping blank lines', () => {
    const body = `Intro\n\n${fence}screens\ntoday: the Today screen\n\n  tasks-board\npage-notes:   notes, dark\n${fence}\nafter`
    expect(parseBlock(body)).toEqual({ ids: ['today', 'tasks-board', 'page-notes'] })
  })

  it('keeps the word all', () => {
    expect(parseBlock(`${fence}screens\nall\n${fence}`)).toEqual({ ids: ['all'] })
  })

  it('reads only the first block and ignores a second one', () => {
    const body = `${fence}screens\ntoday: one\n${fence}\n\n${fence}screens\ntasks-table: two\n${fence}`
    expect(parseBlock(body)).toEqual({ ids: ['today'] })
  })

  it('does not take another language for the block, and accepts CRLF and a space before the info string', () => {
    expect(parseBlock(`${fence}screensaver\ntoday\n${fence}`)).toBeNull()
    expect(parseBlock(`${fence} screens\r\ntoday: x\r\n${fence}\r\n`)).toEqual({ ids: ['today'] })
  })

  it('reads an unclosed block to the end, and drops repeated ids', () => {
    expect(parseBlock(`${fence}screens\ntoday\ntoday: again`)).toEqual({ ids: ['today'] })
  })

  it('keeps ids it cannot know, for the capture to report', () => {
    expect(parseBlock(`${fence}screens\nnope-not-a-scenario: x\n${fence}`)).toEqual({ ids: ['nope-not-a-scenario'] })
  })
})

describe('planFor', () => {
  const body = (ids: string): string => `Text\n${fence}screens\n${ids}\n${fence}`

  it('captures on opened and synchronize when there is a block', () => {
    expect(planFor({ action: 'opened', pull_request: { body: body('today: x') } })).toMatchObject({ capture: true, ids: ['today'] })
    expect(planFor({ action: 'synchronize', pull_request: { body: body('today') } }).capture).toBe(true)
  })

  it('does nothing without a block, or with an empty one', () => {
    expect(planFor({ action: 'opened', pull_request: { body: 'no block' } }).capture).toBe(false)
    expect(planFor({ action: 'opened', pull_request: { body: body('') } }).capture).toBe(false)
  })

  it('on an edit, captures only when the block changed', () => {
    const now = body('today: x\ntasks-table')
    expect(planFor({ action: 'edited', pull_request: { body: now }, changes: { body: { from: `${now}\nmore words` } } }).capture).toBe(
      false
    )
    expect(
      planFor({ action: 'edited', pull_request: { body: now }, changes: { body: { from: body('today: other words\ntasks-table') } } })
        .capture
    ).toBe(false)
    expect(planFor({ action: 'edited', pull_request: { body: now } }).capture).toBe(false)
    expect(planFor({ action: 'edited', pull_request: { body: now }, changes: { body: { from: body('today') } } }).capture).toBe(true)
    expect(planFor({ action: 'edited', pull_request: { body: now }, changes: { body: { from: 'none' } } }).capture).toBe(true)
  })

  it('compares blocks by their ids in order', () => {
    expect(sameBlock({ ids: ['a', 'b'] }, { ids: ['a', 'b'] })).toBe(true)
    expect(sameBlock({ ids: ['a', 'b'] }, { ids: ['b', 'a'] })).toBe(false)
    expect(sameBlock(null, null)).toBe(true)
    expect(sameBlock(null, { ids: [] })).toBe(false)
  })
})
