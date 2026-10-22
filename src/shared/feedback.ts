/**
 * Bug reports and suggestions the user writes from inside the app. Each one is a JSON file in
 * `<userData>/feedback/`, written by the main process and read back by it; the nightly
 * development agent reads the same folder, works on what is open and writes its progress into
 * the file (`status`, `resolution`). Nothing here is sent anywhere.
 *
 * Pure: no Electron, Node or React. Both sides and the tests import it.
 */

import type { InvokeChannels } from './ipc'
import type { CommandSpec } from './commands'

export type FeedbackKind = 'bug' | 'suggestion'

/**
 * `open`: written, nobody has taken it. `in-progress`: the agent is working on it.
 * `in-review`: a pull request waits for review (`resolution.pr`). `done`: merged.
 * `declined`: the agent or the user decided not to do it (`resolution.note` says why).
 */
export type FeedbackStatus = 'open' | 'in-progress' | 'in-review' | 'done' | 'declined'

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'suggestion']
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ['open', 'in-progress', 'in-review', 'done', 'declined']

/** Version of the file format; a file with another number is still read when its fields fit. */
export const FEEDBACK_SCHEMA = 1

export const FEEDBACK_LIMITS = {
  title: 200,
  description: 20_000,
  screen: 64,
  note: 4_000,
  url: 500,
  /** Files read from the folder; anything beyond is ignored, oldest first. */
  items: 1_000,
  /** One file on disk. */
  fileBytes: 256 * 1024,
  /** The last lines of the local log a report may carry, and their size together. */
  logLines: 100,
  logBytes: 64 * 1024
} as const

/** Where in the app the user was when they wrote it, and which build they ran. */
export interface FeedbackContext {
  appVersion: string
  platform: string
  /** `page`, `today`, `calendar` or `none`; never the page's title or content. */
  screen: string
}

export interface FeedbackResolution {
  /** The pull request that addresses it, an https://github.com/… url. */
  pr: string | null
  branch: string | null
  /** A line from the agent: what was done, or why not. */
  note: string | null
}

export interface FeedbackItem {
  schema: number
  id: string
  kind: FeedbackKind
  title: string
  description: string
  status: FeedbackStatus
  /** ISO 8601. */
  createdAt: string
  updatedAt: string
  context: FeedbackContext
  resolution: FeedbackResolution | null
  /** The last lines of the local log, when the user chose to attach them (src/main/log.ts). */
  log: string[] | null
}

/** What the renderer sends to create one. */
export interface FeedbackInput {
  kind: FeedbackKind
  title: string
  description: string
  screen: string
  /** Attach the last lines of the local log to the saved item. */
  attachLog: boolean
}

export interface FeedbackApi {
  /** Every item in the folder, newest first. Files that do not parse are left out. */
  list(): Promise<FeedbackItem[]>
  create(input: FeedbackInput): Promise<FeedbackItem>
  /** Deletes an item nobody has taken yet (`open`). Rejects for any other status. */
  withdraw(id: string): Promise<void>
  /** Shows the folder in the file manager. */
  openFolder(): Promise<void>
  /** The lines of the local log a report would carry now, for the user to read before attaching them. */
  logTail(): Promise<string[]>
}

const ID_RE = /^fb-\d{8}-\d{6}-[a-z0-9]{4,12}$/
const SCREEN_RE = /^[a-z][a-z0-9-]*$/

export function isFeedbackId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

/** Collapses the title to one line; keeps the description as written, line breaks included. */
function line(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Validates what the renderer sent. Throws on anything that is not exactly the expected shape. */
export function cleanFeedbackInput(raw: unknown): FeedbackInput {
  if (!isPlainObject(raw)) throw new Error('Invalid feedback')
  const { kind, title, description, screen, attachLog } = raw
  if (!oneOf(kind, FEEDBACK_KINDS)) throw new Error('Invalid feedback kind')
  if (typeof title !== 'string' || title.length > FEEDBACK_LIMITS.title * 2) throw new Error('Invalid feedback title')
  if (typeof description !== 'string' || description.length > FEEDBACK_LIMITS.description) {
    throw new Error('The description is too long')
  }
  const cleanTitle = line(title).slice(0, FEEDBACK_LIMITS.title)
  if (!cleanTitle) throw new Error('The feedback needs a title')
  const cleanScreen = typeof screen === 'string' && screen.length <= FEEDBACK_LIMITS.screen && SCREEN_RE.test(screen) ? screen : 'none'
  return { kind, title: cleanTitle, description: description.trim(), screen: cleanScreen, attachLog: attachLog === true }
}

function shortText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function isoDate(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

function githubUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > FEEDBACK_LIMITS.url) return null
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/.test(value) ? value : null
}

