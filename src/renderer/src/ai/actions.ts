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
  /** Blocks to read again once the ops are in: where pages were moved from or trashed out of. */
  refresh: string[]
}

const quoted = (title: string): string => `“${title}”`
const titleOf = (block: Block | undefined): string => plainText(block?.props.title).trim() || 'Untitled'
const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** One line saying what an action would do, for the proposal card. */
export function describeAction(action: HermanAction, env: Pick<ActionEnv, 'currentPageId' | 'get'>, created?: ReadonlyMap<string, string>): string {
  const isDatabase = action.do === 'add-rows' || action.do === 'update-rows' || action.do === 'add-properties'
  const named = (target: string | undefined): string => {
    if (!target) return ''
    if (target.startsWith('@')) {
      const title = created?.get(target.slice(1))
      return title ? quoted(title) : 'the page created above'
    }
    const block = env.get(target === 'current' ? (env.currentPageId ?? '') : target)
    return block ? quoted(titleOf(block)) : target === 'current' ? 'this page' : isDatabase ? 'a database' : 'a page'
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
    case 'move':
      return `Move ${named(action.page)} ${action.parent ? `into ${named(action.parent)}` : 'to the top level'}`
    case 'update-page':
      return action.title ? `Rename ${named(action.page)} to ${quoted(action.title)}${action.icon ? ` ${action.icon}` : ''}` : `Give ${named(action.page)} the icon ${action.icon ?? ''}`
    case 'update-rows':
      return `Change ${count(action.rows.length, 'row')} of ${named(action.database)}`
    case 'add-properties':
      return `Add ${action.properties.map((property) => quoted(property.name)).join(', ')} to ${named(action.database)}`
    case 'trash':
      return `Move ${named(action.page)} to the Trash`
  }
}

/** What each `ref` of a proposal names: the title of what that action creates. */
export function createdTitles(actions: readonly HermanAction[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const action of actions) if ((action.do === 'create-page' || action.do === 'create-database') && action.ref) out.set(action.ref, action.title)
  return out
}

