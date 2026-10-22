import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '../shared/types'
import { Log, LOG_FILE, logLine, logRendererFailure, startLog, stopLogForTests } from './log'

/** Text that stands for what the user wrote: it must never reach the log. */
const MARK = 'PAGE-TEXT-7f3a'
const FEED = 'https://calendar.example.com/private-abc123/basic.ics'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sel-log-'))
})

afterEach(() => {
  stopLogForTests()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const page: Block = {
  id: 'p1',
  type: 'page',
  parentId: null,
  content: ['b1'],
  props: { title: [[`Diary ${MARK}`]] },
  createdAt: 1,
  updatedAt: 1,
  trashedAt: null
}

function everything(): string {
  return readdirSync(dir)
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n')
}

describe('the log', () => {
  it('turns over at the size limit and keeps three files', () => {
    const log = new Log(dir, { maxBytes: 2_000, now: () => new Date(Date.UTC(2026, 9, 22)) })
    for (let index = 0; index < 200; index++) log.write('error', `[test] line ${index} failed`)
    const files = readdirSync(dir).sort()
    expect(files).toEqual(['sel.1.log', 'sel.2.log', LOG_FILE])
    for (const file of files) expect(statSync(join(dir, file)).size).toBeLessThanOrEqual(2_000)
    // The newest lines are in sel.log; the oldest ones are gone.
    expect(readFileSync(join(dir, LOG_FILE), 'utf8')).toContain('line 199 failed')
    expect(everything()).not.toContain('line 0 failed')
    const tail = log.tail(5)
    expect(tail).toHaveLength(5)
    expect(tail.at(-1)).toMatch(/line 199 failed$/)
    expect(tail[0]).toMatch(/line 195 failed$/)
  })

  it('reads the tail across the turn-over', () => {
    const log = new Log(dir, { maxBytes: 300 })
    for (let index = 0; index < 8; index++) log.write('error', `[test] number ${index}`)
    expect(log.tail(6).map((line) => line.split(' ').at(-1))).toEqual(['2', '3', '4', '5', '6', '7'])
  })

  it('never holds what a page says, nor a calendar address', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const log = startLog(dir)
    // What the main process logs today: a developer's message, then whatever failed.
    console.error('[ipc] blocks:apply failed', page)
    console.error('[sync] could not read', [page], { title: MARK })
    console.error('[calendar] the feed failed', new Error(`fetch ${FEED} returned 404`))
    console.error(`[calendar] could not read ${FEED}`)
    console.error('[ipc] a write failed for', 'p1', `title "${MARK}"`)
    const cause = new Error('inner', { cause: new Error(`while reading ${FEED}`) })
    console.error('[db] failed', cause)
    logRendererFailure({
      message: "Couldn't save that change. It was undone.",
      error: { name: 'Error', message: 'SQLITE_FULL', stack: '' }
    })

    const text = everything()
    expect(text).not.toContain(MARK)
    expect(text).not.toContain('private-abc123')
    expect(text).not.toContain('calendar.example.com')
    // The shape of each failure is there.
    expect(text).toContain('[ipc] blocks:apply failed <object>')
    expect(text).toContain('[sync] could not read <array> <object>')
    expect(text).toContain('Error: fetch <url> returned 404')
    expect(text).toContain('[ipc] a write failed for p1 <text>')
    expect(text).toContain('[renderer] Couldn')
    expect(text).toContain('SQLITE_FULL')
    expect(log.tail(100)).toHaveLength(7)
    expect(quiet).toHaveBeenCalledTimes(6)
  })

  it('keeps an error its name, code and stack frames on one line', () => {
    const error = Object.assign(new Error('no space'), { code: 'ENOSPC' })
    const line = logLine('error', ['[data] the backup was not made', error], new Date(0))
    expect(line).toMatch(/^1970-01-01T00:00:00.000Z error \[data\] the backup was not made Error ENOSPC: no space \| at /)
    expect(line).not.toContain('\n')
  })

  it('keeps only the file name of each stack frame', () => {
    const error = new Error('locked')
    error.stack = [
      'Error: locked',
      '    at Fc.write (C:\\Users\\someone\\AppData\\Local\\Programs\\sel\\resources\\app.asar\\out\\main\\index.js:26:5957)',
      '    at file:///home/someone/sel/out/renderer/assets/index-Df4.js:3:10',
      '    at async Promise.all (index 0)',
      '    at async Session.<anonymous> (node:electron/js2c/browser_init:1:119972)'
    ].join('\n')
    const line = logLine('error', ['[ipc] failed', error], new Date(0))
    expect(line).not.toContain('someone')
    expect(line).toContain('at Fc.write (index.js:26:5957)')
    expect(line).toContain('at index-Df4.js:3:10')
    expect(line).toContain('at async Promise.all (index 0)')
    expect(line).toContain('(node:electron/js2c/browser_init:1:119972)')
  })

  it('still prints, and a write that fails does not throw', () => {
    const printed: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => printed.push(args)
    try {
      writeFileSync(join(dir, 'a-file'), '')
      startLog(join(dir, 'a-file', 'logs'))
      expect(() => console.error('[test] nowhere to write')).not.toThrow()
      expect(printed).toEqual([['[test] nowhere to write']])
    } finally {
      stopLogForTests()
      console.error = original
    }
  })
})
