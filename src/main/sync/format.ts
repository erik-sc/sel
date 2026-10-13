import { createHash } from 'node:crypto'
import { LEGACY_NAME, modernizeUrls } from '../../shared/legacy'
import { canonicalJson } from '../../shared/versions'
import { isBlockType, isValidId, type Row } from '../db/blocks'
import { isPageLike, normalizeWorkspace, type SyncBlock, type Workspace } from './merge'

/**
 * What sel writes into the repository, and how it reads it back. Pure: text in, data out.
 *
 *   sel.json               what this repository is (format, and how it is encrypted)
 *   README.md                 a note for people who open the repository
 *   workspace.json            the order of the pages at the workspace root
 *   pages/<pageId>.json       one page or database with its own blocks, one block per line
 *   files/<name>              images the pages show
 *   settings/appearance.json  the appearance overrides
 *
 * Everything read from a repository is checked like any other outside data before it is used.
 */

export const FORMAT = 1
export const APP = 'sel'

export const PATHS = {
  meta: 'sel.json',
  readme: 'README.md',
  /** Used when the repository has a README of its own. */
  readmeAlt: 'SEL.md',
  workspace: 'workspace.json',
  appearance: 'settings/appearance.json',
  pages: 'pages/',
  files: 'files/'
} as const

/** Marks a README as the one sel wrote. */
export const README_MARK = '<!-- sel:managed -->'

/**
 * A repository written when the app was called Selida is the same workspace under other
 * names. It is read as it is, and the next upload from this app writes today's names.
 */
export const LEGACY = {
  app: LEGACY_NAME,
  meta: `${LEGACY_NAME}.json`,
  readmeAlt: 'SELIDA.md',
  readmeMark: `<!-- ${LEGACY_NAME}:managed -->`
} as const

export const README_TEXT = `${README_MARK}
# sel workspace

This repository is managed by sel, a local-first notes app. It holds one
person's pages so that they can be used on several devices.

**Do not edit these files by hand.** sel is the only writer: it rewrites them on every sync,
and a change made here can be overwritten or can keep a device from syncing.

- \`sel.json\`: what this repository is.
- \`workspace.json\`: the order of the top-level pages.
- \`pages/\`: one file per page or database.
- \`files/\`: images used in pages.
- \`settings/\`: appearance settings shared between devices.

If the workspace is encrypted, the files under \`pages/\`, \`files/\` and \`settings/\` are not readable
without the passphrase, and their history shows no meaningful differences.
`

const MAX_PAGE_CHARS = 256 * 1024 * 1024
const MAX_BLOCKS_PER_PAGE = 500_000
const MAX_PROPS_CHARS = 8 * 1024 * 1024

/** Raised for anything in a repository that is not what sel writes. */
export class FormatError extends Error {
  constructor(
    message: string,
    readonly newer = false
  ) {
    super(message)
  }
}

// ------------------------------------------------------------------- the meta file

export interface EncryptionParams {
  v: 1
  kdf: 'scrypt'
  N: number
  r: number
  p: number
  /** base64 */
  salt: string
  /** base64: a known text encrypted with the key, which tells a wrong passphrase apart. */
  check: string
}

export interface RepoMeta {
  app: typeof APP
  format: number
  workspaceId?: string
  createdBy?: string
  encryption?: EncryptionParams
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const BASE64_RE = /^[A-Za-z0-9+/]{1,512}={0,2}$/

export function parseMeta(text: string): RepoMeta {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new FormatError('sel.json cannot be read')
  }
  if (!isPlain(raw) || (raw['app'] !== APP && raw['app'] !== LEGACY.app) || typeof raw['format'] !== 'number') throw new FormatError('sel.json is not a sel file')
  if (raw['format'] > FORMAT) throw new FormatError('newer format', true)
  if (raw['format'] < 1) throw new FormatError('sel.json has an unknown format')
  const meta: RepoMeta = { app: APP, format: raw['format'] }
  if (typeof raw['workspaceId'] === 'string' && isValidId(raw['workspaceId'])) meta.workspaceId = raw['workspaceId']
  if (typeof raw['createdBy'] === 'string') meta.createdBy = raw['createdBy'].slice(0, 100)
  const enc = raw['encryption']
  if (enc !== undefined && enc !== null) {
    if (!isPlain(enc) || enc['v'] !== 1 || enc['kdf'] !== 'scrypt') throw new FormatError('newer format', true)
    const { N, r, p, salt, check } = enc
    const int = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    // Bounded: a tampered file must not be able to ask for gigabytes of memory.
    if (!int(N, 1 << 14, 1 << 20) || (N & (N - 1)) !== 0 || !int(r, 1, 16) || !int(p, 1, 4) || 128 * N * r > 512 * 1024 * 1024) {
      throw new FormatError('sel.json asks for an unsupported key derivation')
    }
    if (typeof salt !== 'string' || !BASE64_RE.test(salt) || typeof check !== 'string' || !BASE64_RE.test(check)) throw new FormatError('sel.json is damaged')
    meta.encryption = { v: 1, kdf: 'scrypt', N, r, p, salt, check }
  }
  return meta
}

