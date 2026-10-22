/**
 * The notebook: one line a day, and the ritual that closes the day.
 * notebook = Meditations / Meditações in the UI (named "Ink notebook" before 0.6.0); the code,
 * the ids, the IPC channels and the settings kept the old name.
 * Shared by the main process, which stores the notebook and keeps its rules, and the renderer,
 * which shows it. Pure: no Electron, no DOM, no store.
 *
 * The notebook is one built-in page (`props.system: 'notebook'`, see ./system.ts) with a fixed
 * id, so that two devices that start it on their own make the same block and sync merges them
 * into one. Each day is one block under it, also with a fixed id (`sel-notebook-2026-10-15`):
 * its `title` is the day's line, written in ink. A day can be written while it lasts and never
 * again after; the repository refuses every other change (see the notebook section of Repository), so the
 * rule holds for the window, the assistant's tools and anything else that writes, and only a
 * sync, which brings what another device wrote that same day, goes around it.
 *
 * A day's block may also carry `plans`: up to three things the day before set aside for it when
 * it was closed. They show on the Today screen until they are put away (`plansDismissed`).
 */

import { localDay } from './briefing'
import type { BlockProps, RichText } from './types'
import type { SettingsSpec } from './settings'
import type { InvokeChannels } from './ipc'
import type { CommandSpec } from './commands'

/** The notebook page. Never changes: every device must make the same block. */
export const NOTEBOOK_ID = 'sel-notebook'
/** A day's block is this prefix followed by the day. */
const ENTRY_PREFIX = `${NOTEBOOK_ID}-`
/** The block type of a day: a paragraph of the notebook page. */
export const NOTEBOOK_ENTRY_TYPE = 'text'

export const NOTEBOOK_LIMITS = {
  /** A line is a short paragraph at most. */
  line: 600,
  plans: 3,
  plan: 160,
  /** Pages and completed tasks the closing ritual lists. */
  review: 8
} as const

export const NOTEBOOK_TITLES = { en: 'Meditations', 'pt-BR': 'Meditações' } as const

/** The titles the notebook page was given before 0.6.0, each with the one that replaces it. */
const LEGACY_TITLES: Readonly<Record<string, string>> = {
  'Ink notebook': NOTEBOOK_TITLES.en,
  'Caderno de tinta': NOTEBOOK_TITLES['pt-BR']
}

/**
 * The title the notebook page takes when it still has its old default one, exactly as it was
 * made (one run, no marks), or null to leave it alone: a title the user wrote is theirs. The
 * new title follows from the old one only, never from this device's language, so that every
 * device renames it to the same value and sync has nothing to merge.
 */
export function renamedNotebookTitle(title: unknown): RichText | null {
  if (!Array.isArray(title) || title.length !== 1) return null
  const span: unknown = title[0]
  if (!Array.isArray(span) || span.length !== 1 || typeof span[0] !== 'string') return null
  const renamed = Object.hasOwn(LEGACY_TITLES, span[0]) ? LEGACY_TITLES[span[0]] : undefined
  return renamed ? [[renamed]] : null
}

/** The languages the notebook and the ritual are written in (the same as Herman's). */
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
  /** The line, as plain text. Empty when the day has only plans. */
  text: string
  /** What the day before set aside for this one. */
  plans: string[]
  plansDismissed: boolean
  updatedAt: number
}

/** A line as it is kept: one paragraph, spaces tidied, within the limit. */
export function cleanLine(value: unknown): string {
  if (typeof value !== 'string') return ''
  return (
    value
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
      // Paragraph breaks fold into one: it is a line, a short paragraph at most.
      .replace(/\s*\n\s*/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .trim()
      .slice(0, NOTEBOOK_LIMITS.line)
      .trim()
  )
}

/** Up to three plans, each a short line; blank ones are dropped. */
export function cleanPlans(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value.slice(0, 20) as unknown[]) {
    if (typeof item !== 'string') continue
    const text = item
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NOTEBOOK_LIMITS.plan)
      .trim()
    if (text) out.push(text)
    if (out.length >= NOTEBOOK_LIMITS.plans) break
  }
  return out
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
  const props = block.props as BlockProps & { plans?: unknown; plansDismissed?: unknown }
  return {
    day,
    text: cleanLine(plain(props.title)),
    plans: cleanPlans(props.plans),
    plansDismissed: props.plansDismissed === true,
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
  /** Today's block, when there is one (it may have plans and no line yet). */
  todayEntry: NotebookEntry | null
  /** Every day with a line, the most recent first. Today's is among them once written. */
  entries: NotebookEntry[]
  onThisDay: OnThisDay[]
}

