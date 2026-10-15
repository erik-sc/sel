// The pure side of the quick-add input: what a parsed line stores, what a list adds by itself,
// where the `#project` / `@label` being typed is, and which un-recognised spans survive an edit.
import type { SelectOption } from '@shared/types'
import { TASK_PROPS } from '@shared/tasks'
import type { ParsedTask } from '@shared/tasks/parse'
import * as L from '@/database/logic'
import type { TaskListKey } from './gate'

export interface IgnoredSpan {
  start: number
  text: string
}

/** The values a parsed line gives a new row; `defaults` fill what it did not say. */
export function taskValues(parsed: ParsedTask, ids: { project: string | null; labels: string[] }, defaults: L.Values = {}): L.Values {
  const values: L.Values = { ...defaults }
  if (parsed.due) values[TASK_PROPS.due] = { start: parsed.due }
  if (parsed.priority) values[TASK_PROPS.priority] = `tasks.p${parsed.priority}`
  if (ids.project) values[TASK_PROPS.project] = ids.project
  if (ids.labels.length) {
    const current = values[TASK_PROPS.labels]
    values[TASK_PROPS.labels] = [...new Set([...(Array.isArray(current) ? current : []), ...ids.labels])]
  }
  if (parsed.recurrence) values[TASK_PROPS.recurrence] = JSON.stringify(parsed.recurrence)
  if (parsed.remind) values[TASK_PROPS.remind] = { start: parsed.remind }
  return values
}

/** What a list adds to a task typed into it: Today's date, the project or label shown. */
export function listDefaults(list: TaskListKey, today: string): L.Values {
  switch (list.kind) {
    case 'today':
      return { [TASK_PROPS.due]: { start: today } }
    case 'upcoming':
      return { [TASK_PROPS.due]: { start: L.addDays(today, 1) } }
    case 'project':
      return { [TASK_PROPS.project]: list.id }
    case 'label':
      return { [TASK_PROPS.labels]: [list.id] }
    default:
      return {}
  }
}

/**
 * Un-recognised spans after an edit: those before the change keep their place, those after it
 * move with the text, those it touched are dropped (the words changed: read them again).
 */
export function shiftIgnored(ignored: readonly IgnoredSpan[], before: string, after: string): IgnoredSpan[] {
  if (before === after) return [...ignored]
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const changedEnd = before.length - suffix
  const delta = after.length - before.length
  const out: IgnoredSpan[] = []
  for (const span of ignored) {
    const end = span.start + span.text.length
    if (end <= prefix) out.push(span)
    else if (span.start >= changedEnd) out.push({ start: span.start + delta, text: span.text })
  }
  return out
}

/** The `#name` or `@name` the caret is at the end of, while it is being typed. */
export function fragmentAt(value: string, caret: number): { sigil: '#' | '@'; start: number; text: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (/\s/u.test(ch)) return null
    if (ch === '#' || ch === '@') {
      if (i > 0 && !/\s/u.test(value[i - 1])) return null
      return { sigil: ch, start: i, text: value.slice(i + 1, caret) }
    }
  }
  return null
}

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()

/** Options matching what was typed: names that start with it first, then names that contain it. */
export function suggest(options: readonly SelectOption[], typed: string, limit = 6): SelectOption[] {
  const query = fold(typed.trim())
  const starts: SelectOption[] = []
  const contains: SelectOption[] = []
  for (const option of options) {
    const name = fold(option.name)
    if (name.startsWith(query)) starts.push(option)
    else if (name.includes(query)) contains.push(option)
  }
  return [...starts, ...contains].slice(0, limit)
}

/** Whether `typed` names one of `options` exactly (case and accents aside). */
export function findOption(options: readonly SelectOption[], typed: string): SelectOption | undefined {
  const name = fold(typed.trim())
  return options.find((option) => fold(option.name) === name)
}

/** Whether this locale writes the day before the month (`15/10`), as the parser needs to know. */
export function localeDayFirst(locale?: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2000, 10, 22))
    return parts.findIndex((part) => part.type === 'day') < parts.findIndex((part) => part.type === 'month')
  } catch {
    return true
  }
}
