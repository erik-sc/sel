// Using a template: its tree of blocks becomes real blocks with new ids, written in one
// transaction under the workspace root or under a page. Everything that points at a block of
// the template (a relation's database, a linked view's source, the links of example rows, a
// filter on a relation) is rewritten to the new ids; a two-way link written on one side is
// added on the other. Example rows are left out when the template is used empty.
import { randomUUID } from 'node:crypto'
import {
  plain,
  type Template,
  type TemplateDate,
  type TemplateNode,
  type TemplateRow,
  type TemplateValue,
  type TemplateView
} from '../../shared/templates/model'
import type { Block, BlockProps, DatabaseView, Op, PropertySchema, PropertyValue, ViewFilter } from '../../shared/types'
import type { Repository } from '../db/repository'

export interface PlanOptions {
  /** The page the template's page goes under; null for the workspace root. */
  parentId: string | null
  /** Whether the example rows are made. */
  examples: boolean
  /** The day the examples' dates are counted from (local time); today when absent. */
  today?: Date
  /** Makes block and view ids; random when absent. */
  newId?: () => string
}

export interface TemplatePlan {
  /** The id the template's page will have. */
  rootId: string
  /** Every block, in an order the repository accepts (a linked view after its source). */
  ops: Op[]
}

/** Makes the template's blocks in one transaction and returns its page. */
export function instantiateTemplate(repo: Repository, template: Template, options: PlanOptions): Block {
  const plan = planTemplate(template, options)
  repo.apply(plan.ops)
  const root = repo.get(plan.rootId)
  if (!root) throw new Error('The template could not be made')
  return root
}