export function serializeMeta(meta: RepoMeta): string {
  const out: Record<string, unknown> = { app: APP, format: meta.format }
  // An encrypted repository says nothing about the workspace in the clear.
  if (meta.encryption) out['encryption'] = meta.encryption
  else {
    if (meta.workspaceId) out['workspaceId'] = meta.workspaceId
    if (meta.createdBy) out['createdBy'] = meta.createdBy
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

// --------------------------------------------------------------------- pages

function stamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

/** One block as a line of a page file. The order of a schema's keys is data, and canonical JSON sorts keys: it is kept on the side. */
function blockLine(block: SyncBlock): string {
  const schema = block.props['schema']
  const line: Record<string, unknown> = {
    id: block.id,
    type: block.type,
    parentId: block.parentId,
    content: block.content,
    props: block.props,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
    trashedAt: block.trashedAt
  }
  if (isPlain(schema)) line['schemaOrder'] = Object.keys(schema)
  return canonicalJson(line)
}

/** The file of one page: its blocks sorted by id, one per line, and still one JSON document. */
export function serializePage(pageId: string, blocks: readonly SyncBlock[]): string {
  const lines = [...blocks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(blockLine)
  return `{"format":${FORMAT},"page":${JSON.stringify(pageId)},"blocks":[\n${lines.join(',\n')}\n]}\n`
}

function cleanProps(raw: unknown, order: unknown): Record<string, unknown> {
  if (raw === undefined) return {}
  if (!isPlain(raw)) throw new FormatError('A block has props that are not an object')
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    props[key] = value
  }
  const schema = props['schema']
  if (isPlain(schema) && Array.isArray(order)) {
    const ordered: Record<string, unknown> = {}
    for (const key of order) if (typeof key === 'string' && Object.hasOwn(schema, key) && key !== '__proto__') ordered[key] = schema[key]
    for (const key of Object.keys(schema)) if (!Object.hasOwn(ordered, key) && key !== '__proto__') ordered[key] = schema[key]
    props['schema'] = ordered
  }
  return props
}

/** The blocks of a page file, each checked: ids, known types, plain props within the size cap. */
export function parsePage(text: string): { pageId: string; blocks: SyncBlock[] } {
  if (text.length > MAX_PAGE_CHARS) throw new FormatError('A page file is too large')
  text = modernizeUrls(text)
  let raw: unknown
  try {
    // A key named `__proto__` has no business in a block at any depth: it is dropped while reading.
    raw = text.includes('__proto__') ? JSON.parse(text, (key, value: unknown) => (key === '__proto__' ? undefined : value)) : JSON.parse(text)
  } catch {
    throw new FormatError('A page file cannot be read')
  }
  if (!isPlain(raw) || typeof raw['format'] !== 'number' || !isValidId(raw['page']) || !Array.isArray(raw['blocks'])) throw new FormatError('A page file is damaged')
  if (raw['format'] > FORMAT) throw new FormatError('newer format', true)
  const list = raw['blocks'] as unknown[]
  if (list.length > MAX_BLOCKS_PER_PAGE) throw new FormatError('A page file is too large')
  const blocks: SyncBlock[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!isPlain(item) || !isValidId(item['id']) || seen.has(item['id'])) throw new FormatError('A page file is damaged')
    // A type this build does not know was written by a newer one: better to stop than to flatten it.
    if (!isBlockType(item['type'])) throw new FormatError('newer format', true)
    const parentId = item['parentId'] === null || item['parentId'] === undefined ? null : item['parentId']
    if (parentId !== null && !isValidId(parentId)) throw new FormatError('A page file is damaged')
    const props = cleanProps(item['props'], item['schemaOrder'])
    if (JSON.stringify(props).length > MAX_PROPS_CHARS) throw new FormatError('A block is too large')
    const content: string[] = []
    if (Array.isArray(item['content'])) for (const id of item['content']) if (isValidId(id) && !content.includes(id)) content.push(id)
    seen.add(item['id'])
    blocks.push({
      id: item['id'],
      type: item['type'],
      parentId,
      content,
      props,
      createdAt: stamp(item['createdAt']),
      updatedAt: stamp(item['updatedAt']),
      trashedAt: item['trashedAt'] === null || item['trashedAt'] === undefined ? null : stamp(item['trashedAt'])
    })
  }
  if (!seen.has(raw['page'])) throw new FormatError('A page file is damaged')
  return { pageId: raw['page'], blocks }
}

export function serializeRoot(ws: Workspace): string {
  return `${canonicalJson({ format: FORMAT, root: ws.root, rootAt: ws.rootAt ?? 0 })}\n`
}

export function parseRoot(text: string): { root: string[]; rootAt: number } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new FormatError('workspace.json cannot be read')
  }
  if (!isPlain(raw) || typeof raw['format'] !== 'number' || !Array.isArray(raw['root'])) throw new FormatError('workspace.json is damaged')
  if (raw['format'] > FORMAT) throw new FormatError('newer format', true)
  const root: string[] = []
  for (const id of raw['root']) if (isValidId(id) && !root.includes(id)) root.push(id)
  return { root, rootAt: stamp(raw['rootAt']) }
}

