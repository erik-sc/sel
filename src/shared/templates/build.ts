// Small helpers the template files are written with, so that each one reads like the page it
// makes. Pure: they only build the data of ./model.ts.
import type {
  ChartConfig,
  FilterOperator,
  PropertySchema,
  PropertyValue,
  RelativeDate,
  RichText,
  RollupFunction,
  SelectOption,
  ViewCalc,
  ViewFilter,
  ViewSort,
  ViewType
} from '../types'
import {
  plain,
  templateNodes,
  type Template,
  type TemplateBlock,
  type TemplateDatabase,
  type TemplateLinked,
  type TemplateLocale,
  type TemplateNode,
  type TemplateRow,
  type TemplateView
} from './model'

/** Picks the Portuguese or the English of a pair, for the locale a template is built in. */
export type Pick2 = <T>(pt: T, en: T) => T

export function chooser(locale: TemplateLocale): Pick2 {
  return (pt, en) => (locale === 'pt-BR' ? pt : en)
}

// ---- blocks

type Text = string | RichText

const rich = (text: Text): RichText => (typeof text === 'string' ? plain(text) : text)

function block(type: TemplateBlock['type'], props: TemplateBlock['props'] = {}, children?: TemplateNode[]): TemplateBlock {
  return children?.length ? { kind: 'block', type, props, children } : { kind: 'block', type, props }
}

export const page = (title: string, icon: string | undefined, children: TemplateNode[], key?: string): TemplateBlock => ({
  ...block('page', icon ? { title: plain(title), icon } : { title: plain(title) }, children),
  ...(key ? { key } : {})
})
export const h1 = (text: string): TemplateBlock => block('heading_1', { title: plain(text) })
export const h2 = (text: string): TemplateBlock => block('heading_2', { title: plain(text) })
export const h3 = (text: string): TemplateBlock => block('heading_3', { title: plain(text) })
export const p = (text: Text): TemplateBlock => block('text', { title: rich(text) })
export const bullet = (text: Text, children?: TemplateNode[]): TemplateBlock => block('bulleted_list', { title: rich(text) }, children)
export const numbered = (text: Text): TemplateBlock => block('numbered_list', { title: rich(text) })
export const todo = (text: Text, checked = false): TemplateBlock => block('to_do', { title: rich(text), checked })
export const quote = (text: Text): TemplateBlock => block('quote', { title: rich(text) })
export const divider = (): TemplateBlock => block('divider')
export const toggle = (text: Text, children: TemplateNode[]): TemplateBlock => block('toggle', { title: rich(text), collapsed: true }, children)
export const callout = (icon: string, text: Text, color = 'gray_background'): TemplateBlock =>
  block('callout', { icon, title: rich(text), color })

/** Bold, for a run inside rich text. */
export const b = (text: string): [string, [['b']]] => [text, [['b']]]

// ---- properties

export const opt = (id: string, name: string, color: string): SelectOption => ({ id, name, color })

