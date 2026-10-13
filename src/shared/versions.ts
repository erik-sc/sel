import type { BlockProps, BlockType, PropertyValue, RichText } from './types'

/**
 * Version history: the shapes shared by the main process (which captures, stores and
 * restores versions) and the renderer (which lists, previews and compares them).
 *
 * A version is a snapshot of ONE page's own content. Nested pages and databases are only
 * referenced (they have histories of their own); a database's snapshot holds its schema and
 * views plus the title, icon and values of each row, never a row's body.
 */

/** `sync`: kept when a sync replaced something that was changed on two devices. */
export type VersionKind = 'auto' | 'manual' | 'restore' | 'daily' | 'sync'

export interface VersionInfo {
  id: string
  pageId: string
  createdAt: number
  kind: VersionKind
  label: string | null
  blockCount: number
  textSize: number
}

/** One block of a snapshot. The root comes first; its `parentId` is always null. */
export interface SnapshotBlock {
  id: string
  type: BlockType
  parentId: string | null
  /** Ordered child ids: other snapshot blocks, references (`refs`) or rows (`rows`). */
  content: string[]
  props: BlockProps
  createdAt: number
}

/** A nested page or database: recorded by reference only. */
export interface SnapshotRef {
  id: string
  type: 'page' | 'database'
  title: string
  icon?: string
}

/** A row of a snapshotted database: what the database shows of it, not its body. */
export interface SnapshotRow {
  id: string
  title: RichText
  icon?: string
  values: Record<string, PropertyValue>
  createdAt: number
}

export interface SnapshotContent {
  rootId: string
  /** Pre-order, root first. */
  blocks: SnapshotBlock[]
  refs: SnapshotRef[]
  /** Only when the root is a database that owns rows; in row order. */
  rows?: SnapshotRow[]
}

export interface VersionSnapshot extends SnapshotContent {
  /** Null for the live state of a page (`versions.current`). */
  info: VersionInfo | null
}

export type RestoreMode = 'replace' | 'copy'

export interface RestoreResult {
  /** The page that now shows the version: the same page (replace) or the new copy. */
  pageId: string
  /** The version holding the state from just before a replace-restore; null for a copy. */
  backupId: string | null
  /** Plain sentences about what could not be brought back (pages deleted forever…). */
  notes: string[]
}

export interface VersionStats {
  count: number
  bytes: number
  /** Stored versions that can no longer be read. */
  damaged: number
}

export interface HistorySettings {
  enabled: boolean
  sessionMinutes: number
  maxPerPage: number
  budgetMb: number
}

export const HISTORY_DEFAULTS: HistorySettings = { enabled: true, sessionMinutes: 10, maxPerPage: 300, budgetMb: 200 }

export const HISTORY_LIMITS = {
  sessionMinutes: { min: 1, max: 1440 },
  maxPerPage: { min: 10, max: 5000 },
  budgetMb: { min: 10, max: 10_000 }
} as const

export const HISTORY_KEYS = ['history.enabled', 'history.sessionMinutes', 'history.maxPerPage', 'history.budgetMb'] as const
export type HistoryKey = (typeof HISTORY_KEYS)[number]

export const MAX_VERSION_LABEL = 120

/** A value a history setting accepts, or undefined when it does not. */
export function cleanHistorySetting(key: string, value: unknown): boolean | number | undefined {
  if (key === 'history.enabled') return typeof value === 'boolean' ? value : undefined
  const name = key.slice('history.'.length) as keyof typeof HISTORY_LIMITS
  const range = Object.hasOwn(HISTORY_LIMITS, name) ? HISTORY_LIMITS[name] : undefined
  if (!range || typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

/**
 * Deterministic JSON: object keys sorted, `undefined` dropped, nothing else changed.
 * Two values that are equal as data serialize to the same text whatever order their keys
 * were written in, which is what makes the hash of a snapshot comparable.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : 'null'
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(record).sort()) {
    const item = record[key]
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`)
  }
  return `{${parts.join(',')}}`
}
