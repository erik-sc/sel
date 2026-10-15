/**
 * The ink notebook ("Caderno de tinta"): one line a day. Shared by the main process, which
 * stores the notebook and keeps its rules, and the renderer, which shows it. Pure: no Electron,
 * no DOM, no store.
 *
 * The notebook is one built-in page (`props.system: 'notebook'`, see ./system.ts) with a fixed
 * id, so that two devices that start it on their own make the same block and sync merges them
 * into one. Each day is one block under it, also with a fixed id (`sel-notebook-2026-10-15`):
 * its `title` is the day's line, written in ink. A day can be written while it lasts and never
 * again after; the repository refuses every other change (see the notebook section of Repository), so the
 * rule holds for the window, the assistant's tools and anything else that writes, and only a
 * sync, which brings what another device wrote that same day, goes around it.
 */

import { localDay } from './briefing'
import type { BlockProps, RichText } from './types'

/** The notebook page. Never changes: every device must make the same block. */
export const NOTEBOOK_ID = 'sel-notebook'
/** A day's block is this prefix followed by the day. */
const ENTRY_PREFIX = `${NOTEBOOK_ID}-`
/** The block type of a day: a paragraph of the notebook page. */
export const NOTEBOOK_ENTRY_TYPE = 'text'

export const NOTEBOOK_LIMITS = {
  /** A line is a short paragraph at most. */
  line: 600
} as const

export const NOTEBOOK_TITLES = { en: 'Ink notebook', 'pt-BR': 'Caderno de tinta' } as const

/** The languages the notebook is written in (the same as Herman's). */
export type NotebookLocale = 'en' | 'pt-BR'

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar day written `YYYY-MM-DD`. */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DAY_RE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** The day after `day` (both `YYYY-MM-DD`). Calendar arithmetic, free of any time zone. */
export function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10)
}

/** The day before `day`. */
export function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10)
}

/**
 * Whether a day of the notebook may still be written at `now`: today and the days to come, by
 * the clock and the time zone of this computer. A day that has ended is ink.
 */
export function isDayWritable(day: unknown, now: Date | number = Date.now()): boolean {
  return isDay(day) && day >= localDay(now)
}

/** The id of a day's block. */
export function entryId(day: string): string {
  return `${ENTRY_PREFIX}${day}`
}

/** The day a block id stands for, or null when it is not a day's id. */
export function dayOfEntryId(id: unknown): string | null {
  if (typeof id !== 'string' || !id.startsWith(ENTRY_PREFIX)) return null
  const day = id.slice(ENTRY_PREFIX.length)
  return isDay(day) ? day : null
}

/** A day of the notebook as the windows see it. */
export interface NotebookEntry {
  day: string
  /** The line, as plain text. */
  text: string
  updatedAt: number
}

/** A line as it is kept: one paragraph, spaces tidied, within the limit. */
export function cleanLine(value: unknown): string {
  if (typeof value !== 'string') return ''
  return (
    value
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
      // Paragraph breaks fold into one: it is a line, a short paragraph at most.
      .replace(/\s*\n\s*/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .trim()
      .slice(0, NOTEBOOK_LIMITS.line)
      .trim()
  )
}

function plain(title: unknown): string {
  if (!Array.isArray(title)) return ''
  let out = ''
  for (const span of title as unknown[]) if (Array.isArray(span) && typeof span[0] === 'string') out += span[0]
  return out
}

/** The rich text a line is stored as: one run, no marks. Ink has no bold. */
export function lineTitle(text: string): RichText {
  return text ? [[text]] : []
}

/** A day's block read back for the windows, or null when the block is not one. */
export function readEntry(block: { id: string; props: BlockProps; updatedAt: number }): NotebookEntry | null {
  const day = dayOfEntryId(block.id)
  if (day === null) return null
  return {
    day,
    text: cleanLine(plain(block.props.title)),
    updatedAt: typeof block.updatedAt === 'number' ? block.updatedAt : 0
  }
}

/** A line written on the same date in an earlier year. */
export interface OnThisDay {
  entry: NotebookEntry
  /** How many years ago: 1 or more. */
  years: number
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * The lines written on this date in earlier years, the most recent first. On the 28th of
 * February of a year without a 29th, the 29ths of earlier years answer too: they would
 * otherwise go unseen for three years out of four.
 */
export function onThisDay(entries: readonly NotebookEntry[], today: string): OnThisDay[] {
  if (!isDay(today)) return []
  const year = Number(today.slice(0, 4))
  const monthDay = today.slice(5)
  const alsoLeapDay = monthDay === '02-28' && !isLeap(year)
  const out: OnThisDay[] = []
  for (const entry of entries) {
    if (!entry.text || !isDay(entry.day)) continue
    const then = Number(entry.day.slice(0, 4))
    if (then >= year) continue
    const md = entry.day.slice(5)
    if (md === monthDay || (alsoLeapDay && md === '02-29')) out.push({ entry, years: year - then })
  }
  return out.sort((a, b) => a.years - b.years)
}

// ---- the window's view ----------------------------------------------------------

/** What the notebook screen shows, read in one call. */
export interface NotebookView {
  locale: NotebookLocale
  /** The local day of this computer. */
  today: string
  /** Today's block, when there is one. */
  todayEntry: NotebookEntry | null
  /** Every day with a line, the most recent first. Today's is among them once written. */
  entries: NotebookEntry[]
  onThisDay: OnThisDay[]
}

export interface NotebookApi {
  /** The notebook as its screen shows it. Reading never creates anything. */
  get(): Promise<NotebookView>
  /**
   * Writes the line of `day`, which must be today: a day that has ended is refused. An empty
   * line takes it back. Starts the notebook the first time.
   */
  write(day: string, text: string): Promise<NotebookEntry>
}