/** A completed task as the closing ritual lists it. */
export interface DayReviewItem {
  id: string
  title: string
  /** The page to open: the row itself, or the page a to-do is on. */
  pageId: string
}

/** What happened today, as far as the workspace knows: read-only, and short. */
export interface DayReview {
  locale: NotebookLocale
  today: string
  completed: DayReviewItem[]
  /** Pages edited today, the most recent first. */
  edited: DayReviewItem[]
  /** Today's line, when it has one, and tomorrow's plans when they were set already. */
  line: string
  tomorrowPlans: string[]
}

export interface NotebookApi {
  /** The notebook as its screen shows it. Reading never creates anything. */
  get(): Promise<NotebookView>
  /**
   * Writes the line of `day`, which must be today: a day that has ended is refused. An empty
   * line takes it back. Starts the notebook the first time.
   */
  write(day: string, text: string): Promise<NotebookEntry>
  /** Sets the things set aside for `day`, a day to come (tomorrow, from the closing ritual). */
  plan(day: string, items: string[]): Promise<NotebookEntry>
  /** Puts away today's plans: the Today screen stops showing them. */
  dismissPlans(day: string): Promise<void>
  /** What happened today, for the first step of closing the day. */
  review(): Promise<DayReview>
}

// ---- settings -----------------------------------------------------------------

/** Whether closing the day rings a soft bell. On unless turned off. */
export const NOTEBOOK_BELL_KEY = 'notebook.bell'
/** The keys a renderer may write. */
export const NOTEBOOK_KEYS = [NOTEBOOK_BELL_KEY] as const
export type NotebookKey = (typeof NOTEBOOK_KEYS)[number]

/** The value a notebook setting accepts from a renderer, or undefined when it does not. */
export function cleanNotebookSetting(key: string, value: unknown): unknown {
  switch (key) {
    case NOTEBOOK_BELL_KEY:
      return typeof value === 'boolean' ? value : undefined
    default:
      return undefined
  }
}

/** The bell rings unless the user turned it off. */
export function bellOn(stored: unknown): boolean {
  return cleanNotebookSetting(NOTEBOOK_BELL_KEY, stored) !== false
}

/** Whether closing the day rings a bell: a boolean. */
export const NOTEBOOK_SETTINGS: SettingsSpec = { keys: NOTEBOOK_KEYS, clean: cleanNotebookSetting }

/** The invoke channels of `api.notebook` (see `INVOKE` in ./api.ts): every method of NotebookApi that returns a promise, and no other. */
export const NOTEBOOK_INVOKE = {
  'notebook:get': true,
  'notebook:write': true,
  'notebook:plan': true,
  'notebook:dismissPlans': true,
  'notebook:review': true
} as const satisfies Record<InvokeChannels<{ notebook: NotebookApi }>, true>

/** The ways to Meditations and to the closing of the day (see ./commands.ts). */
export const NOTEBOOK_COMMANDS = [
  {
    id: 'open-notebook',
    // N for notebook. Ctrl+N is a new page, Ctrl+Shift+N a new window.
    shortcut: { accelerator: 'CmdOrCtrl+Alt+N', key: 'n', ctrl: true, alt: true },
    menu: { submenu: 'view', label: 'Meditations', order: 250 },
    palette: {
      title: 'Meditations',
      keywords: [
        'meditações',
        'journal',
        'diary',
        'line a day',
        'on this day',
        'notebook',
        'ink',
        'ink notebook',
        'caderno',
        'caderno de tinta',
        'diário'
      ],
      order: 100
    },
    catalog: {
      group: 'navigation',
      label: 'Meditations',
      keywords: ['meditações', 'journal', 'diary', 'notebook', 'ink', 'caderno'],
      order: 170
    }
  },
  {
    id: 'close-day',
    menu: { submenu: 'view', label: 'Close the Day', order: 270 },
    palette: {
      title: 'Close the day',
      keywords: ['evening', 'end', 'review', 'tomorrow', 'shutdown', 'fechar o dia', 'até amanhã'],
      order: 120
    }
  }
] as const satisfies readonly CommandSpec[]
