// What makes a template sound, written down so tests can hold every template to it: everything
// it points at is in it, every view reads properties its database has, and its two languages
// have the same structure. Pure.
import type { FilterOperator, PropertySchema, PropertyType } from '../types'
import { templateNodes, type Template, type TemplateDatabase, type TemplateNode, type TemplateValue, type TemplateView } from './model'

const REFERENCE = /prop\("([^"]*)"\)/g

/** The property ids a formula reads. */
export function formulaRefs(expression: string): string[] {
  return [...expression.matchAll(REFERENCE)].map((m) => m[1])
}

const COMPUTED: PropertyType[] = ['relation', 'rollup', 'formula']
const OPERATORS: Partial<Record<PropertyType, FilterOperator[]>> = {
  number: ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  select: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  multi_select: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  date: ['equals', 'date_is', 'lt', 'gt', 'is_empty', 'is_not_empty'],
  checkbox: ['checked', 'unchecked'],
  relation: ['contains', 'not_contains', 'is_empty', 'is_not_empty']
}

function isDate(value: TemplateValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    ('days' in v && typeof v.days === 'number') ||
    ('month' in v && typeof v.month === 'number' && typeof v.day === 'number') ||
    ('weekday' in v && typeof v.week === 'number' && typeof v.weekday === 'number' && v.weekday >= 0 && v.weekday <= 6)
  )
}

