/**
 * CSV as Notion writes it and as sel's export writes it (RFC 4180): commas, fields in double
 * quotes when they hold a comma, a quote or a line break, quotes doubled inside them. A byte
 * order mark at the start is dropped. Pure.
 */

/** The rows of a CSV text; each row its fields. Empty lines are skipped. */
export function parseCsv(source: string): string[][] {
  const text = source.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const endRow = (): void => {
    row.push(field)
    field = ''
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') {
      quoted = true
      i++
    } else if (ch === ',') {
      row.push(field)
      field = ''
      i++
    } else if (ch === '\r' || ch === '\n') {
      endRow()
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += ch
      i++
    }
  }
  if (field !== '' || row.length) endRow()
  return rows
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** A CSV text from rows of fields, lines ended with CRLF as RFC 4180 says, with a byte order mark so spreadsheets read it as UTF-8. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `﻿${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`
}
