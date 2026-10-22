import { createHash } from 'node:crypto'
import { BRIEFING_LIMITS, cleanBriefingSetting, cleanCalendarLabel, isCalendarColor, type CalendarColor } from '../../shared/briefing'
import { LEGACY_NAME, modernizeUrls } from '../../shared/legacy'
import { cleanHome, type Home } from '../../shared/home'
import { cleanSidebar, type SidebarLayout } from '../../shared/sidebar'
import { canonicalJson } from '../../shared/versions'
import { hostOf, validateCalendarUrl } from '../briefing/net'
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
 *   settings/home.json        the home: the page or screen the Home button opens
 *   settings/sidebar.json     the sidebar's layout: the order of its items, which are hidden
 *   settings/calendars.json   the connected calendars with their secret addresses, and the task
 *                             databases of Today: in an encrypted repository only
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
  home: 'settings/home.json',
  sidebar: 'settings/sidebar.json',
  /** Written only when the repository is encrypted: it holds credentials. */
  calendars: 'settings/calendars.json',
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
- \`settings/\`: appearance settings and the home shared between devices; in an encrypted
  workspace, also the connected calendars and which databases hold the tasks of Today.

If the workspace is encrypted, the files under \`pages/\`, \`files/\` and \`settings/\` are not readable
without the passphrase, and their history shows no meaningful differences. A calendar's address
is a password to that calendar, so calendars are only ever written into an encrypted workspace.
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
  if (!isPlain(raw) || (raw['app'] !== APP && raw['app'] !== LEGACY.app) || typeof raw['format'] !== 'number')
    throw new FormatError('sel.json is not a sel file')
  if (raw['format'] > FORMAT) throw new FormatError('newer format', true)
  if (raw['format'] < 1) throw new FormatError('sel.json has an unknown format')
  const meta: RepoMeta = { app: APP, format: raw['format'] }
  if (typeof raw['workspaceId'] === 'string' && isValidId(raw['workspaceId'])) meta.workspaceId = raw['workspaceId']
  if (typeof raw['createdBy'] === 'string') meta.createdBy = raw['createdBy'].slice(0, 100)
  const enc = raw['encryption']
  if (enc !== undefined && enc !== null) {
    if (!isPlain(enc) || enc['v'] !== 1 || enc['kdf'] !== 'scrypt') throw new FormatError('newer format', true)
    const { N, r, p, salt, check } = enc
    const int = (value: unknown, min: number, max: number): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    // Bounded: a tampered file must not be able to ask for gigabytes of memory.
    if (!int(N, 1 << 14, 1 << 20) || (N & (N - 1)) !== 0 || !int(r, 1, 16) || !int(p, 1, 4) || 128 * N * r > 512 * 1024 * 1024) {
      throw new FormatError('sel.json asks for an unsupported key derivation')
    }
    if (typeof salt !== 'string' || !BASE64_RE.test(salt) || typeof check !== 'string' || !BASE64_RE.test(check))
      throw new FormatError('sel.json is damaged')
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
    raw = text.includes('__proto__')
      ? JSON.parse(text, (key, value: unknown) => (key === '__proto__' ? undefined : value))
      : JSON.parse(text)
  } catch {
    throw new FormatError('A page file cannot be read')
  }
  if (!isPlain(raw) || typeof raw['format'] !== 'number' || !isValidId(raw['page']) || !Array.isArray(raw['blocks']))
    throw new FormatError('A page file is damaged')
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
    while (cur !== null) {
      const known = owner.get(cur)
      if (known !== undefined) {
        found = known
        break
      }
      const row = byId.get(cur)
      // A cycle of parents (only a damaged file has one) belongs to no page. Paths are short.
      if (!row || path.includes(cur)) break
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
    // The rows of a page hashed in one go: the same bytes as one update per row, at a fraction of the calls.
    let text = ''
    for (const r of list)
      text += `${r.id}\u0000${r.type}\u0000${r.parent_id ?? ''}\u0000${r.content}\u0000${r.props}\u0000${r.created_at}\u0000${r.updated_at}\u0000${r.trashed_at ?? ''}\u0001`
    out.set(page, createHash('sha1').update(text).digest('hex'))
  }
  return out
}

/** The workspace the database holds, in the shape the merge works on. */
export function workspaceFromRows(rows: readonly Row[], root: { order: string[]; at: number }): Workspace {
  const outline = outlineFromRows(rows, root)
  outline.withProps(outline.ws.blocks.values())
  return outline.ws
}

function parsed(text: string, empty: string): unknown {
  if (text === empty) return undefined
  try {
    return JSON.parse(text)
  } catch {
    /* a row that cannot be read is exported as an empty block rather than not at all */
    return undefined
  }
}

/**
 * The workspace the database holds with every block's props left empty: where each block
 * belongs (child lists are read) without parsing what any of them says. `withProps` then
 * reads the props of the blocks given, the ones about to be written: an upload of one
 * changed page parses that page, not the workspace.
 */
export function outlineFromRows(
  rows: readonly Row[],
  root: { order: string[]; at: number }
): { ws: Workspace; withProps(blocks: Iterable<SyncBlock>): void } {
  const blocks = new Map<string, SyncBlock>()
  const raw = new Map<string, string>()
  for (const row of rows) {
    if (!isValidId(row.id) || !isBlockType(row.type)) continue
    const content = parsed(row.content, '[]')
    if (row.props !== '{}') raw.set(row.id, row.props)
    blocks.set(row.id, {
      id: row.id,
      type: row.type,
      parentId: row.parent_id,
      content: Array.isArray(content) ? content.filter((id): id is string => isValidId(id)) : [],
      props: {},
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      trashedAt: row.trashed_at == null ? null : Number(row.trashed_at)
    })
  }
  const ws = normalizeWorkspace({ blocks, root: root.order, rootAt: root.at })
  return {
    ws,
    withProps(list) {
      for (const block of list) {
        const text = raw.get(block.id)
        const props = text === undefined ? undefined : parsed(text, '{}')
        // Each block of the workspace is its own object: filling one in touches nothing else.
        block.props = isPlain(props) ? props : {}
      }
    }
  }
}

/**
 * The text of workspace.json for the database's rows, read without parsing any of them: the
 * same as `serializeRoot(workspaceFromRows(rows, root))` (the root order keeps the pages and
 * databases it names that exist and are not in the trash, each once).
 */
export function rootTextFromRows(rows: readonly Row[], root: { order: string[]; at: number }): string {
  const named = new Set(root.order)
  const live = new Set<string>()
  for (const row of rows) {
    if (named.has(row.id) && row.trashed_at == null && isValidId(row.id) && isBlockType(row.type) && isPageLike(row.type)) live.add(row.id)
  }
  const order: string[] = []
  for (const id of root.order) if (live.delete(id)) order.push(id)
  return serializeRoot({ blocks: new Map(), root: order, rootAt: root.at })
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
  const pick = (bx: unknown, lx: unknown, rx: unknown): unknown =>
    same(lx, rx) ? lx : same(lx, bx) ? rx : same(rx, bx) ? lx : localLater ? lx : rx
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

// ---------------------------------------------------------------------- home

export interface HomeFile {
  updatedAt: number
  value: Home
}

/** Written with its value even when that is null: clearing the home is a change other devices take too. */
export function serializeHome(file: HomeFile): string {
  return `${canonicalJson({ format: FORMAT, updatedAt: file.updatedAt, value: file.value ?? null })}\n`
}

export function parseHome(text: string): HomeFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new FormatError('The home setting cannot be read')
  }
  if (!isPlain(raw) || typeof raw['format'] !== 'number') throw new FormatError('The home setting is damaged')
  if (raw['format'] > FORMAT) throw new FormatError('newer format', true)
  // A home this version does not know (a screen added later) counts as none here.
  return { updatedAt: stamp(raw['updatedAt']), value: cleanHome(raw['value']) ?? null }
}

/** Three-way merge of the home, which is one value: where both devices changed it, the later change wins. */
export function mergeHome(base: HomeFile | null, local: HomeFile, remote: HomeFile | null): HomeFile {
  if (!remote) return local
  const same = (a: Home | undefined, b: Home | undefined): boolean => canonicalJson(a ?? null) === canonicalJson(b ?? null)
  if (same(remote.value, base?.value)) return local
  if (same(local.value, base?.value) || same(local.value, remote.value)) return remote
  return local.updatedAt > remote.updatedAt ? local : remote
}

// ------------------------------------------------------------------- sidebar

export interface SidebarFile {
  updatedAt: number
  /** Null is the default layout. */
  value: SidebarLayout | null
}

/** Written with its value even when that is null: going back to the default is a change other devices take too. */
export function serializeSidebar(file: SidebarFile): string {
  return `${canonicalJson({ format: FORMAT, updatedAt: file.updatedAt, value: file.value ?? null })}\n`
}

export function parseSidebar(text: string): SidebarFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new FormatError('The sidebar setting cannot be read')
  }
  if (!isPlain(raw) || typeof raw['format'] !== 'number') throw new FormatError('The sidebar setting is damaged')
  if (raw['format'] > FORMAT) throw new FormatError('newer format', true)
  // A layout that cannot be read counts as the default here.
  return { updatedAt: stamp(raw['updatedAt']), value: cleanSidebar(raw['value']) ?? null }
}

/** Three-way merge of the layout, which is one value: where both devices changed it, the later change wins. */
export function mergeSidebar(base: SidebarFile | null, local: SidebarFile, remote: SidebarFile | null): SidebarFile {
  if (!remote) return local
  const same = (a: SidebarLayout | null | undefined, b: SidebarLayout | null | undefined): boolean =>
    canonicalJson(a ?? null) === canonicalJson(b ?? null)
  if (same(remote.value, base?.value)) return local
  if (same(local.value, base?.value) || same(local.value, remote.value)) return remote
  return local.updatedAt > remote.updatedAt ? local : remote
}

// ----------------------------------------------------------------- calendars

/**
 * A connected calendar as the repository carries it, its secret address included. The address
 * is a credential: this file is only ever written into, or read from, an encrypted repository
 * (see engine.ts).
 */
export interface SyncedCalendar {
  url: string
  label: string
  color: CalendarColor
  enabled: boolean
  updatedAt: number
}

/**
 * A calendar that was removed, kept so that the removal reaches the other devices. It names the
 * calendar by a hash of its address: a removed address is not kept anywhere.
 */
export interface CalendarTombstone {
  key: string
  deletedAt: number
}

export interface CalendarsFile {
  calendars: SyncedCalendar[]
  removed: CalendarTombstone[]
  /** `briefing.databases`: the databases whose rows are the tasks of Today (null: all of them). */
  databases: { updatedAt: number; value: string[] | null }
}

/** True when there is nothing to carry: no file needs to be written for it. */
export function noCalendars(file: CalendarsFile): boolean {
  return file.calendars.length === 0 && file.removed.length === 0 && file.databases.value === null && file.databases.updatedAt === 0
}

/**
 * How the sync engine reaches this device's calendars without depending on Electron (the app
 * wires it to the briefing's store, see ../briefing/index.ts). Both calls are synchronous: the
 * engine reads, merges and writes back in one step, so no edit made meanwhile is lost.
 */
export interface CalendarSync {
  /** The calendars with their addresses, and the removals remembered. Null when this device cannot read them (no key store). */
  export(): Pick<CalendarsFile, 'calendars' | 'removed'> | null
  /** Takes the merged calendars. Throws when they could not be stored. */
  import(merged: Pick<CalendarsFile, 'calendars' | 'removed'>): void
  /** What Today shows may have changed (its task databases came from another device). */
  changed(): void
}

/** Removals remembered: a device that missed more than these may bring an old calendar back. */
export const CALENDAR_TOMBSTONES = 32
const KEY_RE = /^[0-9a-f]{64}$/

/** What a calendar is known by across devices: its normalised address, hashed. */
export function calendarKey(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

const byUrl = (a: SyncedCalendar, b: SyncedCalendar): number => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)
const byKey = (a: CalendarTombstone, b: CalendarTombstone): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/** The most recent calendars and removals within the limits, sorted: the same lists make the same file. */
function capCalendars(calendars: SyncedCalendar[], removed: CalendarTombstone[]): Pick<CalendarsFile, 'calendars' | 'removed'> {
  return {
    calendars: [...calendars]
      .sort((a, b) => b.updatedAt - a.updatedAt || byUrl(a, b))
      .slice(0, BRIEFING_LIMITS.calendars)
      .sort(byUrl),
    removed: [...removed]
      .sort((a, b) => b.deletedAt - a.deletedAt || byKey(a, b))
      .slice(0, CALENDAR_TOMBSTONES)
      .sort(byKey)
  }
}

/**
 * Calendars from outside (the repository, or this device's store on its way there), checked
 * like an address typed into the app: https only, a public host, at most
 * `BRIEFING_LIMITS.calendars` of them. What does not pass is dropped.
 */
export function cleanCalendars(
  calendars: readonly unknown[],
  removed: readonly unknown[] = []
): Pick<CalendarsFile, 'calendars' | 'removed'> {
  const live = new Map<string, SyncedCalendar>()
  for (const item of calendars.slice(0, 1000)) {
    if (!isPlain(item)) continue
    let url: URL
    try {
      // Never the loopback exception of a development build: a repository is outside data.
      url = validateCalendarUrl(item['url'])
    } catch {
      continue
    }
    const entry: SyncedCalendar = {
      url: url.href,
      label: cleanCalendarLabel(item['label'], hostOf(url)),
      color: isCalendarColor(item['color']) ? item['color'] : 'blue',
      enabled: item['enabled'] !== false,
      updatedAt: stamp(item['updatedAt'])
    }
    const seen = live.get(entry.url)
    if (!seen || entry.updatedAt > seen.updatedAt) live.set(entry.url, entry)
  }
  const gone = new Map<string, CalendarTombstone>()
  for (const item of removed.slice(0, 1000)) {
    if (!isPlain(item) || typeof item['key'] !== 'string' || !KEY_RE.test(item['key'])) continue
    const entry: CalendarTombstone = { key: item['key'], deletedAt: stamp(item['deletedAt']) }
    const seen = gone.get(entry.key)
    if (!seen || entry.deletedAt > seen.deletedAt) gone.set(entry.key, entry)
  }
  return capCalendars([...live.values()], [...gone.values()])
}

function cleanDatabases(value: unknown): string[] | null {
  const clean = cleanBriefingSetting('briefing.databases', value)
  return Array.isArray(clean) ? (clean as string[]) : null
}

export function serializeCalendars(file: CalendarsFile): string {
  return `${canonicalJson({ format: FORMAT, calendars: file.calendars, removed: file.removed, databases: { updatedAt: file.databases.updatedAt, value: file.databases.value } })}\n`
}

export function parseCalendars(text: string): CalendarsFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new FormatError('The calendars cannot be read')
  }
  if (!isPlain(raw) || typeof raw['format'] !== 'number') throw new FormatError('The calendars are damaged')
  if (raw['format'] > FORMAT) throw new FormatError('newer format', true)
  const databases = isPlain(raw['databases']) ? raw['databases'] : {}
  return {
    ...cleanCalendars(Array.isArray(raw['calendars']) ? raw['calendars'] : [], Array.isArray(raw['removed']) ? raw['removed'] : []),
    databases: { updatedAt: stamp(databases['updatedAt']), value: cleanDatabases(databases['value']) }
  }
}

/**
 * Three-way merge of the calendars, keyed by address (an id is made by each device, an address
 * is the same everywhere). Where both devices have a calendar, each field takes the side that
 * changed it, or the later edit when both did; with no base, the later entry as a whole. A
 * removal wins only over an edit older than itself. A calendar one side does not have is kept:
 * only a tombstone removes one, so a device that lost its calendars cannot remove them elsewhere.
 * The task databases merge as one value, the later change winning.
 */
export function mergeCalendars(base: CalendarsFile | null, local: CalendarsFile, remote: CalendarsFile | null): CalendarsFile {
  if (!remote) return local
  type Entry = { live: SyncedCalendar } | { gone: CalendarTombstone }
  const index = (file: CalendarsFile | null): Map<string, Entry> => {
    const out = new Map<string, Entry>()
    for (const gone of file?.removed ?? []) out.set(gone.key, { gone })
    // A calendar added again after it was removed: the newer of the two counts.
    for (const live of file?.calendars ?? []) {
      const key = calendarKey(live.url)
      const was = out.get(key)
      if (!was || !('gone' in was) || live.updatedAt >= was.gone.deletedAt) out.set(key, { live })
    }
    return out
  }
  const b = index(base)
  const l = index(local)
  const r = index(remote)
  const calendars: SyncedCalendar[] = []
  const removed: CalendarTombstone[] = []
  const put = (entry: Entry): void => void ('live' in entry ? calendars.push(entry.live) : removed.push(entry.gone))
  for (const key of new Set([...l.keys(), ...r.keys()])) {
    const le = l.get(key)
    const re = r.get(key)
    if (!le || !re) {
      put((le ?? re) as Entry)
      continue
    }
    if ('gone' in le && 'gone' in re) put(le.gone.deletedAt > re.gone.deletedAt ? le : re)
    else if ('gone' in le) put(le.gone.deletedAt > (re as { live: SyncedCalendar }).live.updatedAt ? le : re)
    else if ('gone' in re) put(re.gone.deletedAt > le.live.updatedAt ? re : le)
    else {
      const lx = le.live
      const rx = re.live
      const be = b.get(key)
      const localLater = lx.updatedAt > rx.updatedAt
      if (!be || !('live' in be)) put(localLater ? le : re)
      else {
        const bx = be.live
        const pick = <T>(bv: T, lv: T, rv: T): T => (lv === rv ? lv : lv === bv ? rv : rv === bv ? lv : localLater ? lv : rv)
        calendars.push({
          url: rx.url,
          label: pick(bx.label, lx.label, rx.label),
          color: pick(bx.color, lx.color, rx.color),
          enabled: pick(bx.enabled, lx.enabled, rx.enabled),
          updatedAt: Math.max(lx.updatedAt, rx.updatedAt)
        })
      }
    }
  }
  const same = (x: unknown, y: unknown): boolean => canonicalJson(x ?? null) === canonicalJson(y ?? null)
  const bd = base?.databases.value ?? null
  const ld = local.databases
  const rd = remote.databases
  const databases = same(rd.value, bd) ? ld : same(ld.value, bd) || same(ld.value, rd.value) ? rd : ld.updatedAt > rd.updatedAt ? ld : rd
  return { ...capCalendars(calendars, removed), databases }
}

export function sha1(text: string | Uint8Array): string {
  return createHash('sha1').update(text).digest('hex')
}
