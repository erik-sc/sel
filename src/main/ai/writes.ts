import { AI_PRIVATE_MESSAGE, isPrivateForAi, privateProjects } from '../../shared/aiPrivate'
import { TASK_PROPS } from '../../shared/tasks'
import { sourceIdOf } from '../../shared/linked'
import { randomUUID } from 'node:crypto'
import type { Block, BlockProps, DatabaseView, Op, PropertySchema, PropertyValue, RichText, SelectOption } from '../../shared/types'
import type { Repository } from '../db/repository'
import { normalizeDatabase } from '../../shared/database/normalize'
import { findOption, sanitizeValue } from '../../shared/database/values'
import { label, live, pathOf, titleOf, ToolError } from './tools'
import { TOOL_CAPS } from './toolspecs'

/**
 * The workspace tools that write (see ./toolspecs.ts, WRITE_TOOL_SPECS), for the apps the user
 * connected in Settings (../external). Herman never gets them: what he changes is a proposal the
 * user applies in the window.
 *
 * Every change goes through the repository's public methods, as an edit made in the window
 * does: its checks apply (built-in blocks among them), the page's previous state goes into its
 * history as for any edit, and the caller tells the windows and sync what changed.
 *
 * Nothing here deletes for good. The first four tools only add (a value set to null is cleared,
 * and that is all they take away). The editing tools (EDIT_TOOL_SPECS) change and take away in
 * ways the user can undo in sel: a page rewritten keeps its previous text in its version history,
 * and what is deleted goes to the trash, from where `restore_page` or the user puts it back.
 *
 * What is private from the AI (shared/aiPrivate.ts) is as closed to writing as to reading: a page,
 * database or row the user keeps private is refused, as "private", whoever asks.
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
  if (isPrivateForAi(repo, block.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
  if (block.type === 'database') throw new ToolError(`${label(block)} is a database: add a row to it with add_database_row.`)
  return block
}

/** The database rows are kept in: the database itself, or the source of a linked view. */
function databaseFor(repo: Repository, id: string): Block {
  const block = repo.get(id)
  if (!live(block) || block.type !== 'database') throw new ToolError('No database has that id.')
  if (isPrivateForAi(repo, block.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
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
  // A project kept private from the AI takes no row from it: neither a new one nor one moved in.
  const project = change.values[TASK_PROPS.project]
  if (typeof project === 'string' && privateProjects(database).includes(project)) throw new ToolError(AI_PRIVATE_MESSAGE)
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
  if (isPrivateForAi(repo, row.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
  const change = rowChange(repo, database, a['values'])
  if (!change.names.length) throw new ToolError('Give at least one value to set.')
  const props: Record<string, unknown> = {}
  if (change.title !== undefined) props['title'] = change.title
  if (Object.keys(change.values).length) props['values'] = merged(row.props.values, change.values)
  const updated = repo.update(row.id, { props })
  return `Updated ${titleOf(updated)} [${updated.id}] in ${label(database)}: ${change.names.join(', ')}.`
}

// ---- the editing tools ---------------------------------------------------------

/** A live page or database the AI may change. */
function pageLikeFor(repo: Repository, id: string): Block {
  const block = repo.get(id)
  if (!live(block)) throw new ToolError('No page or database has that id.')
  if (isPrivateForAi(repo, block.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
  return block
}

function updatePage({ repo, markdown }: WriteTarget, a: Record<string, unknown>): string {
  const block = pageLikeFor(repo, idArg(a['id'], 'page'))
  const changed: string[] = []
  const props: Record<string, unknown> = {}
  if (a['title'] !== undefined) {
    if (typeof a['title'] !== 'string' || !a['title'].trim()) throw new ToolError('The title must be text.')
    props['title'] = [[a['title'].trim().slice(0, MAX_TITLE)]]
    changed.push('title')
  }
  if (Object.hasOwn(a, 'icon')) {
    if (a['icon'] !== null && typeof a['icon'] !== 'string') throw new ToolError('The icon is an emoji, or null.')
    props['icon'] = typeof a['icon'] === 'string' && a['icon'].trim() ? [...a['icon'].trim()].slice(0, 8).join('') : null
    changed.push('icon')
  }
  const text = a['markdown'] === undefined ? null : markdownArg(a['markdown'], true)
  if (text !== null && block.type === 'database')
    throw new ToolError(`${label(block)} is a database: its rows are changed with update_database_row.`)
  if (!changed.length && text === null) throw new ToolError('Say what to change: the title, the icon or the Markdown.')
  let kept = 0
  repo.transaction(() => {
    if (changed.length) repo.update(block.id, { props })
    if (text === null) return
    // The page's own text goes; the pages and databases inside it are things of their own and stay.
    const inside = repo.children(block.id)
    const going = inside.filter((child) => child.type !== 'page' && child.type !== 'database')
    kept = inside.length - going.length
    if (going.length) repo.apply(going.map((child): Op => ({ op: 'delete', id: child.id })))
    markdown.appendMarkdownText(repo, block.id, text)
  })
  if (text !== null) changed.push('text')
  const after = repo.get(block.id) ?? block
  const note =
    text === null
      ? ''
      : ` Its previous text is in its version history.${kept ? ` The ${kept} page${kept === 1 ? '' : 's'} or database${kept === 1 ? '' : 's'} inside it stayed, above the new text.` : ''}`
  return `Updated ${label(after)}: ${changed.join(', ')}.${note}`
}

function movePage({ repo }: WriteTarget, a: Record<string, unknown>): string {
  const block = pageLikeFor(repo, idArg(a['id'], 'page'))
  const from = block.parentId ? repo.get(block.parentId) : null
  if (from?.type === 'database') throw new ToolError(`${label(block)} is a row of ${titleOf(from)}: a row stays in its database.`)
  if (a['parent'] !== null && typeof a['parent'] !== 'string') throw new ToolError('parent is the id of a page, or null for the top level.')
  const parent = a['parent'] === null ? null : pageFor(repo, idArg(a['parent'], 'page'))
  if (parent && (parent.id === block.id || repo.ancestors(parent.id).some((ancestor) => ancestor.id === block.id)))
    throw new ToolError('A page cannot be moved into itself.')
  repo.move(block.id, parent?.id ?? null)
  return `Moved ${label(block)} to ${parent ? label(parent) : 'the top level'}.`
}

function deletePage({ repo }: WriteTarget, a: Record<string, unknown>): string {
  const block = pageLikeFor(repo, idArg(a['id'], 'page'))
  const where = pathOf(repo, block.id)
  repo.delete(block.id)
  return `Moved ${label(block)} (it was in ${where}) to the trash. restore_page puts it back; it is deleted for good only when the user empties the trash in sel.`
}

function restorePage({ repo }: WriteTarget, a: Record<string, unknown>): string {
  const id = idArg(a['id'], 'page')
  const block = repo.get(id)
  if (!block || (block.type !== 'page' && block.type !== 'database')) throw new ToolError('Nothing in the trash has that id.')
  if (isPrivateForAi(repo, block.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
  if (block.trashedAt === null) return `${label(block)} is not in the trash: it is in ${pathOf(repo, block.id)}.`
  repo.restore(id)
  const back = repo.get(id) ?? block
  // What it was in may be gone, and then it comes back at the top level; where it lands is private or not as any page.
  if (isPrivateForAi(repo, back.id)) return 'Restored. It is inside something private from the AI.'
  return `Restored ${label(back)} to ${pathOf(repo, back.id)}.`
}

const OPTION_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'brown', 'yellow', 'red', 'gray']
const NEW_TYPES = new Set(['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url'])

function newOptions(value: unknown, existing: readonly SelectOption[] = []): SelectOption[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > TOOL_CAPS.options)
    throw new ToolError(`options is a list of up to ${TOOL_CAPS.options} names.`)
  const out: SelectOption[] = []
  const taken = new Set(existing.map((option) => option.name.trim().toLowerCase()))
  for (const each of value) {
    const name = typeof each === 'string' ? each.replace(/\s+/gu, ' ').trim().slice(0, 100) : ''
    if (!name) throw new ToolError('An option is a name.')
    if (taken.has(name.toLowerCase())) continue
    taken.add(name.toLowerCase())
    out.push({ id: randomUUID(), name, color: OPTION_COLORS[(existing.length + out.length) % OPTION_COLORS.length] })
  }
  return out
}

/** A property as the caller described it, with a new id. */
function newProperty(raw: unknown, taken: Set<string>): PropertySchema {
  const a = args(raw)
  const name = typeof a['name'] === 'string' ? a['name'].replace(/\s+/gu, ' ').trim().slice(0, 100) : ''
  if (!name) throw new ToolError('A property needs a name.')
  if (taken.has(name.toLowerCase())) throw new ToolError(`There is already a property called “${name}”.`)
  taken.add(name.toLowerCase())
  const type = a['type']
  if (typeof type !== 'string' || !NEW_TYPES.has(type))
    throw new ToolError(`${name}: its type is one of text, number, select, multi_select, date, checkbox, url.`)
  const property: PropertySchema = { id: randomUUID(), name, type: type as PropertySchema['type'] }
  if (type === 'select' || type === 'multi_select') property.options = newOptions(a['options'])
  else if (a['options'] !== undefined) throw new ToolError(`${name}: only select and multi_select have options.`)
  if (a['format'] !== undefined) {
    if (type !== 'number' || (a['format'] !== 'number' && a['format'] !== 'percent' && a['format'] !== 'currency'))
      throw new ToolError(`${name}: format is number, percent or currency, for a number.`)
    property.numberFormat = a['format']
  }
  return property
}

function createDatabase({ repo }: WriteTarget, a: Record<string, unknown>): string {
  const parent = a['parent'] === undefined || a['parent'] === null ? null : pageFor(repo, idArg(a['parent'], 'page'))
  if (typeof a['title'] !== 'string' || !a['title'].trim()) throw new ToolError('Give the database a title.')
  const titleName =
    typeof a['title_property'] === 'string' && a['title_property'].trim() ? a['title_property'].trim().slice(0, 100) : 'Name'
  const list = a['properties'] ?? []
  if (!Array.isArray(list) || list.length > TOOL_CAPS.properties)
    throw new ToolError(`properties is a list of up to ${TOOL_CAPS.properties}.`)
  const taken = new Set([titleName.toLowerCase()])
  const properties = list.map((each) => newProperty(each, taken))
  const schema: Record<string, PropertySchema> = { title: { id: 'title', name: titleName, type: 'title' } }
  for (const property of properties) schema[property.id] = property
  const view: DatabaseView = {
    id: randomUUID(),
    name: 'Table',
    type: 'table',
    visibleProperties: ['title', ...properties.map((property) => property.id)],
    filters: [],
    sorts: []
  }
  const props: BlockProps = { title: [[a['title'].trim().slice(0, MAX_TITLE)]], schema, views: [view] }
  const database = repo.create({ type: 'database', parentId: parent?.id ?? null, props })
  return `Created ${label(database)}, in ${parent ? pathOf(repo, database.id) : 'the top level'}, with the properties ${Object.values(
    schema
  )
    .map((property) => `“${property.name}” (${property.type})`)
    .join(', ')}. Add rows with add_database_row.`
}

function addProperty({ repo }: WriteTarget, a: Record<string, unknown>): string {
  const database = databaseFor(repo, idArg(a['database'], 'database'))
  const schema = { ...(database.props.schema ?? {}) }
  const taken = new Set(Object.values(schema).map((property) => property.name.trim().toLowerCase()))
  if (Object.keys(schema).length >= 200) throw new ToolError('That database has too many properties.')
  const property = newProperty({ name: a['name'], type: a['type'], options: a['options'], format: a['format'] }, taken)
  schema[property.id] = property
  // Shown in every table view; the others (boards, calendars) pick their own.
  const views = (database.props.views ?? []).map((view) =>
    view.type === 'table' ? { ...view, visibleProperties: [...view.visibleProperties, property.id] } : view
  )
  repo.update(database.id, { props: { schema, views } })
  return `Added the property “${property.name}” (${property.type}) to ${label(database)}.`
}

function addOptions({ repo }: WriteTarget, a: Record<string, unknown>): string {
  const database = databaseFor(repo, idArg(a['database'], 'database'))
  if (typeof a['property'] !== 'string' || !a['property'].trim()) throw new ToolError('Say which property, by name.')
  const schema = { ...(database.props.schema ?? {}) }
  const property = propertyNamed(Object.values(schema), a['property'])
  if (!property) throw new ToolError(`${titleOf(database)} has no property “${a['property'].slice(0, 60)}”.`)
  if (property.type !== 'select' && property.type !== 'multi_select')
    throw new ToolError(`${property.name} is not a select: it has no options.`)
  const existing = property.options ?? []
  const added = newOptions(a['options'], existing)
  if (!added.length) return `${property.name} already has those options.`
  if (existing.length + added.length > 500) throw new ToolError(`${property.name} would have too many options.`)
  schema[property.id] = { ...property, options: [...existing, ...added] }
  repo.update(database.id, { props: { schema } })
  return `Added to ${property.name} of ${label(database)}: ${added.map((option) => `“${option.name}”`).join(', ')}.`
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
    case 'update_page':
      return updatePage(target, a)
    case 'move_page':
      return movePage(target, a)
    case 'delete_page':
      return deletePage(target, a)
    case 'restore_page':
      return restorePage(target, a)
    case 'create_database':
      return createDatabase(target, a)
    case 'add_database_property':
      return addProperty(target, a)
    case 'add_select_options':
      return addOptions(target, a)
    default:
      throw new ToolError(`There is no tool called ${String(name).slice(0, 40)}.`)
  }
}
