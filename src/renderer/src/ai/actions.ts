// How a proposal of the assistant (shared/actions.ts) becomes pages, databases and rows: one
// batch of ops, built here and committed through the same pipeline as the user's own edits.
// `planActions` is pure (it reads blocks through a getter and returns the ops), so the rules
// are unit tested without a DOM. Nothing here runs until the user presses Apply.
import type { ActionCell, ActionRow, HermanAction } from '@shared/actions'
import type { Block, BlockProps, Op, PropertySchema, PropertyValue } from '@shared/types'
// Relative: this file is unit tested, and the tests resolve no aliases.
import { plainText, toRichText } from '../../../shared/richtext'
import * as L from '../database/logic'
import { buildCreateOps } from '../editor/clipboard'
import { markdownToNodes } from './plan'

export interface ActionEnv {
  /** The page in front: what `current` means. */
  currentPageId: string | null
  get(id: string): Block | undefined
  newId(): string
}

export interface ActionPlan {
  ops: Op[]
  /** What was done, one line per action that could be planned. */
  done: string[]
  /** Why an action was left out, one line each. */
  skipped: string[]
  /** The first thing created: what to show afterwards. */
  open: string | null
  /** Pages whose list of sub-pages changed (null: the top level). */
  parents: (string | null)[]
}

const quoted = (title: string): string => `“${title}”`
const titleOf = (block: Block | undefined): string => plainText(block?.props.title).trim() || 'Untitled'
const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** One line saying what an action would do, for the proposal card. */
export function describeAction(action: HermanAction, env: Pick<ActionEnv, 'currentPageId' | 'get'>): string {
  const named = (target: string | undefined): string => {
    if (!target) return ''
    if (target.startsWith('@')) return 'the page created above'
    const block = env.get(target === 'current' ? (env.currentPageId ?? '') : target)
    return block ? quoted(titleOf(block)) : target === 'current' ? 'this page' : 'a page'
  }
  switch (action.do) {
    case 'create-page':
      return `Create the page ${quoted(action.title)}${action.parent ? ` in ${named(action.parent)}` : ''}`
    case 'append':
      return `Add to ${named(action.page)}`
    case 'create-database':
      return `Create the database ${quoted(action.title)}${action.rows.length ? ` with ${count(action.rows.length, 'row')}` : ''}${action.parent ? ` in ${named(action.parent)}` : ''}`
    case 'add-rows':
      return `Add ${count(action.rows.length, 'row')} to ${named(action.database)}`
  }
}

/** The ids a proposal names: what has to be in the store before it is planned. */
export function actionTargets(actions: readonly HermanAction[], currentPageId: string | null): string[] {
  const ids = new Set<string>()
  const add = (target: string | undefined): void => {
    if (!target || target.startsWith('@')) return
    const id = target === 'current' ? currentPageId : target
    if (id) ids.add(id)
  }
  for (const action of actions) {
    if (action.do === 'append') add(action.page)
    else if (action.do === 'add-rows') add(action.database)
    else add(action.parent)
  }
  return [...ids]
}

const fold = (name: string): string => name.trim().toLowerCase()

/** A cell as the model wrote it, in the stored shape of its property. Options it names are added to the schema. */
function toValue(schema: L.Schema, prop: PropertySchema, cell: ActionCell): { schema: L.Schema; value: PropertyValue } {
  if (cell === null) return { schema, value: null }
  let next = schema
  const option = (name: string): string | undefined => {
    const added = L.addOption(next, prop.id, name)
    next = added.schema
    return added.option?.id
  }
  let raw: unknown = cell
  switch (prop.type) {
    case 'select':
      raw = option(Array.isArray(cell) ? (cell[0] ?? '') : String(cell))
      break
    case 'multi_select':
      raw = (Array.isArray(cell) ? cell : String(cell).split(','))
        .map((name) => option(name))
        .filter((id): id is string => !!id)
      break
    case 'number':
      raw = typeof cell === 'number' ? cell : typeof cell === 'string' && cell.trim() !== '' ? Number(cell.replace(',', '.')) : null
      break
    case 'checkbox':
      raw = cell === true || (typeof cell === 'string' && /^(true|yes|x|done|sim)$/i.test(cell.trim()))
      break
    case 'date':
      if (typeof cell === 'string' && cell.includes('/')) {
        const [start, end] = cell.split('/')
        raw = { start: start.trim(), end: end.trim() }
      }
      break
    default:
      raw = Array.isArray(cell) ? cell.join(', ') : typeof cell === 'boolean' ? (cell ? 'Yes' : 'No') : cell
  }
  const current = L.propOf(next, prop.id) ?? prop
  return { schema: next, value: L.sanitizeValue(current, raw) }
}

/** The create ops for rows of a database, and its schema with any options the rows brought. */
function rowOps(schema: L.Schema, databaseId: string, rows: readonly ActionRow[], newId: () => string): { schema: L.Schema; ops: Op[] } {
  let next = schema
  const ops: Op[] = []
  const title = L.getTitleProperty(next)
  const titleNames = new Set(['name', 'title', ...(title ? [fold(title.name)] : [])])
  for (const row of rows) {
    let name = ''
    const values: L.Values = {}
    for (const [key, cell] of Object.entries(row)) {
      const wanted = fold(key)
      const prop = Object.values(next).find((candidate) => candidate.type !== 'title' && fold(candidate.name) === wanted)
      if (!prop) {
        // No property of that name: the title when it is one of the title's names, otherwise the cell is left out.
        if (titleNames.has(wanted) && typeof cell !== 'object') name = String(cell ?? '').slice(0, 2000)
        continue
      }
      if (L.isComputedType(prop.type)) continue
      const converted = toValue(next, prop, cell)
      next = converted.schema
      if (converted.value !== null && converted.value !== false) values[prop.id] = converted.value
    }
    if (!name && !Object.keys(values).length) continue
    const props: BlockProps = { title: toRichText(name) }
    if (Object.keys(values).length) props.values = values
    ops.push({ op: 'create', input: { id: newId(), type: 'page', parentId: databaseId, props } })
  }
  return { schema: next, ops }
}