/** How many things a proposal would do, by kind: "3 pages created, 5 moved, 2 to the Trash". */
export function summarizeActions(actions: readonly HermanAction[]): string {
  const tally = new Map<string, number>()
  const add = (key: string, n = 1): void => {
    tally.set(key, (tally.get(key) ?? 0) + n)
  }
  for (const action of actions) {
    if (action.do === 'create-page') add('pages created')
    else if (action.do === 'create-database') add('databases created')
    else if (action.do === 'append') add('pages added to')
    else if (action.do === 'add-rows') add('rows added', action.rows.length)
    else if (action.do === 'move') add('moved')
    else if (action.do === 'update-page') add('renamed')
    else if (action.do === 'update-rows') add('rows changed', action.rows.length)
    else if (action.do === 'add-properties') add('properties added', action.properties.length)
    else add('to the Trash')
  }
  return [...tally.entries()].map(([key, n]) => `${n} ${n === 1 ? key.replace(/^(page|database|row|propert)(s|ies)\b/, (_, stem: string) => (stem === 'propert' ? 'property' : stem)) : key}`).join(', ')
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
    if (action.do === 'append' || action.do === 'update-page' || action.do === 'trash') add(action.page)
    else if (action.do === 'add-rows' || action.do === 'add-properties') add(action.database)
    else if (action.do === 'update-rows') {
      add(action.database)
      for (const row of action.rows) add(row.id)
    } else if (action.do === 'move') {
      add(action.page)
      add(action.parent ?? undefined)
    } else add(action.parent)
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
  const plan: ActionPlan = { ops: [], done: [], skipped: [], open: null, parents: [], refresh: [] }
  /** Where things are after the ops so far: pages created here and pages moved. */
  const parentOf = new Map<string, string | null>()
  const parentNow = (id: string): string | null => (parentOf.has(id) ? (parentOf.get(id) ?? null) : (env.get(id)?.parentId ?? null))
  /** True when `id` is `ancestor` or sits somewhere inside it. */
  const within = (id: string | null, ancestor: string): boolean => {
    const seen = new Set<string>()
    for (let cursor = id; cursor && !seen.has(cursor); cursor = parentNow(cursor)) {
      if (cursor === ancestor) return true
      seen.add(cursor)
    }
    return false
  }
  /** A live page or database of the store, by target; null when there is none. */
  const existing = (target: string): Block | null => {
    if (target.startsWith('@')) return null
    const block = env.get(target === 'current' ? (env.currentPageId ?? '') : target)
    return block && (block.type === 'page' || block.type === 'database') && !block.trashedAt ? block : null
  }
  /** The database a target names, through a linked view to its source; null when there is none. */
  const databaseOf = (target: string): { block: Block; source: Block } | null => {
    const block = target.startsWith('@') ? undefined : env.get(target === 'current' ? (env.currentPageId ?? '') : target)
    const resolved = block?.type === 'database' && !block.trashedAt ? L.resolveDatabase(block, lookup) : undefined
    return block && resolved?.status === 'ok' && resolved.source ? { block, source: resolved.source } : null
  }
  const trashed = new Set<string>()
  /** Schemas as earlier actions of this proposal left them: each op writes the whole schema, so the next must start from it. */
  const schemas = new Map<string, L.Schema>()
  const schemaOf = (source: Block): L.Schema => schemas.get(source.id) ?? L.normalizeDatabase(source).schema
  /** A page's title as this proposal leaves it: renamed or created here, or as stored. */
  const nameOf = (block: Block): string => made.get(block.id) ?? titleOf(block)
  const touch = (id: string | null | undefined): void => {
    if (id && !plan.refresh.includes(id)) plan.refresh.push(id)
  }
  const parentChanged = (id: string | null): void => {
    if (!plan.parents.includes(id)) plan.parents.push(id)
  }
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
        parentOf.set(id, parentId)
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
        const schema = schemaOf(source)
        const rows = rowOps(schema, source.id, action.rows, env.newId)
        if (!rows.ops.length) {
          plan.skipped.push(`No rows were added to ${quoted(titleOf(source))}: none of them had a name or a known property.`)
          break
        }
        if (rows.schema !== schema) {
          plan.ops.push({ op: 'update', id: source.id, patch: { props: { schema: rows.schema } } })
          schemas.set(source.id, rows.schema)
        }
        plan.ops.push(...rows.ops)
        plan.done.push(`Added ${count(rows.ops.length, 'row')} to ${quoted(titleOf(source))}.`)
        plan.open ??= block?.id ?? source.id
        break
      }
      case 'move': {
        const block = existing(action.page)
        const parentId = action.parent === null ? null : page(action.parent)
        if (!block || trashed.has(block.id)) {
          plan.skipped.push('Nothing was moved: the page was not found.')
          break
        }
        if (action.parent !== null && !parentId) {
          plan.skipped.push(`${quoted(nameOf(block))} was not moved: the page it should go in was not found.`)
          break
        }
        if (parentId && within(parentId, block.id)) {
          plan.skipped.push(`${quoted(nameOf(block))} was not moved: it cannot go inside itself.`)
          break
        }
        const from = parentNow(block.id)
        if (from === parentId) {
          plan.skipped.push(`${quoted(nameOf(block))} is already there.`)
          break
        }
        touch(from)
        plan.ops.push({ op: 'move', id: block.id, parentId })
        parentOf.set(block.id, parentId)
        parentChanged(parentId)
        parentChanged(from)
        plan.done.push(`Moved ${quoted(nameOf(block))} ${parentId ? `into ${quoted(made.get(parentId) ?? titleOf(env.get(parentId)))}` : 'to the top level'}.`)
        break
      }
      case 'update-page': {
        const block = existing(action.page)
        if (!block || trashed.has(block.id)) {
          plan.skipped.push('Nothing was renamed: the page was not found.')
          break
        }
        const props: BlockProps = {}
        if (action.title) props.title = toRichText(action.title)
        if (action.icon) props.icon = action.icon
        plan.ops.push({ op: 'update', id: block.id, patch: { props } })
        plan.done.push(action.title ? `Renamed ${quoted(nameOf(block))} to ${quoted(action.title)}.` : `Gave ${quoted(nameOf(block))} a new icon.`)
        if (action.title) made.set(block.id, action.title)
        parentChanged(parentNow(block.id))
        break
      }
      case 'update-rows': {
        const found = databaseOf(action.database)
        if (!found) {
          plan.skipped.push('No rows were changed: the database was not found.')
          break
        }
        const { block, source } = found
        let schema = schemaOf(source)
        const start = schema
        let changed = 0
        let missing = 0
        const updates: Op[] = []
        for (const { id, ...cells } of action.rows) {
          const row = env.get(id)
          if (!row || row.parentId !== source.id || row.trashedAt) {
            missing++
            continue
          }
          // The same conversion new rows get; the row keeps its other values.
          const built = rowOps(schema, source.id, [cells], () => row.id)
          schema = built.schema
          const first = built.ops[0]
          const input = first?.op === 'create' ? first.input : null
          if (!input) continue
          const props: BlockProps = {}
          const titleName = fold(L.getTitleProperty(schema)?.name ?? 'name')
          if (Object.keys(cells).some((key) => fold(key) === 'name' || fold(key) === 'title' || fold(key) === titleName) && input.props?.title) props.title = input.props.title
          const values = input.props?.values
          if (values && Object.keys(values).length) props.values = { ...(row.props.values ?? {}), ...values }
          if (!Object.keys(props).length) continue
          updates.push({ op: 'update', id: row.id, patch: { props } })
          changed++
        }
        if (schema !== start) {
          plan.ops.push({ op: 'update', id: source.id, patch: { props: { schema } } })
          schemas.set(source.id, schema)
        }
        plan.ops.push(...updates)
        if (changed) plan.done.push(`Changed ${count(changed, 'row')} of ${quoted(titleOf(source))}.`)
        if (missing) plan.skipped.push(`${count(missing, 'row')} of ${quoted(titleOf(source))} ${missing === 1 ? 'was' : 'were'} not found.`)
        if (!changed && !missing) plan.skipped.push(`No rows of ${quoted(titleOf(source))} were changed: nothing new was said about them.`)
        if (changed) plan.open ??= block.id
        break
      }
      case 'add-properties': {
        const found = databaseOf(action.database)
        if (!found) {
          plan.skipped.push('No properties were added: the database was not found.')
          break
        }
        const { source } = found
        let schema = schemaOf(source)
        const added: string[] = []
        for (const property of action.properties) {
          if (Object.values(schema).some((known) => fold(known.name) === fold(property.name))) continue
          const next = L.addProperty(schema, { name: property.name, type: property.type })
          schema = next.schema
          for (const option of property.options ?? []) schema = L.addOption(schema, next.property.id, option).schema
          added.push(quoted(property.name))
        }
        if (!added.length) {
          plan.skipped.push(`${quoted(titleOf(source))} already has those properties.`)
          break
        }
        plan.ops.push({ op: 'update', id: source.id, patch: { props: { schema } } })
        schemas.set(source.id, schema)
        plan.done.push(`Added ${added.join(', ')} to ${quoted(titleOf(source))}.`)
        break
      }
      case 'trash': {
        const block = existing(action.page)
        if (!block || trashed.has(block.id)) {
          plan.skipped.push('Nothing was put in the Trash: the page was not found.')
          break
        }
        trashed.add(block.id)
        const from = parentNow(block.id)
        touch(from)
        plan.ops.push({ op: 'delete', id: block.id })
        parentChanged(from)
        plan.done.push(`Moved ${quoted(nameOf(block))} to the Trash.`)
        break
      }
    }
  }
  return plan
}