const pad = (n: number): string => String(n).padStart(2, '0')
const dayOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** A template date as a stored day (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`), counted from `today`. */
export function resolveDate(date: TemplateDate, today: Date): { start: string; end?: string } {
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  if ('weekday' in date) {
    // A week runs from Sunday, as the "this week" filter of a view counts it.
    const sunday = d - today.getDay()
    return { start: dayOf(new Date(y, m, sunday + date.week * 7 + Math.min(Math.max(0, date.weekday), 6))) }
  }
  if ('month' in date) {
    const length = new Date(y, m + date.month + 1, 0).getDate()
    let day = new Date(y, m + date.month, Math.min(Math.max(1, date.day), length))
    // Something that already happened: in this month, never after today.
    if (date.month <= 0 && day > new Date(y, m, d)) day = new Date(y, m, d)
    return { start: dayOf(day) }
  }
  const at = (days: number, time?: string): string => {
    const day = dayOf(new Date(y, m, d + days))
    if (time === undefined) return day
    if (!TIME_RE.test(time)) throw new Error(`Invalid time in a template: ${time}`)
    return `${day}T${time}`
  }
  const start = at(date.days, date.time)
  if (date.endDays === undefined && date.endTime === undefined) return { start }
  return { start, end: at(date.endDays ?? date.days, date.endTime) }
}

function isTemplateDate(value: TemplateValue): value is TemplateDate {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

interface Placed {
  node: TemplateNode | { kind: 'row'; row: TemplateRow; database: string }
  id: string
  parentId: string | null
  /** Ids of the siblings before it, in the order the parent will hold them. */
  before: string[]
}

/** Works out every block of the template, with new ids, as the ops that make them. Pure but for `newId`. */
export function planTemplate(template: Template, options: PlanOptions): TemplatePlan {
  const newId = options.newId ?? randomUUID
  const today = options.today ?? new Date()

  // 1. Every block gets its id; keys map to them.
  const ids = new Map<string, string>()
  const kinds = new Map<string, 'database' | 'row' | 'other'>()
  /** The database each keyed row belongs to (its key). */
  const rowDatabase = new Map<string, string>()
  const remember = (key: string | undefined, id: string, kind: 'database' | 'row' | 'other'): void => {
    if (key === undefined) return
    if (ids.has(key)) throw new Error(`Two blocks of the template share the key "${key}"`)
    ids.set(key, id)
    kinds.set(key, kind)
  }
  const placed: Placed[] = []
  const place = (nodes: TemplateNode[], parentId: string): void => {
    const before: string[] = []
    for (const node of nodes) {
      const id = newId()
      remember(node.key, id, node.kind === 'database' ? 'database' : 'other')
      placed.push({ node, id, parentId, before: [...before] })
      before.push(id)
      if (node.kind === 'block') place(node.children ?? [], id)
      if (node.kind === 'database' && options.examples) {
        const rowsBefore: string[] = []
        for (const r of node.rows) {
          const rowId = newId()
          remember(r.key, rowId, 'row')
          if (r.key !== undefined) rowDatabase.set(r.key, node.key)
          placed.push({ node: { kind: 'row', row: r, database: node.key }, id: rowId, parentId: id, before: [...rowsBefore] })
          rowsBefore.push(rowId)
          place(r.children ?? [], rowId)
        }
      }
    }
  }
  const rootId = newId()
  remember(template.page.key, rootId, 'other')
  placed.push({ node: template.page, id: rootId, parentId: options.parentId, before: [] })
  place(template.page.children ?? [], rootId)

  const databaseId = (key: string, what: string): string => {
    const id = ids.get(key)
    if (id === undefined || kinds.get(key) !== 'database')
      throw new Error(`${what} points at "${key}", which is not a database of the template`)
    return id
  }
  const rowId = (key: string, database: string, what: string): string => {
    const id = ids.get(key)
    if (id === undefined || rowDatabase.get(key) !== database)
      throw new Error(`${what} links to "${key}", which is not a row of that database`)
    return id
  }

  // 2. Schemas with their relations pointed at the new databases.
  const schemas = new Map<string, Record<string, PropertySchema>>()
  for (const { node } of placed) {
    if (node.kind !== 'database') continue
    const schema: Record<string, PropertySchema> = structuredClone(node.schema)
    for (const property of Object.values(schema)) {
      if (property.type === 'relation' && property.relation) {
        property.relation = {
          ...property.relation,
          databaseId: databaseId(property.relation.databaseId, `The relation "${property.name}"`)
        }
      }
    }
    schemas.set(node.key, schema)
  }
  const sourceSchema = (key: string): Record<string, PropertySchema> => {
    const schema = schemas.get(key)
    if (!schema) throw new Error(`"${key}" is not a database of the template`)
    return schema
  }

  // 3. The values of the example rows: dates worked out, links to the new rows, both sides of two-way relations.
  const values = new Map<string, Record<string, PropertyValue>>()
  const valuesOf = (id: string): Record<string, PropertyValue> => {
    let out = values.get(id)
    if (!out) values.set(id, (out = {}))
    return out
  }
  const link = (from: string, propertyId: string, to: string): void => {
    const cell = valuesOf(from)
    const current = Array.isArray(cell[propertyId]) ? (cell[propertyId] as string[]) : []
    if (!current.includes(to)) cell[propertyId] = [...current, to]
  }
  const keyOfDatabaseId = new Map([...schemas.keys()].map((key) => [ids.get(key) as string, key]))
  for (const { node, id } of placed) {
    if (node.kind !== 'row') continue
    const schema = sourceSchema(node.database)
    for (const [propertyId, value] of Object.entries(node.row.values ?? {})) {
      const property = schema[propertyId]
      if (!property) throw new Error(`The row "${node.row.title}" has a value for "${propertyId}", which its database does not have`)
      if (property.type === 'title' || property.type === 'rollup' || property.type === 'formula') {
        throw new Error(`The row "${node.row.title}" stores a value in "${property.name}", which computes its own`)
      }
      if (property.type === 'relation') {
        const target = keyOfDatabaseId.get(property.relation?.databaseId ?? '')
        if (!Array.isArray(value) || target === undefined)
          throw new Error(`The relation "${property.name}" of "${node.row.title}" must list rows`)
        const partner = property.relation?.syncedPropertyId
        for (const key of value) {
          const to = rowId(key, target, `The row "${node.row.title}"`)
          link(id, propertyId, to)
          if (partner) link(to, partner, id)
        }
      } else if (property.type === 'date') {
        if (!isTemplateDate(value)) throw new Error(`The date "${property.name}" of "${node.row.title}" is not a template date`)
        valuesOf(id)[propertyId] = resolveDate(value, today)
      } else {
        valuesOf(id)[propertyId] = value as PropertyValue
      }
    }
  }

  // 4. Views with new ids, their relation filters pointed at the new rows.
  const viewsOf = (list: TemplateView[], database: string): DatabaseView[] => {
    const schema = sourceSchema(database)
    return list.map((view) => {
      const filters: ViewFilter[] = []
      for (const filter of view.filters) {
        const property = schema[filter.propertyId]
        if (property?.type !== 'relation' || !Array.isArray(filter.value)) {
          filters.push(structuredClone(filter))
          continue
        }
        // Without the example rows it names, a filter on them would hide everything: it is left out.
        if (!options.examples) continue
        const target = keyOfDatabaseId.get(property.relation?.databaseId ?? '') as string
        filters.push({ ...filter, value: filter.value.map((key) => rowId(key, target, `A filter of "${view.name}"`)) })
      }
      return { ...structuredClone(view), id: newId(), filters }
    })
  }

  // 5. The ops: everything but linked views in document order, then each linked view after
  //    the sibling it follows, so that its source exists when it is made.
  const opOf = ({ node, id, parentId }: Placed, afterId?: string | null): Op => {
    let type: Block['type']
    let props: BlockProps
    switch (node.kind) {
      case 'block':
        type = node.type
        props = structuredClone(node.props ?? {})
        break
      case 'database':
        type = 'database'
        props = {
          title: plain(node.title),
          ...(node.icon ? { icon: node.icon } : {}),
          schema: sourceSchema(node.key),
          views: viewsOf(node.views, node.key),
          ...(node.beside ? { beside: true } : {})
        }
        break
      case 'linked':
        type = 'database'
        props = {
          sourceId: databaseId(node.source, 'A linked view'),
          views: viewsOf(node.views, node.source),
          ...(node.title ? { title: plain(node.title) } : {}),
          ...(node.beside ? { beside: true } : {})
        }
        break
      case 'row':
        type = 'page'
        props = { title: plain(node.row.title), ...(node.row.icon ? { icon: node.row.icon } : {}) }
        if (values.has(id)) props.values = values.get(id)
        break
    }
    return { op: 'create', input: afterId === undefined ? { id, type, parentId, props } : { id, type, parentId, props, afterId } }
  }
  const made = new Set<string>()
  const ops: Op[] = []
  for (const item of placed) {
    if (item.node.kind === 'linked') continue
    ops.push(opOf(item))
    made.add(item.id)
  }
  for (const item of placed) {
    if (item.node.kind !== 'linked') continue
    // Everything before it that is a linked view was placed in an earlier turn of this loop.
    const previous = item.before.length ? item.before[item.before.length - 1] : null
    if (previous !== null && !made.has(previous)) throw new Error('A linked view was placed before its sibling')
    ops.push(opOf(item, previous))
    made.add(item.id)
  }
  return { rootId, ops }
}
