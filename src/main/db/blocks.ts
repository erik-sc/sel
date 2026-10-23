import { randomUUID } from 'node:crypto'
import type { Block, BlockProps, BlockType } from '../../shared/types'

/**
 * Block rows: the stored shape, its conversion to `Block`, and the checks every
 * value passes before it is written. Pure functions, no database access.
 */

export const BLOCK_TYPES: readonly BlockType[] = [
  'page',
  'text',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list',
  'numbered_list',
  'to_do',
  'toggle',
  'quote',
  'callout',
  'code',
  'divider',
  'image',
  'bookmark',
  'database',
  'equation'
]
const BLOCK_TYPE_SET: ReadonlySet<string> = new Set(BLOCK_TYPES)

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** Size caps are measured on the stored JSON text, in UTF-16 code units. */
const MAX_PROPS_CHARS = 8 * 1024 * 1024
export const MAX_SETTING_CHARS = 1024 * 1024
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

export function isBlockType(type: unknown): type is BlockType {
  return typeof type === 'string' && BLOCK_TYPE_SET.has(type)
}

/** Pages and databases: the navigable units that go to the trash instead of being removed. */
export function isPageLike(type: string): boolean {
  return type === 'page' || type === 'database'
}

export interface Row {
  id: string
  type: string
  parent_id: string | null
  content: string
  props: string
  created_at: number
  updated_at: number
  trashed_at: number | null
}

export const COLS = 'id, type, parent_id, content, props, created_at, updated_at, trashed_at'
/** The same columns qualified with the table alias `b`, for joins. */
export const B_COLS = COLS.split(', ')
  .map((c) => `b.${c}`)
  .join(', ')

export function parseJson<T>(text: string, fallback: T): T {
  try {
    const value = JSON.parse(text)
    return value ?? fallback
  } catch {
    return fallback
  }
}

/** The ordered child ids stored in a row's `content` column; anything malformed is dropped. */
export function parseContent(text: string): string[] {
  // Most blocks are leaves: skip the parser for them.
  if (text === '[]') return []
  const content = parseJson<unknown>(text, [])
  return Array.isArray(content) ? content.filter((x): x is string => typeof x === 'string') : []
}

export function parseProps(text: string): BlockProps {
  if (text === '{}') return {}
  const props = parseJson<unknown>(text, {})
  return props && typeof props === 'object' && !Array.isArray(props) ? (props as BlockProps) : {}
}

export function toBlock(row: Row): Block {
  return {
    id: row.id,
    // A row with a type this build does not know (corruption, a newer version) degrades to text.
    type: isBlockType(row.type) ? row.type : 'text',
    parentId: row.parent_id,
    content: parseContent(row.content),
    props: parseProps(row.props),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    trashedAt: row.trashed_at == null ? null : Number(row.trashed_at)
  }
}

export function assertId(id: unknown, what = 'id'): asserts id is string {
  if (!isValidId(id)) throw new Error(`Invalid ${what}`)
}

export function assertType(type: unknown): asserts type is BlockType {
  if (!isBlockType(type)) throw new Error(`Invalid block type: ${String(type)}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Same check without narrowing, for values that already have a static type. */
export const isPlain = (value: unknown): boolean => isPlainObject(value)

/** Shallow merge where `null` removes a key and `undefined` leaves it untouched. */
export function mergeProps(base: BlockProps, patch: unknown): BlockProps {
  if (patch === undefined) return base
  if (!isPlainObject(patch)) throw new Error('props must be an object')
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    if (value === undefined) continue
    if (value === null) delete out[key]
    else out[key] = value
  }
  return out as BlockProps
}

export function serializeProps(props: BlockProps): string {
  const text = JSON.stringify(props)
  if (typeof text !== 'string') throw new Error('props are not serializable')
  if (text.length > MAX_PROPS_CHARS) throw new Error('props are too large')
  return text
}

export function defaultDatabaseProps(props: BlockProps): BlockProps {
  if (props.schema && props.views) return props
  const schema = props.schema ?? { title: { id: 'title', name: 'Name', type: 'title' as const } }
  const views = props.views ?? [
    {
      id: randomUUID(),
      name: 'Table',
      type: 'table' as const,
      visibleProperties: Object.keys(schema),
      filters: [],
      sorts: []
    }
  ]
  return { ...props, schema, views }
}

/** A node of a block tree to insert in one go (see Repository.createTree). */
export interface TreeInput {
  /**
   * The id the block gets, for a caller that must link to it before it exists (an import whose
   * pages link to each other); it must be new. Absent: a fresh one.
   */
  id?: string
  type: BlockType
  props?: BlockProps
  children?: TreeInput[]
}
