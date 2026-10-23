// How a proposal of the assistant (shared/actions.ts) becomes pages, databases and rows: one
// batch of ops, built here and committed through the same pipeline as the user's own edits.
// `planActions` is pure (it reads blocks through a getter and returns the ops), so the rules
// are unit tested without a DOM. Nothing here runs until the user presses Apply.
import type { ActionCell, ActionRow, HermanAction, TaskChange } from '@shared/actions'
import type { Block, BlockProps, Op, PropertySchema, PropertyValue } from '@shared/types'
// Relative: this file is unit tested, and the tests resolve no aliases.
import { localDay } from '../../../shared/briefing'
import { cleanLine, cleanPlans, entryId, lineTitle, nextDay, NOTEBOOK_ENTRY_TYPE, NOTEBOOK_ID, readEntry } from '../../../shared/notebook'
import { plainText, toRichText } from '../../../shared/richtext'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../../shared/tasks'
import { blockOf, blockValue, minutesOf } from '../../../shared/tasks/blocks'
import * as L from '../database/logic'
import { buildCreateOps } from '../editor/clipboard'
import { markdownToNodes } from './plan'

export interface ActionEnv {
  /** The page in front: what `current` means. */
  currentPageId: string | null
  get(id: string): Block | undefined
  newId(): string
  /** The local day, `YYYY-MM-DD`: what "today" is for a time block and for Meditations. Now when absent. */
  today?: string
  /** The title Meditations gets when a proposal starts it (in the language of the app). */
  notebookTitle?: string
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
export function describeAction(
  action: HermanAction,
  env: Pick<ActionEnv, 'currentPageId' | 'get'>,
  created?: ReadonlyMap<string, string>
): string {
  const isDatabase = action.do === 'add-rows' || action.do === 'update-rows' || action.do === 'add-properties'
  const isTask = action.do === 'update-tasks' || action.do === 'add-subtasks'
  const named = (target: string | undefined): string => {
    if (!target) return ''
    if (target.startsWith('@')) {
      const title = created?.get(target.slice(1))
      return title ? quoted(title) : 'the page created above'
    }
    const block = env.get(target === 'current' ? (env.currentPageId ?? '') : target)
    return block ? quoted(titleOf(block)) : target === 'current' ? 'this page' : isDatabase ? 'a database' : isTask ? 'a task' : 'a page'
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
      return action.title
        ? `Rename ${named(action.page)} to ${quoted(action.title)}${action.icon ? ` ${action.icon}` : ''}`
        : `Give ${named(action.page)} the icon ${action.icon ?? ''}`
    case 'update-rows':
      return `Change ${count(action.rows.length, 'row')} of ${named(action.database)}`
    case 'add-properties':
      return `Add ${action.properties.map((property) => quoted(property.name)).join(', ')} to ${named(action.database)}`
    case 'trash':
      return `Move ${named(action.page)} to the Trash`
    case 'update-tasks':
      return action.tasks.length === 1
        ? `${taskChangeWords(action.tasks[0])} ${named(action.tasks[0].id)}`.replace(/^./, (first) => first.toUpperCase())
        : `Change ${count(action.tasks.length, 'task')}`
    case 'add-subtasks':
      return `Add ${count(action.titles.length, 'step')} under ${named(action.task)}`
    case 'close-day':
      return action.line && action.plans?.length
        ? `Write today’s line in Meditations and set ${count(action.plans.length, 'plan')} for tomorrow`
        : action.line
          ? 'Write today’s line in Meditations'
          : `Set ${count(action.plans?.length ?? 0, 'plan')} for tomorrow`
  }
}

/** What a change of a task does, in a few words: "set the date and block a time for". */
function taskChangeWords(change: TaskChange): string {
  const parts: string[] = []
  if (change.title) parts.push('rename')
  if (change.due === null) parts.push('take the date off')
  else if (change.due) parts.push(`move to ${change.due}`)
  if (change.priority) parts.push(`make ${change.priority}`)
  else if (change.priority === null) parts.push('take the priority off')
  if (change.block) parts.push(`block ${change.block.start}–${change.block.end} for`)
  return parts.join(', ') || 'change'
}

/** What each `ref` of a proposal names: the title of what that action creates. */
export function createdTitles(actions: readonly HermanAction[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const action of actions)
    if ((action.do === 'create-page' || action.do === 'create-database') && action.ref) out.set(action.ref, action.title)
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
    else if (action.do === 'update-tasks') add('tasks changed', action.tasks.length)
    else if (action.do === 'add-subtasks') add('steps added', action.titles.length)
    else if (action.do === 'close-day') add('Meditations written')
    else add('to the Trash')
  }
  return [...tally.entries()]
    .map(
      ([key, n]) =>
        `${n} ${n === 1 ? key.replace(/^(page|database|row|task|step|propert)(s|ies)\b/, (_, stem: string) => (stem === 'propert' ? 'property' : stem)) : key}`
    )
    .join(', ')
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
    } else if (action.do === 'update-tasks') {
      add(TASKS_DATABASE_ID)
      for (const change of action.tasks) add(change.id)
    } else if (action.do === 'add-subtasks') {
      add(TASKS_DATABASE_ID)
      add(action.task)
    } else if (action.do === 'close-day') {
      const today = localDay()
      add(NOTEBOOK_ID)
      add(entryId(today))
      add(entryId(nextDay(today)))
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
      raw = (Array.isArray(cell) ? cell : String(cell).split(',')).map((name) => option(name)).filter((id): id is string => !!id)
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
      // Computed cells take no value; a relation's are row ids, which a proposal cannot name.
      if (L.isComputedType(prop.type) || prop.type === 'relation') continue
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
  const today = env.today ?? localDay()
  /** The notebook page was created by an earlier action of this proposal. */
  let madeNotebook = false
  /** A live task of the built-in Tasks database, by id. */
  const taskRow = (id: string): Block | null => {
    const row = env.get(id)
    return row && row.type === 'page' && row.parentId === TASKS_DATABASE_ID && !row.trashedAt ? row : null
  }

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
        const block = action.database.startsWith('@')
          ? undefined
          : env.get(action.database === 'current' ? (env.currentPageId ?? '') : action.database)
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
        plan.done.push(
          `Moved ${quoted(nameOf(block))} ${parentId ? `into ${quoted(made.get(parentId) ?? titleOf(env.get(parentId)))}` : 'to the top level'}.`
        )
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
        plan.done.push(
          action.title ? `Renamed ${quoted(nameOf(block))} to ${quoted(action.title)}.` : `Gave ${quoted(nameOf(block))} a new icon.`
        )
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
          if (
            Object.keys(cells).some((key) => fold(key) === 'name' || fold(key) === 'title' || fold(key) === titleName) &&
            input.props?.title
          )
            props.title = input.props.title
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
        if (missing)
          plan.skipped.push(`${count(missing, 'row')} of ${quoted(titleOf(source))} ${missing === 1 ? 'was' : 'were'} not found.`)
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
      case 'update-tasks': {
        let changed = 0
        let missing = 0
        for (const change of action.tasks) {
          const row = taskRow(change.id)
          if (!row || trashed.has(row.id)) {
            missing++
            continue
          }
          const patch = taskPatch(row, change, today)
          if (!patch) continue
          plan.ops.push({ op: 'update', id: row.id, patch: { props: patch } })
          if (change.title) made.set(row.id, change.title)
          changed++
        }
        if (changed) {
          plan.done.push(`Changed ${count(changed, 'task')}.`)
          plan.open ??= TASKS_DATABASE_ID
        }
        if (missing) plan.skipped.push(`${count(missing, 'task')} ${missing === 1 ? 'was' : 'were'} not found.`)
        if (!changed && !missing) plan.skipped.push('No task was changed: nothing new was said about them.')
        break
      }
      case 'add-subtasks': {
        const parent = taskRow(action.task)
        if (!parent || trashed.has(parent.id)) {
          plan.skipped.push('No steps were added: the task was not found.')
          break
        }
        const project = (parent.props.values ?? {})[TASK_PROPS.project]
        for (const title of action.titles) {
          const values: Record<string, PropertyValue> = { [TASK_PROPS.parent]: [parent.id] }
          if (typeof project === 'string' && project) values[TASK_PROPS.project] = project
          plan.ops.push({
            op: 'create',
            input: { id: env.newId(), type: 'page', parentId: TASKS_DATABASE_ID, props: { title: toRichText(title), values } }
          })
        }
        plan.done.push(`Added ${count(action.titles.length, 'step')} under ${quoted(nameOf(parent))}.`)
        plan.open ??= TASKS_DATABASE_ID
        break
      }
      case 'close-day': {
        const notebook = env.get(NOTEBOOK_ID)
        if (notebook && (notebook.type !== 'page' || notebook.trashedAt)) {
          plan.skipped.push('Meditations could not be written: its page is in the Trash.')
          break
        }
        if (!notebook && !madeNotebook) {
          // The notebook starts with its fixed id, the same block every device makes (shared/notebook.ts).
          plan.ops.push({
            op: 'create',
            input: {
              id: NOTEBOOK_ID,
              type: 'page',
              parentId: null,
              props: { system: 'notebook', title: [[env.notebookTitle ?? 'Meditations']] }
            }
          })
          madeNotebook = true
        }
        const entry = (day: string): { block: Block | undefined; text: string; plans: string[]; dismissed: boolean } => {
          const block = env.get(entryId(day))
          const read = block && block.parentId === NOTEBOOK_ID && !block.trashedAt ? readEntry(block) : null
          return {
            block: read ? block : undefined,
            text: read?.text ?? '',
            plans: read?.plans ?? [],
            dismissed: read?.plansDismissed ?? false
          }
        }
        const write = (day: string, existing: Block | undefined, props: Record<string, unknown>): void => {
          if (existing) plan.ops.push({ op: 'update', id: existing.id, patch: { props: props as BlockProps } })
          else
            plan.ops.push({
              op: 'create',
              input: {
                id: entryId(day),
                type: NOTEBOOK_ENTRY_TYPE,
                parentId: NOTEBOOK_ID,
                props: Object.fromEntries(Object.entries(props).filter(([, value]) => value !== null)) as BlockProps
              }
            })
        }
        if (action.line) {
          const now = entry(today)
          // Added after what the day already holds: the line written by hand stays first.
          const text = cleanLine(now.text ? `${now.text}\n${action.line}` : action.line)
          write(today, now.block, { title: lineTitle(text) })
          plan.done.push('Wrote today’s line in Meditations.')
        }
        if (action.plans?.length) {
          const tomorrow = nextDay(today)
          const then = entry(tomorrow)
          const plans = cleanPlans([...(then.dismissed ? [] : then.plans), ...action.plans])
          write(tomorrow, then.block, { plans, plansDismissed: null })
          plan.done.push(`Set ${count(plans.length, 'plan')} for tomorrow.`)
        }
        plan.open ??= NOTEBOOK_ID
        break
      }
    }
  }
  return plan
}