export const prop = {
  title: (name: string): PropertySchema => ({ id: 'title', name, type: 'title' }),
  text: (id: string, name: string): PropertySchema => ({ id, name, type: 'text' }),
  url: (id: string, name: string): PropertySchema => ({ id, name, type: 'url' }),
  date: (id: string, name: string): PropertySchema => ({ id, name, type: 'date' }),
  checkbox: (id: string, name: string): PropertySchema => ({ id, name, type: 'checkbox' }),
  created: (id: string, name: string): PropertySchema => ({ id, name, type: 'created_time' }),
  number: (id: string, name: string, numberFormat?: PropertySchema['numberFormat']): PropertySchema =>
    numberFormat ? { id, name, type: 'number', numberFormat } : { id, name, type: 'number' },
  select: (id: string, name: string, options: SelectOption[]): PropertySchema => ({ id, name, type: 'select', options }),
  multi: (id: string, name: string, options: SelectOption[]): PropertySchema => ({ id, name, type: 'multi_select', options }),
  /** `database` is the key of a database of the template; `synced` the partner property there (two-way). */
  relation: (id: string, name: string, database: string, options: { synced?: string; one?: boolean } = {}): PropertySchema => ({
    id,
    name,
    type: 'relation',
    relation: {
      databaseId: database,
      ...(options.synced ? { syncedPropertyId: options.synced } : {}),
      ...(options.one ? { limit: 'one' as const } : {})
    }
  }),
  /** `filters`: only the related rows these rules keep count ("Date is this month"). */
  rollup: (id: string, name: string, relationId: string, propertyId: string | undefined, fn: RollupFunction, filters?: ViewFilter[]): PropertySchema => ({
    id,
    name,
    type: 'rollup',
    rollup: { relationId, ...(propertyId ? { propertyId } : {}), function: fn, ...(filters?.length ? { filters } : {}) }
  }),
  /** `expression` names properties by id, as `prop("id")`. */
  formula: (id: string, name: string, expression: string, numberFormat?: PropertySchema['numberFormat']): PropertySchema =>
    numberFormat ? { id, name, type: 'formula', formula: { expression }, numberFormat } : { id, name, type: 'formula', formula: { expression } }
}

/** A schema from its properties, in the order given (the order the table shows them in). */
export function schema(...props: PropertySchema[]): Record<string, PropertySchema> {
  return Object.fromEntries(props.map((p) => [p.id, p]))
}

// ---- views

interface ViewOptions {
  filters?: ViewFilter[]
  sorts?: ViewSort[]
  widths?: Record<string, number>
}

function view(type: ViewType, name: string, visible: string[], options: ViewOptions = {}, extra: Partial<TemplateView> = {}): TemplateView {
  return {
    name,
    type,
    // A view always shows the title (the database engine puts it back when it is missing).
    visibleProperties: visible.includes('title') ? visible : ['title', ...visible],
    filters: options.filters ?? [],
    sorts: options.sorts ?? [],
    ...(options.widths ? { propertyWidths: options.widths } : {}),
    ...extra
  }
}

export const views = {
  table: (name: string, visible: string[], options?: ViewOptions) => view('table', name, visible, options),
  list: (name: string, visible: string[], options?: ViewOptions) => view('list', name, visible, options),
  gallery: (name: string, visible: string[], options?: ViewOptions) => view('gallery', name, visible, options),
  board: (name: string, groupBy: string, visible: string[], options?: ViewOptions) => view('board', name, visible, options, { groupBy }),
  calendar: (name: string, dateProperty: string, visible: string[], options?: ViewOptions) =>
    view('calendar', name, visible, options, { groupBy: dateProperty }),
  chart: (name: string, chart: ChartConfig, options?: ViewOptions) => view('chart', name, [], options, { chart }),
  calc: (name: string, calcs: ViewCalc[], options?: ViewOptions) => view('calc', name, [], options, { calcs })
}

const rule = (propertyId: string, operator: FilterOperator, value?: PropertyValue): ViewFilter =>
  value === undefined ? { propertyId, operator } : { propertyId, operator, value }

export const where = {
  is: (propertyId: string, value: PropertyValue) => rule(propertyId, 'equals', value),
  isNot: (propertyId: string, value: PropertyValue) => rule(propertyId, 'not_equals', value),
  date: (propertyId: string, span: RelativeDate) => rule(propertyId, 'date_is', span),
  checked: (propertyId: string) => rule(propertyId, 'checked'),
  unchecked: (propertyId: string) => rule(propertyId, 'unchecked'),
  lessThan: (propertyId: string, value: number) => rule(propertyId, 'lt', value),
  greaterThan: (propertyId: string, value: number) => rule(propertyId, 'gt', value),
  empty: (propertyId: string) => rule(propertyId, 'is_empty'),
  notEmpty: (propertyId: string) => rule(propertyId, 'is_not_empty'),
  /** A relation that links to all of these rows (keys of the template). */
  links: (propertyId: string, rows: string[]) => rule(propertyId, 'contains', rows)
}

