/**
 * Reading a Todoist project export (Settings → Backups, or "Export as CSV" on a project): one CSV
 * per project, with the columns TYPE, CONTENT, DESCRIPTION, PRIORITY, INDENT, AUTHOR, RESPONSIBLE,
 * DATE, DATE_LANG, TIMEZONE… Pure: text in, tasks out; the caller writes them.
 *
 *  - TYPE `task` is a task, `note` a comment on the task before it, `section` a heading (left
 *    out), an empty TYPE a blank line;
 *  - PRIORITY counts the other way round: 4 is p1, 1 is p4;
 *  - INDENT 2 is a subtask of the task above with INDENT 1, and so on;
 *  - labels are written into CONTENT as `@label`;
 *  - DATE is the due date as Todoist would show it ("every monday", "Oct 16 2026 9:00 AM",
 *    "16 out 2026"), read with the quick-add parser, which knows English and Portuguese.
 *
 * The content is outside data: sizes are capped and nothing here throws on any input.
 */
import { parseTask, type TaskRecurrence } from '../../shared/tasks/parse'

export const TODOIST_LIMITS = {
  /** Bytes of one file. */
  file: 5 * 1024 * 1024,
  /** Tasks taken from one file. */
  tasks: 5_000,
  title: 500,
  text: 10_000
} as const

export interface TodoistTask {
  title: string
  /** The description, then each comment: the page's text. */
  notes: string[]
  priority: 1 | 2 | 3 | 4 | null
  due: string | null
  recurrence: TaskRecurrence | null
  labels: string[]
  /** Index (in the returned list) of the task this is a subtask of. */
  parent: number | null
  /** The DATE as written, when it could not be read. */
  unreadDate: string | null
}

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF, a byte-order mark. Rows past `maxRows` are dropped. */
export function parseCsv(text: string, maxRows = 50_000): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      if (rows.length >= maxRows) return rows
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const LABEL_RE = /(^|\s)@([^\s@]+)/gu

/** The labels written into a task's content, and the content without them. */
function splitLabels(content: string): { title: string; labels: string[] } {
  const labels: string[] = []
  const title = content.replace(LABEL_RE, (_match, space: string, label: string) => {
    const clean = label.replace(/[.,;:!?]+$/u, '').slice(0, 100)
    if (clean && !labels.includes(clean)) labels.push(clean)
    return space
  })
  return { title: title.replace(/\s+/gu, ' ').trim(), labels }
}

export function readTodoistCsv(text: string, now: Date): { tasks: TodoistTask[]; skipped: number } {
  const rows = parseCsv(text.slice(0, TODOIST_LIMITS.file))
  const header = (rows.shift() ?? []).map((name) => name.trim().toUpperCase())
  const column = (name: string): number => header.indexOf(name)
  const at = (row: string[], name: string): string => {
    const index = column(name)
    return index >= 0 ? (row[index] ?? '').trim() : ''
  }
  const tasks: TodoistTask[] = []
  let skipped = 0
  if (column('TYPE') < 0 || column('CONTENT') < 0) return { tasks, skipped: rows.length }

  /** The last task seen at each indent level: where a subtask hangs. */
  const levels: number[] = []
  for (const row of rows) {
    const type = at(row, 'TYPE').toLowerCase()
    if (type === 'note') {
      const note = at(row, 'CONTENT').slice(0, TODOIST_LIMITS.text)
      const last = tasks[tasks.length - 1]
      if (last && note) last.notes.push(note)
      else skipped++
      continue
    }
    if (type !== 'task') {
      if (row.some((cell) => cell.trim())) skipped++
      continue
    }
    if (tasks.length >= TODOIST_LIMITS.tasks) {
      skipped++
      continue
    }
    const { title, labels } = splitLabels(at(row, 'CONTENT').slice(0, TODOIST_LIMITS.title * 2))
    const priorityNumber = Number(at(row, 'PRIORITY'))
    const priority = priorityNumber >= 1 && priorityNumber <= 4 ? ((5 - priorityNumber) as 1 | 2 | 3 | 4) : null
    const indent = Math.min(Math.max(Number(at(row, 'INDENT')) || 1, 1), 10)
    const date = at(row, 'DATE').slice(0, 200)
    const language = at(row, 'DATE_LANG').toLowerCase()
    // US English writes the month first; everything Todoist exports in other languages, the day.
    const parsed = date ? parseTask(date, { now, dayFirst: language !== 'en' }) : null
    const read = parsed && (parsed.due || parsed.recurrence) ? parsed : null
    levels.length = indent - 1
    const parent = indent > 1 ? (levels[indent - 2] ?? null) : null
    const description = at(row, 'DESCRIPTION').slice(0, TODOIST_LIMITS.text)
    tasks.push({
      title: title.slice(0, TODOIST_LIMITS.title) || 'Untitled',
      notes: description ? [description] : [],
      priority: priority === 4 ? null : priority,
      due: read?.due ?? null,
      recurrence: read?.recurrence ?? null,
      labels,
      parent,
      unreadDate: date && !read ? date : null
    })
    levels[indent - 1] = tasks.length - 1
  }
  return { tasks, skipped }
}

/** A project name from an export's file name: "Work [2203306141].csv" → "Work". */
export function projectNameOf(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/u, '').replace(/\.csv$/iu, '')
  return (
    base
      .replace(/\s*\[\d+\]\s*$/u, '')
      .trim()
      .slice(0, 100) || 'Todoist'
  )
}