/** The values a change of a task writes, or null when it changes nothing. */
function taskPatch(row: Block, change: TaskChange, today: string): BlockProps | null {
  const before = row.props.values ?? {}
  const values: Record<string, PropertyValue> = { ...before }
  const current = before[TASK_PROPS.due]
  if (change.due === null && !change.block) delete values[TASK_PROPS.due]
  else if (change.due && !change.block) {
    // A new day keeps the time of day it had: a block moves whole, a time stays the time.
    const block = blockOf(current)
    if (block) values[TASK_PROPS.due] = blockValue({ ...block, day: change.due })
    else if (typeof current === 'string' && current.length > 10) values[TASK_PROPS.due] = `${change.due}${current.slice(10)}`
    else values[TASK_PROPS.due] = change.due
  }
  if (change.block) {
    const start = minutesOf(change.block.start)
    const end = minutesOf(change.block.end)
    // A block is for the day being planned: the day given with it, else today (a late task is done today, not on its old day).
    const value = start !== null && end !== null ? blockValue({ day: change.due ?? today, start, minutes: end - start }) : null
    if (value) values[TASK_PROPS.due] = value
  }
  if (change.priority === null) delete values[TASK_PROPS.priority]
  else if (change.priority) values[TASK_PROPS.priority] = `tasks.p${change.priority.slice(1)}`
  const props: BlockProps = {}
  if (JSON.stringify(values) !== JSON.stringify(before)) props.values = values
  if (change.title && change.title !== plainText(row.props.title).trim()) props.title = toRichText(change.title)
  return Object.keys(props).length ? props : null
}