/** The workspace a set of page files (already parsed) and the root file describe. */
export function workspaceFromPages(pages: Iterable<readonly SyncBlock[]>, root: { root: string[]; rootAt: number } | null): Workspace {
  const blocks = new Map<string, SyncBlock>()
  for (const page of pages) for (const block of page) if (!blocks.has(block.id)) blocks.set(block.id, block)
  let order = root?.root ?? []
  // A repository without the root file (never written by sel, but harmless): pages without a parent, oldest first.
  if (!root) {
    order = [...blocks.values()]
      .filter((b) => b.parentId === null && b.trashedAt === null && isPageLike(b.type))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      .map((b) => b.id)
  }
  return normalizeWorkspace({ blocks, root: order, rootAt: root?.rootAt ?? 0 })
}

/** The blocks of each page of a (normalised) workspace: the page itself and what it holds up to the next page. */
export function pagesOf(ws: Workspace): Map<string, SyncBlock[]> {
  const owner = new Map<string, string | null>()
  const find = (id: string): string | null => {
    const path: string[] = []
    let cur: string | null = id
    let found: string | null = null
    while (cur !== null) {
      const known = owner.get(cur)
      if (known !== undefined) {
        found = known
        break
      }
      const block = ws.blocks.get(cur)
      if (!block || path.includes(cur)) break
      path.push(cur)
      if (isPageLike(block.type)) {
        found = cur
        break
      }
      cur = block.parentId
    }
    for (const step of path) owner.set(step, found)
    return found
  }
  const pages = new Map<string, SyncBlock[]>()
  for (const block of ws.blocks.values()) {
    const page = find(block.id)
    if (page === null) continue
    const list = pages.get(page)
    if (list) list.push(block)
    else pages.set(page, [block])
  }
  return pages
}

/** A page as `Repository.getTree` returns it: the page first, then what it holds in document order, nested pages named but not entered. */
export function pageTree(ws: Workspace, pageId: string): SyncBlock[] {
  const root = ws.blocks.get(pageId)
  if (!root) return []
  const out: SyncBlock[] = [root]
  const seen = new Set<string>([pageId])
  const stack: { ids: string[]; next: number }[] = [{ ids: root.content, next: 0 }]
  while (stack.length) {
    const level = stack[stack.length - 1]
    if (level.next >= level.ids.length) {
      stack.pop()
      continue
    }
    const block = ws.blocks.get(level.ids[level.next++])
    if (!block || seen.has(block.id) || block.trashedAt !== null) continue
    seen.add(block.id)
    out.push(block)
    if (!isPageLike(block.type) && block.content.length) stack.push({ ids: block.content, next: 0 })
  }
  return out
}

// ----------------------------------------------------------- from the database

/**
 * A fingerprint of each page as it is stored: the raw rows of the page and of the blocks it
 * holds. Cheap (nothing is parsed), and equal fingerprints mean an equal page file, which is
 * what lets a cycle rewrite only the files of the pages that changed.
 */
export function fingerprintPages(rows: readonly Row[]): Map<string, string> {
  const byId = new Map<string, Row>()
  for (const row of rows) byId.set(row.id, row)
  const owner = new Map<string, string | null>()
  const find = (id: string): string | null => {
    const path: string[] = []
    let cur: string | null = id
    let found: string | null = null
    const onPath = new Set<string>()
    while (cur !== null) {
      const known = owner.get(cur)
      if (known !== undefined) {
        found = known
        break
      }
      const row = byId.get(cur)
      if (!row || onPath.has(cur)) break
      onPath.add(cur)
      path.push(cur)
      if (isPageLike(row.type)) {
        found = cur
        break
      }
      cur = row.parent_id
    }
    for (const step of path) owner.set(step, found)
    return found
  }
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const page = find(row.id)
    if (page === null) continue
    const list = groups.get(page)
    if (list) list.push(row)
    else groups.set(page, [row])
  }
  const out = new Map<string, string>()
  for (const [page, list] of groups) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const hash = createHash('sha1')
    for (const r of list) hash.update(`${r.id}\u0000${r.type}\u0000${r.parent_id ?? ''}\u0000${r.content}\u0000${r.props}\u0000${r.created_at}\u0000${r.updated_at}\u0000${r.trashed_at ?? ''}\u0001`)
    out.set(page, hash.digest('hex'))
  }
  return out
}