export const asc = (propertyId: string): ViewSort => ({ propertyId, direction: 'asc' })
export const desc = (propertyId: string): ViewSort => ({ propertyId, direction: 'desc' })

export const calc = (id: string, name: string, formula: string, format?: ViewCalc['format']): ViewCalc =>
  format ? { id, name, formula, format } : { id, name, formula }

// ---- databases

export function database(
  key: string,
  title: string,
  icon: string | undefined,
  props: Record<string, PropertySchema>,
  dbViews: TemplateView[],
  rows: TemplateRow[],
  beside?: boolean
): TemplateDatabase {
  return { kind: 'database', key, title, ...(icon ? { icon } : {}), schema: props, views: dbViews, rows, ...(beside ? { beside } : {}) }
}

export function linked(source: string, linkedViews: TemplateView[], options: { title?: string; beside?: boolean; key?: string } = {}): TemplateLinked {
  return { kind: 'linked', source, views: linkedViews, ...options }
}

export function row(key: string | undefined, title: string, values: TemplateRow['values'] = {}, children?: TemplateNode[]): TemplateRow {
  return { ...(key ? { key } : {}), title, values, ...(children?.length ? { children } : {}) }
}

/** `days` from the day the template is used, with an optional time and end. */
export const inDays = (days: number, time?: string, endDays?: number, endTime?: string) => ({
  days,
  ...(time ? { time } : {}),
  ...(endDays !== undefined ? { endDays } : {}),
  ...(endTime ? { endTime } : {})
})

/** The `day` of the month `month` months away (0 = this one); never later than the day the template is used. */
export const ofMonth = (month: number, day: number) => ({ month, day })

/** The `weekday` (0 = Sunday … 6 = Saturday) of the week `week` weeks away (0 = this one), Sunday first. */
export const onWeekday = (weekday: number, week = 0) => ({ week, weekday })

/** A line icon, stored as `icon:<name>`. */
export const line = (name: string): string => `icon:${name}`

// ---- column widths

const COLUMN: Partial<Record<PropertySchema['type'], number>> = {
  title: 200,
  text: 170,
  url: 150,
  number: 110,
  select: 120,
  multi_select: 150,
  date: 120,
  checkbox: 90,
  relation: 150,
  rollup: 120,
  formula: 130,
  created_time: 120
}
/** About what an inline database gets of the page's width: a table this wide needs no scrolling. */
const TABLE_WIDTH = 740

/**
 * Gives the table views of a template columns sized to their property types, narrowed to fit
 * the page when that costs them little (a table with many columns keeps its widths and scrolls).
 * Widths already written by the template stay.
 */
export function fitColumns(template: Template): Template {
  const schemas = new Map<string, Record<string, PropertySchema>>()
  for (const node of templateNodes(template)) if (node.kind === 'database') schemas.set(node.key, node.schema)
  for (const node of templateNodes(template)) {
    if (node.kind === 'block') continue
    const schema = schemas.get(node.kind === 'database' ? node.key : node.source)
    if (!schema) continue
    for (const v of node.views) {
      if (v.type !== 'table') continue
      const widths: Record<string, number> = {}
      for (const id of v.visibleProperties) widths[id] = COLUMN[schema[id]?.type ?? 'text'] ?? 150
      const total = Object.values(widths).reduce((sum, w) => sum + w, 0)
      const scale = total > TABLE_WIDTH && TABLE_WIDTH / total >= 0.8 ? TABLE_WIDTH / total : 1
      for (const id of Object.keys(widths)) widths[id] = Math.floor(widths[id] * scale)
      v.propertyWidths = { ...widths, ...v.propertyWidths }
    }
  }
  return template
}
