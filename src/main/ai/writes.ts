import { sourceIdOf } from '../../shared/linked'
import type { Block, PropertySchema, PropertyValue, RichText } from '../../shared/types'
import type { Repository } from '../db/repository'
import { normalizeDatabase } from '../../renderer/src/database/logic/normalize'
import { findOption, sanitizeValue } from '../../renderer/src/database/logic/values'
import { label, live, pathOf, titleOf, ToolError } from './tools'

/**
 * The workspace tools that write (see ./toolspecs.ts, WRITE_TOOL_SPECS), for the apps the user
 * connected in Settings (../external). Herman never gets them: what he changes is a proposal the
 * user applies in the window.
 *
 * Every change goes through the repository's public methods, as an edit made in the window
 * does: its checks apply (built-in blocks among them), the page's previous state goes into its
 * history as for any edit, and the caller tells the windows and sync what changed. Nothing here
 * deletes; a value set to null is cleared, and that is all that is ever taken away.
 */

/** What the writing tools need: the repository, and the Markdown importer they write pages with. */
export interface WriteTarget {
  repo: Repository
  markdown: Pick<typeof import('../markdown'), 'importMarkdownText' | 'appendMarkdownText'>
}

const MAX_TITLE = 2000
/** Options a refusal lists when a value names none of them. */
const LISTED_OPTIONS = 20

function args(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function idArg(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ToolError(`Say which ${what}, by id.`)
  return value.trim()
}

function markdownArg(value: unknown, required: boolean): string {
  if (value === undefined || value === null) {
    if (required) throw new ToolError('Give the Markdown to add.')
    return ''
  }
  if (typeof value !== 'string') throw new ToolError('The Markdown must be a string.')
  return value
}

/** A live page (not a database) the text can go into. */
function pageFor(repo: Repository, id: string): Block {
  const block = repo.get(id)
  if (!live(block)) throw new ToolError('No page has that id.')
  if (block.type === 'database') throw new ToolError(`${label(block)} is a database: add a row to it with add_database_row.`)
  return block
}

/** The database rows are kept in: the database itself, or the source of a linked view. */
function databaseFor(repo: Repository, id: string): Block {
  const block = repo.get(id)
  if (!live(block) || block.type !== 'database') throw new ToolError('No database has that id.')
  const sourceId = sourceIdOf(block)
  if (sourceId === null) return block
  const source = repo.get(sourceId)
  if (!live(source) || source.type !== 'database') throw new ToolError(`${label(block)} shows a database that is gone.`)
  return source
}

// ---- values ------------------------------------------------------------------

const COMPUTED = new Set<PropertySchema['type']>(['created_time', 'last_edited_time', 'rollup', 'formula'])

/** The property a name given by the caller means: its exact name, else the one name that matches ignoring case, else its id. */
function propertyNamed(properties: readonly PropertySchema[], name: string): PropertySchema | undefined {
  const exact = properties.find((property) => property.name === name)
  if (exact) return exact
  const loose = properties.filter((property) => property.name.trim().toLowerCase() === name.trim().toLowerCase())
  if (loose.length === 1) return loose[0]
  return properties.find((property) => property.id === name)
}

function optionId(property: PropertySchema, value: unknown): string {
  if (typeof value !== 'string') throw new ToolError(`${property.name}: name one of its options.`)
  const options = property.options ?? []
  const found =
    options.find((option) => option.name === value) ??
    options.find((option) => option.name.trim().toLowerCase() === value.trim().toLowerCase()) ??
    findOption(property, value)
  if (found) return found.id
  const names = options.slice(0, LISTED_OPTIONS).map((option) => `“${option.name}”`)
  throw new ToolError(
    names.length
      ? `${property.name} has no option “${value.slice(0, 60)}”. Its options: ${names.join(', ')}${options.length > LISTED_OPTIONS ? ', …' : ''}.`
      : `${property.name} has no options yet: add them in sel first.`
  )
}

/** The value stored for `property` from what the caller gave. Throws a ToolError that says what is wrong. */
function storedValue(repo: Repository, property: PropertySchema, value: unknown): PropertyValue {
  if (value === null) return null
  if (COMPUTED.has(property.type)) throw new ToolError(`${property.name} is computed: it cannot be set.`)
  switch (property.type) {
    case 'text':
    case 'url':
      if (typeof value !== 'string' && typeof value !== 'number') throw new ToolError(`${property.name}: give a string.`)
      return sanitizeValue(property, value)
    case 'number': {
      const number = typeof value === 'string' && value.trim() ? Number(value) : value
      if (typeof number !== 'number' || !Number.isFinite(number)) throw new ToolError(`${property.name}: give a number.`)
      return number
    }
    case 'checkbox':
      if (value === true || value === 'true' || value === 'yes') return true
      if (value === false || value === 'false' || value === 'no') return false
      throw new ToolError(`${property.name}: give true or false.`)
    case 'select':
      return optionId(property, value)
    case 'multi_select': {
      const names = Array.isArray(value) ? value : [value]
      const ids = [...new Set(names.map((name) => optionId(property, name)))]
      return ids.length ? ids : null
    }
    case 'date': {
      const clean = sanitizeValue(property, value)
      if (clean === null)
        throw new ToolError(`${property.name}: a date is "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm", or {"start", "end"} with those.`)
      return clean
    }
    case 'relation': {
      if (property.relation?.syncedPropertyId) throw new ToolError(`${property.name} links both ways: change it in sel.`)
      const ids = Array.isArray(value) ? value : [value]
      const target = property.relation?.databaseId
      for (const id of ids) {
        const row = typeof id === 'string' ? repo.get(id) : null
        if (!row || row.type !== 'page' || row.trashedAt !== null || row.parentId !== target) {
          throw new ToolError(
            `${property.name}: ${typeof id === 'string' ? `[${id.slice(0, 64)}]` : 'that'} is not a row of the database it links to.`
          )
        }
      }
      const clean = sanitizeValue(property, ids)
      if (property.relation?.limit === 'one' && ids.length > 1) throw new ToolError(`${property.name} links to one row at most.`)
      return clean
    }
    default:
      throw new ToolError(`${property.name} cannot be set.`)
  }
}

interface RowChange {
  title?: RichText
  /** By property id; null clears. */
  values: Record<string, PropertyValue>
  /** The properties named, as the database calls them. */
  names: string[]
}

/** The caller's values, by property name, checked against the database's properties. */
function rowChange(repo: Repository, database: Block, raw: unknown): RowChange {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolError('Give the values as an object of property names.')
  const properties = Object.values(normalizeDatabase(database).schema)
  const change: RowChange = { values: {}, names: [] }
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const property = propertyNamed(properties, name)
    if (!property) {
      const names = properties.filter((p) => !COMPUTED.has(p.type)).map((p) => `“${p.name}”`)
      throw new ToolError(`${titleOf(database)} has no property “${name.slice(0, 60)}”. Its properties: ${names.join(', ')}.`)
    }
    if (change.names.includes(property.name)) throw new ToolError(`${property.name} is given twice.`)
    change.names.push(property.name)
    if (property.type === 'title') {
      if (value !== null && typeof value !== 'string') throw new ToolError(`${property.name}: give a string.`)
      const text = typeof value === 'string' ? value.trim().slice(0, MAX_TITLE) : ''
      change.title = text ? [[text]] : []
      continue
    }
    change.values[property.id] = storedValue(repo, property, value)
  }
  return change
}