/** Everything wrong with a template, as sentences; empty when it is sound. */
export function templateProblems(template: Template): string[] {
  const problems: string[] = []
  const nodes = [...templateNodes(template)]
  const databases = new Map<string, TemplateDatabase>()
  const keys = new Set<string>()
  const rowsOf = new Map<string, Set<string>>()
  const claim = (key: string | undefined): void => {
    if (key === undefined) return
    if (keys.has(key)) problems.push(`the key "${key}" is used twice`)
    keys.add(key)
  }
  for (const node of nodes) {
    claim(node.key)
    if (node.kind === 'database') {
      databases.set(node.key, node)
      const rows = new Set<string>()
      for (const row of node.rows) {
        claim(row.key)
        if (row.key) rows.add(row.key)
      }
      rowsOf.set(node.key, rows)
    }
  }
  if (template.page.type !== 'page') problems.push('the template does not make a page')

  for (const db of databases.values()) {
    const at = `database "${db.key}"`
    const schema = db.schema
    if (schema.title?.type !== 'title') problems.push(`${at} has no title property with the id "title"`)
    for (const [id, property] of Object.entries(schema)) {
      if (property.id !== id) problems.push(`${at}: the property under "${id}" says its id is "${property.id}"`)
      if ((property.type === 'select' || property.type === 'multi_select') && !property.options?.length)
        problems.push(`${at}: "${id}" has no options`)
      if (property.type === 'relation') {
        const target = property.relation ? databases.get(property.relation.databaseId) : undefined
        if (!target) {
          problems.push(`${at}: the relation "${id}" points at no database of the template`)
          continue
        }
        const synced = property.relation?.syncedPropertyId
        if (synced) {
          const partner = target.schema[synced]
          if (partner?.type !== 'relation' || partner.relation?.databaseId !== db.key || partner.relation?.syncedPropertyId !== id) {
            problems.push(`${at}: the two-way relation "${id}" has no partner "${synced}" pointing back`)
          }
        }
      }
      if (property.type === 'rollup') {
        const relation = property.rollup?.relationId ? schema[property.rollup.relationId] : undefined
        const target = relation?.type === 'relation' && relation.relation ? databases.get(relation.relation.databaseId) : undefined
        if (!target) problems.push(`${at}: the rollup "${id}" reads no relation of its database`)
        else if (property.rollup?.function !== 'count') {
          const read = property.rollup?.propertyId ? target.schema[property.rollup.propertyId] : undefined
          if (!read || COMPUTED.includes(read.type)) problems.push(`${at}: the rollup "${id}" reads no plain property of "${target.key}"`)
          else if (!rollupFits(property.rollup?.function ?? 'count', read))
            problems.push(`${at}: the rollup "${id}" cannot ${property.rollup?.function} "${read.id}"`)
        }
        // The rows it keeps are chosen by plain properties of the related database (no chains).
        if (target) {
          for (const rule of property.rollup?.filters ?? []) {
            const by = target.schema[rule.propertyId]
            if (!by || COMPUTED.includes(by.type))
              problems.push(`${at}: the rollup "${id}" keeps rows by "${rule.propertyId}", which is no plain property of "${target.key}"`)
            else if (OPERATORS[by.type] && !OPERATORS[by.type]?.includes(rule.operator))
              problems.push(`${at}: the rollup "${id}": "${rule.operator}" does not apply to "${by.id}"`)
            else if (by.type === 'select' && rule.value !== undefined && !by.options?.some((o) => o.id === rule.value))
              problems.push(`${at}: the rollup "${id}" keeps rows by an unknown option`)
          }
        }
      }
      if (property.type === 'formula') {
        const expression = property.formula?.expression ?? ''
        if (!expression) problems.push(`${at}: the formula "${id}" is empty`)
        for (const ref of formulaRefs(expression))
          if (!schema[ref]) problems.push(`${at}: the formula "${id}" reads "${ref}", which is not a property`)
      }
    }
    problems.push(...viewProblems(db.views, schema, at, rowsOf))

    for (const row of db.rows) {
      for (const [id, value] of Object.entries(row.values ?? {})) {
        const where = `${at}, row "${row.title}"`
        const property = schema[id]
        if (!property) {
          problems.push(`${where} has a value for "${id}", which is not a property`)
          continue
        }
        switch (property.type) {
          case 'select':
            if (value !== null && !property.options?.some((o) => o.id === value))
              problems.push(`${where}: "${String(value)}" is not an option of "${id}"`)
            break
          case 'multi_select':
            if (!Array.isArray(value) || value.some((v) => !property.options?.some((o) => o.id === v)))
              problems.push(`${where}: "${id}" holds an unknown option`)
            break
          case 'number':
            if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) problems.push(`${where}: "${id}" is not a number`)
            break
          case 'checkbox':
            if (typeof value !== 'boolean') problems.push(`${where}: "${id}" is not true or false`)
            break
          case 'text':
          case 'url':
            if (typeof value !== 'string') problems.push(`${where}: "${id}" is not text`)
            break
          case 'date':
            if (!isDate(value)) problems.push(`${where}: "${id}" is not a template date`)
            break
          case 'relation': {
            const target = property.relation ? rowsOf.get(property.relation.databaseId) : undefined
            if (!Array.isArray(value) || !target || value.some((key) => !target.has(key)))
              problems.push(`${where}: "${id}" links to a row that is not in its database`)
            else if (property.relation?.limit === 'one' && value.length > 1) problems.push(`${where}: "${id}" holds one link at most`)
            break
          }
          default:
            problems.push(`${where}: "${id}" (${property.type}) cannot store a value`)
        }
      }
    }
  }

  for (const node of nodes) {
    if (node.kind !== 'linked') continue
    const source = databases.get(node.source)
    if (!source) problems.push(`a linked view points at "${node.source}", which is not a database of the template`)
    else problems.push(...viewProblems(node.views, source.schema, `a linked view of "${node.source}"`, rowsOf))
    if (!node.views.length) problems.push(`a linked view of "${node.source}" has no view`)
  }
  return problems
}

/** Whether a property gives a number a chart can add up: a number, a box, a formula written as one, or a numeric rollup. */
function givesNumber(property: PropertySchema | undefined): boolean {
  if (!property) return false
  if (property.type === 'number' || property.type === 'checkbox') return true
  if (property.type === 'formula') return property.numberFormat !== undefined
  return property.type === 'rollup' && !['show_original', 'earliest', 'latest'].includes(property.rollup?.function ?? 'count')
}

function rollupFits(fn: string, read: PropertySchema): boolean {
  if (['show_original', 'count', 'count_values', 'count_unique'].includes(fn)) return true
  if (['sum', 'average', 'min', 'max', 'range'].includes(fn)) return read.type === 'number'
  if (fn === 'percent_checked') return read.type === 'checkbox'
  if (fn === 'earliest' || fn === 'latest') return ['date', 'created_time', 'last_edited_time'].includes(read.type)
  return false
}

