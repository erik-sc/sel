/**
 * CSV, and the database a CSV table becomes: which type each column gets, and the values.
 */
import { describe, expect, it } from 'vitest'
import { csvToDatabase, parseDateText } from './columns'
import { parseCsv, toCsv } from './csv'

describe('csv', () => {
  it('reads quotes, doubled quotes, commas and line breaks inside fields, and a byte order mark', () => {
    expect(parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\n\nlast,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\nlines'],
      ['last', '', '']
    ])
  })

  it('writes what it reads back', () => {
    const rows = [
      ['Name', 'Notes'],
      ['A, B', 'quote " here'],
      [' padded ', 'line\nbreak']
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})

describe('dates', () => {
  it('are read as Notion and sel write them', () => {
    expect(parseDateText('October 22, 2026')).toBe('2026-10-22')
    expect(parseDateText('Oct 2, 2026 3:05 PM')).toBe('2026-10-02T15:05')
    expect(parseDateText('October 2, 2026 12:00 AM')).toBe('2026-10-02T00:00')
    expect(parseDateText('2026-10-22')).toBe('2026-10-22')
    expect(parseDateText('2026/1/5')).toBe('2026-01-05')
    expect(parseDateText('2026-10-22T09:30')).toBe('2026-10-22T09:30')
    expect(parseDateText('2026-02-30')).toBeNull()
    expect(parseDateText('Someday 3, 2026')).toBeNull()
    expect(parseDateText('soon')).toBeNull()
  })
})

describe('a CSV table as a database', () => {
  it('gives each column the type its values fit', () => {
    const db = csvToDatabase(
      ['Name', 'Status', 'Tags', 'Due', 'Done', 'Estimate', 'Link', 'Notes'],
      [
        [
          'Write spec',
          'In progress',
          'docs, urgent',
          'October 22, 2026 → October 24, 2026',
          'No',
          '3',
          'https://a.example',
          'Long, winding text'
        ],
        ['Ship it', 'Done', 'urgent', 'October 30, 2026 3:00 PM', 'Yes', '5.5', 'https://b.example', 'More words here'],
        ['Celebrate', 'Done', '', '', 'No', '', '', '']
      ]
    )
    const types = Object.values(db.schema).map((p) => [p.name, p.type])
    expect(types).toEqual([
      ['Name', 'title'],
      ['Status', 'select'],
      ['Tags', 'multi_select'],
      ['Due', 'date'],
      ['Done', 'checkbox'],
      ['Estimate', 'number'],
      ['Link', 'url'],
      ['Notes', 'text']
    ])
    const [first, second, third] = db.rows
    const status = db.schema.p1
    expect(status.options?.map((o) => o.name)).toEqual(['In progress', 'Done'])
    expect(first.title).toBe('Write spec')
    expect(first.values.p1).toBe(status.options?.[0].id)
    expect((first.values.p2 as string[]).length).toBe(2)
    expect(first.values.p3).toEqual({ start: '2026-10-22', end: '2026-10-24' })
    expect(second.values.p3).toEqual({ start: '2026-10-30T15:00' })
    expect(first.values.p4).toBe(false)
    expect(second.values.p4).toBe(true)
    expect(second.values.p5).toBe(5.5)
    expect(third.values.p5).toBeUndefined()
    expect(first.values.p7).toBe('Long, winding text')
    expect(db.views[0].visibleProperties).toEqual(Object.keys(db.schema))
  })

  it('names columns that have no name, and keeps names apart', () => {
    const db = csvToDatabase(['', 'A', 'a', ''], [['x', '1', '2', '3']])
    expect(Object.values(db.schema).map((p) => p.name)).toEqual(['Name', 'A', 'a (2)', 'Column 4'])
  })
})