/** The workspace the database holds, in the shape the merge works on. */
export function workspaceFromRows(rows: readonly Row[], root: { order: string[]; at: number }): Workspace {
  const blocks = new Map<string, SyncBlock>()
  for (const row of rows) {
    if (!isValidId(row.id) || !isBlockType(row.type)) continue
    let props: unknown = {}
    let content: unknown = []
    try {
      if (row.props !== '{}') props = JSON.parse(row.props)
      if (row.content !== '[]') content = JSON.parse(row.content)
    } catch {
      /* a row that cannot be read is exported as an empty block rather than not at all */
    }
    blocks.set(row.id, {
      id: row.id,
      type: row.type,
      parentId: row.parent_id,
      content: Array.isArray(content) ? content.filter((id): id is string => isValidId(id)) : [],
      props: isPlain(props) ? props : {},
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      trashedAt: row.trashed_at == null ? null : Number(row.trashed_at)
    })
  }
  return normalizeWorkspace({ blocks, root: root.order, rootAt: root.at })
}

const FILE_URL_RE = /sel(?:ida)?-file:\/\/files\/([A-Za-z0-9_-]{1,80}\.(?:png|jpe?g|gif|webp|avif|bmp))/g
export const FILE_NAME_RE = /^[A-Za-z0-9_-]{1,80}\.(?:png|jpe?g|gif|webp|avif|bmp)$/

/** Names of the stored images some text (a page file, the appearance settings) refers to. */
export function imageNames(text: string, into: Set<string> = new Set()): Set<string> {
  for (const match of text.matchAll(FILE_URL_RE)) into.add(match[1])
  return into
}

// ---------------------------------------------------------------- appearance

export interface AppearanceFile {
  updatedAt: number
  value: unknown
}

export function serializeAppearance(file: AppearanceFile): string {
  return `${canonicalJson({ format: FORMAT, updatedAt: file.updatedAt, value: file.value ?? null })}\n`
}

export function parseAppearance(text: string): AppearanceFile {
  let raw: unknown
  try {
    raw = JSON.parse(modernizeUrls(text))
  } catch {
    throw new FormatError('The appearance settings cannot be read')
  }
  if (!isPlain(raw) || typeof raw['format'] !== 'number') throw new FormatError('The appearance settings are damaged')
  if (raw['format'] > FORMAT) throw new FormatError('newer format', true)
  const value = raw['value']
  return { updatedAt: stamp(raw['updatedAt']), value: isPlain(value) ? value : null }
}

/**
 * Three-way merge of the appearance overrides: the three maps of tokens merge per token,
 * everything else as a whole; where both devices changed the same thing, the later one wins.
 */
export function mergeAppearance(base: AppearanceFile | null, local: AppearanceFile, remote: AppearanceFile | null): AppearanceFile {
  if (!remote) return local
  const same = (a: unknown, b: unknown): boolean => canonicalJson(a ?? null) === canonicalJson(b ?? null)
  const b = base?.value ?? null
  if (same(remote.value, b)) return local
  if (same(local.value, b) || same(local.value, remote.value)) return remote
  const localLater = local.updatedAt > remote.updatedAt
  if (!isPlain(local.value) || !isPlain(remote.value)) return localLater ? local : remote
  const lv = local.value
  const rv = remote.value
  const bv = isPlain(b) ? b : {}
  const pick = (bx: unknown, lx: unknown, rx: unknown): unknown => (same(lx, rx) ? lx : same(lx, bx) ? rx : same(rx, bx) ? lx : localLater ? lx : rx)
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(lv), ...Object.keys(rv)])) {
    if (key === '__proto__') continue
    const lx = lv[key]
    const rx = rv[key]
    const bx = bv[key]
    let value: unknown
    if (isPlain(lx) && isPlain(rx) && (key === 'light' || key === 'dark' || key === 'shared')) {
      const map: Record<string, unknown> = {}
      const bm = isPlain(bx) ? bx : {}
      for (const token of new Set([...Object.keys(lx), ...Object.keys(rx)])) {
        if (token === '__proto__') continue
        const v = pick(bm[token], lx[token], rx[token])
        if (v !== undefined) map[token] = v
      }
      value = map
    } else value = pick(bx, lx, rx)
    if (value !== undefined) out[key] = value
  }
  return { updatedAt: Math.max(local.updatedAt, remote.updatedAt), value: out }
}

export function sha1(text: string | Uint8Array): string {
  return createHash('sha1').update(text).digest('hex')
}