/**
 * Reads one file's parsed JSON. The agent edits these files by hand, so this is lenient where it
 * can be (a missing resolution, an unknown extra field) and returns null where it cannot (no id,
 * no title, an unknown status). Text is capped; a pull request link is kept only when it points
 * at github.com, since the app opens it.
 */
export function parseFeedbackItem(raw: unknown): FeedbackItem | null {
  if (!isPlainObject(raw)) return null
  const { id, kind, title, description, status, createdAt, updatedAt, context, resolution, schema, log } = raw
  if (!isFeedbackId(id) || !oneOf(kind, FEEDBACK_KINDS) || !oneOf(status, FEEDBACK_STATUSES)) return null
  const cleanTitle = typeof title === 'string' ? line(title).slice(0, FEEDBACK_LIMITS.title) : ''
  const created = isoDate(createdAt)
  if (!cleanTitle || !created) return null
  const ctx = isPlainObject(context) ? context : {}
  const res = isPlainObject(resolution) ? resolution : null
  return {
    schema: typeof schema === 'number' && Number.isInteger(schema) ? schema : FEEDBACK_SCHEMA,
    id,
    kind,
    title: cleanTitle,
    description: typeof description === 'string' ? description.slice(0, FEEDBACK_LIMITS.description) : '',
    status,
    createdAt: created,
    updatedAt: isoDate(updatedAt) ?? created,
    context: {
      appVersion: shortText(ctx.appVersion, 32) ?? 'unknown',
      platform: shortText(ctx.platform, 32) ?? 'unknown',
      screen: shortText(ctx.screen, FEEDBACK_LIMITS.screen) ?? 'none'
    },
    resolution: res && {
      pr: githubUrl(res.pr),
      branch: shortText(res.branch, 200),
      note: shortText(res.note, FEEDBACK_LIMITS.note)
    },
    log: Array.isArray(log) ? fitLog(log.filter((line): line is string => typeof line === 'string')) : null
  }
}

/** The last lines that fit the limits, oldest first. */
export function fitLog(lines: readonly string[]): string[] {
  const kept: string[] = []
  let bytes = 0
  for (let index = lines.length - 1; index >= 0 && kept.length < FEEDBACK_LIMITS.logLines; index--) {
    const line = lines[index]
    bytes += line.length + 1
    if (bytes > FEEDBACK_LIMITS.logBytes) break
    kept.unshift(line)
  }
  return kept
}

/** `fb-YYYYMMDD-HHMMSS-<random>`, in UTC: file names sort by creation time. */
export function newFeedbackId(now: Date, random: string): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  const date = `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}`
  const time = `${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}`
  return `fb-${date}-${time}-${random
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
    .padEnd(4, '0')}`
}

/** Newest first; ties (same second) by id. */
export function sortFeedback(items: FeedbackItem[]): FeedbackItem[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
}

/** The invoke channels of `api.feedback` (see `INVOKE` in ./api.ts): every method of FeedbackApi that returns a promise, and no other. */
export const FEEDBACK_INVOKE = {
  'feedback:list': true,
  'feedback:create': true,
  'feedback:withdraw': true,
  'feedback:openFolder': true,
  'feedback:logTail': true
} as const satisfies Record<InvokeChannels<{ feedback: FeedbackApi }>, true>

/** Reporting a bug or suggesting a feature (see ./commands.ts). */
export const FEEDBACK_COMMANDS = [
  {
    id: 'send-feedback',
    menu: { submenu: 'help', label: 'Report a Bug or Suggest a Feature…', order: 110 },
    palette: { title: 'Report a bug or suggest a feature…', keywords: ['feedback', 'issue', 'help'], order: 910 }
  }
] as const satisfies readonly CommandSpec[]