/** Stored values with the change applied: null clears a value. */
function merged(before: Record<string, PropertyValue> | undefined, change: Record<string, PropertyValue>): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = { ...(before ?? {}) }
  for (const [id, value] of Object.entries(change)) {
    if (value === null) delete out[id]
    else out[id] = value
  }
  return out
}

// ---- the tools -----------------------------------------------------------------

function createPage({ repo, markdown }: WriteTarget, a: Record<string, unknown>): string {
  const parent = a['parent'] === undefined || a['parent'] === null ? null : pageFor(repo, idArg(a['parent'], 'page'))
  if (a['title'] !== undefined && a['title'] !== null && typeof a['title'] !== 'string') throw new ToolError('The title must be a string.')
  const title = typeof a['title'] === 'string' && a['title'].trim() ? a['title'].trim().slice(0, MAX_TITLE) : undefined
  const page = markdown.importMarkdownText(repo, markdownArg(a['markdown'], false), parent?.id ?? null, 'Untitled', title)
  return `Created ${label(page)}, in ${parent ? pathOf(repo, page.id) : 'the top level'}.`
}

function appendToPage({ repo, markdown }: WriteTarget, a: Record<string, unknown>): string {
  const page = pageFor(repo, idArg(a['id'], 'page'))
  const text = markdownArg(a['markdown'], true)
  const count = markdown.appendMarkdownText(repo, page.id, text)
  if (!count) throw new ToolError('That Markdown holds nothing to add.')
  return `Added ${count} block${count === 1 ? '' : 's'} to the end of ${label(page)}.`
}

function addRow({ repo }: WriteTarget, a: Record<string, unknown>): string {
  const database = databaseFor(repo, idArg(a['database'], 'database'))
  const change = rowChange(repo, database, a['values'] ?? {})
  const values = merged(undefined, change.values)
  const row = repo.create({
    type: 'page',
    parentId: database.id,
    props: { title: change.title ?? [], ...(Object.keys(values).length ? { values } : {}) }
  })
  return `Added the row ${titleOf(row)} [${row.id}] to ${label(database)}.`
}

function updateRow({ repo }: WriteTarget, a: Record<string, unknown>): string {
  const id = idArg(a['id'], 'row')
  const row = repo.get(id)
  const database = row?.parentId ? repo.get(row.parentId) : null
  if (!row || row.type !== 'page' || row.trashedAt !== null || !live(database) || database.type !== 'database')
    throw new ToolError('No row of a database has that id.')
  const change = rowChange(repo, database, a['values'])
  if (!change.names.length) throw new ToolError('Give at least one value to set.')
  const props: Record<string, unknown> = {}
  if (change.title !== undefined) props['title'] = change.title
  if (Object.keys(change.values).length) props['values'] = merged(row.props.values, change.values)
  const updated = repo.update(row.id, { props })
  return `Updated ${titleOf(updated)} [${updated.id}] in ${label(database)}: ${change.names.join(', ')}.`
}

/**
 * Runs one writing tool. Throws a ToolError for a call that cannot be made (an unknown id, a
 * value that does not fit); the repository's own refusals are plain Errors with a message
 * meant to be read, and anything else is the caller's to log.
 */
export function callWriteTool(target: WriteTarget, name: string, rawArgs: unknown): string {
  const a = args(rawArgs)
  switch (name) {
    case 'create_page':
      return createPage(target, a)
    case 'append_to_page':
      return appendToPage(target, a)
    case 'add_database_row':
      return addRow(target, a)
    case 'update_database_row':
      return updateRow(target, a)
    default:
      throw new ToolError(`There is no tool called ${String(name).slice(0, 40)}.`)
  }
}