/**
 * The ops that carry out a proposal, in order. An action whose target is missing, in the trash
 * or of the wrong kind is skipped and said so; the others still go through.
 */
export function planActions(actions: readonly HermanAction[], env: ActionEnv): ActionPlan {
  const plan: ActionPlan = { ops: [], done: [], skipped: [], open: null, parents: [] }
  /** What earlier actions of this proposal created, by their `ref`. */
  const refs = new Map<string, { id: string; type: 'page' | 'database' }>()
  /** Titles of the pages created here: the store does not have them yet. */
  const made = new Map<string, string>()
  const lookup: L.BlockLookup = { get: (id) => env.get(id) }

  /** A page that can hold things: a live page of the store, or one created above. Null when there is none. */
  const page = (target: string | undefined): string | null => {
    if (!target) return null
    if (target.startsWith('@')) {
      const made = refs.get(target.slice(1))
      return made?.type === 'page' ? made.id : null
    }
    const block = env.get(target === 'current' ? (env.currentPageId ?? '') : target)
    return block && block.type === 'page' && !block.trashedAt ? block.id : null
  }

  for (const action of actions) {
    switch (action.do) {
      case 'create-page':
      case 'create-database': {
        const parentId = page(action.parent)
        if (action.parent && !parentId) {
          plan.skipped.push(`${quoted(action.title)} was not created: the page it should go in was not found.`)
          break
        }
        const id = env.newId()
        const props: BlockProps = { title: toRichText(action.title) }
        if (action.icon) props.icon = action.icon
        if (action.do === 'create-page') {
          plan.ops.push({ op: 'create', input: { id, type: 'page', parentId, props } })
          const nodes = action.markdown ? markdownToNodes(action.markdown) : []
          if (nodes.length) plan.ops.push(...buildCreateOps(nodes, id, null, env.newId).ops)
          plan.done.push(`Created the page ${quoted(action.title)}.`)
        } else {
          let schema = L.createDefaultSchema()
          for (const property of action.properties) {
            if (property.type === 'title') {
              schema = L.renameProperty(schema, L.DEFAULT_TITLE_ID, property.name)
              continue
            }
            const added = L.addProperty(schema, { name: property.name, type: property.type })
            schema = added.schema
            for (const option of property.options ?? []) schema = L.addOption(schema, added.property.id, option).schema
          }
          // The rows come first: they may name options the properties did not list.
          const rows = rowOps(schema, id, action.rows, env.newId)
          const built = L.addView(rows.schema, [], action.view ?? 'table')
          props.schema = built.schema
          props.views = built.views
          plan.ops.push({ op: 'create', input: { id, type: 'database', parentId, props } }, ...rows.ops)
          plan.done.push(`Created the database ${quoted(action.title)}${rows.ops.length ? ` with ${count(rows.ops.length, 'row')}` : ''}.`)
        }
        if (action.ref) refs.set(action.ref, { id, type: action.do === 'create-page' ? 'page' : 'database' })
        made.set(id, action.title)
        plan.open ??= parentId && action.do === 'create-database' ? parentId : id
        if (!plan.parents.includes(parentId)) plan.parents.push(parentId)
        break
      }
      case 'append': {
        const pageId = page(action.page)
        const nodes = markdownToNodes(action.markdown)
        if (!pageId || !nodes.length) {
          plan.skipped.push(pageId ? 'There was nothing to add.' : 'Nothing was added: the page was not found.')
          break
        }
        // `undefined` appends: after whatever the page ends with, earlier actions included.
        plan.ops.push(...buildCreateOps(nodes, pageId, undefined, env.newId).ops)
        plan.done.push(`Added to ${quoted(made.get(pageId) ?? titleOf(env.get(pageId)))}.`)
        plan.open ??= pageId
        break
      }
      case 'add-rows': {
        const block = action.database.startsWith('@') ? undefined : env.get(action.database === 'current' ? (env.currentPageId ?? '') : action.database)
        const resolved = block?.type === 'database' && !block.trashedAt ? L.resolveDatabase(block, lookup) : undefined
        const source = resolved?.status === 'ok' ? resolved.source : null
        if (!source) {
          // Rows for a database of this same proposal belong in its own "rows".
          plan.skipped.push('No rows were added: the database was not found.')
          break
        }
        const schema = L.normalizeDatabase(source).schema
        const rows = rowOps(schema, source.id, action.rows, env.newId)
        if (!rows.ops.length) {
          plan.skipped.push(`No rows were added to ${quoted(titleOf(source))}: none of them had a name or a known property.`)
          break
        }
        if (rows.schema !== schema) plan.ops.push({ op: 'update', id: source.id, patch: { props: { schema: rows.schema } } })
        plan.ops.push(...rows.ops)
        plan.done.push(`Added ${count(rows.ops.length, 'row')} to ${quoted(titleOf(source))}.`)
        plan.open ??= block?.id ?? source.id
        break
      }
    }
  }
  return plan
}