function viewProblems(
  list: TemplateView[],
  schema: Record<string, PropertySchema>,
  at: string,
  rowsOf: Map<string, Set<string>>
): string[] {
  const out: string[] = []
  if (!list.length) out.push(`${at} has no view`)
  for (const view of list) {
    const where = `${at}, view "${view.name}"`
    for (const id of view.visibleProperties) if (!schema[id]) out.push(`${where} shows "${id}", which is not a property`)
    if (view.type === 'board' && schema[view.groupBy ?? '']?.type !== 'select') out.push(`${where} is a board without a select to group by`)
    if (view.type === 'calendar' && schema[view.groupBy ?? '']?.type !== 'date') out.push(`${where} is a calendar without a date`)
    for (const sort of view.sorts) if (!schema[sort.propertyId]) out.push(`${where} sorts by "${sort.propertyId}", which is not a property`)
    for (const filter of view.filters) {
      const property = schema[filter.propertyId]
      if (!property) {
        out.push(`${where} filters by "${filter.propertyId}", which is not a property`)
        continue
      }
      const allowed = OPERATORS[property.type]
      if (allowed && !allowed.includes(filter.operator)) out.push(`${where}: "${filter.operator}" does not apply to "${property.id}"`)
      if (property.type === 'select' && filter.value !== undefined && !property.options?.some((o) => o.id === filter.value)) {
        out.push(`${where} filters "${property.id}" by an unknown option`)
      }
      if (property.type === 'relation' && Array.isArray(filter.value)) {
        const rows = property.relation ? rowsOf.get(property.relation.databaseId) : undefined
        if (!rows || filter.value.some((key) => !rows.has(key)))
          out.push(`${where} filters "${property.id}" by a row that is not in its database`)
      }
    }
    if (view.type === 'chart') {
      const chart = view.chart
      if (!chart) out.push(`${where} is a chart with nothing to draw`)
      else {
        for (const id of [chart.x, chart.series]) {
          if (id !== undefined && !schema[id]) out.push(`${where} groups by "${id}", which is not a property`)
        }
        if (chart.y.aggregate !== 'count' && chart.y.aggregate !== 'count_unique' && !givesNumber(schema[chart.y.property ?? ''])) {
          out.push(`${where} adds up "${String(chart.y.property)}", which is not a number`)
        }
      }
    }
    if (view.type === 'calc' && !view.calcs?.length) out.push(`${where} is a calculation view without figures`)
  }
  return out
}

/**
 * The structure of a template without its words: what must be the same in both languages
 * (keys, block types, property ids and types, options, views and what they read, rows).
 */
export function templateShape(template: Template): unknown {
  const shapeOf = (node: TemplateNode): unknown => {
    switch (node.kind) {
      case 'block':
        return { block: node.type, key: node.key, icon: node.props?.icon, children: (node.children ?? []).map(shapeOf) }
      case 'linked':
        return { linked: node.source, key: node.key, beside: !!node.beside, views: node.views.map(viewShape) }
      case 'database':
        return {
          database: node.key,
          beside: !!node.beside,
          schema: Object.values(node.schema).map((p) => ({
            id: p.id,
            type: p.type,
            format: p.numberFormat,
            options: p.options?.map((o) => [o.id, o.color]),
            relation: p.relation,
            rollup: p.rollup,
            reads: p.formula ? formulaRefs(p.formula.expression).sort() : undefined
          })),
          views: node.views.map(viewShape),
          rows: node.rows.map((row) => ({
            key: row.key,
            values: Object.keys(row.values ?? {}).sort(),
            children: (row.children ?? []).length > 0
          }))
        }
    }
  }
  return { id: template.id, icon: template.icon, page: shapeOf(template.page) }
}

function viewShape(view: TemplateView): unknown {
  return {
    type: view.type,
    visible: view.visibleProperties,
    groupBy: view.groupBy,
    filters: view.filters,
    sorts: view.sorts,
    chart: view.chart,
    calcs: view.calcs?.map((c) => [c.id, c.format])
  }
}
