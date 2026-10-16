// Templates of pages and databases: what one is made of, as pure data. A template is a tree of
// blocks under one page, with databases (schema, views, example rows) and linked views of them.
// Every id in it is local to the template (a "key"): main gives each block a new id when the
// template is used, and rewrites what points at one (relations, rollups, linked views, the
// links of the example rows) to the new ids. See main/templates/instantiate.ts.
//
// Property ids, select option ids and formulas are those of a database and stay as they are:
// they only have to be unique inside their own database. Pure: no Electron, no React.
import type { Block, BlockProps, BlockType, DatabaseView, PropertySchema, RichText } from '../types'

export const TEMPLATE_LOCALES = ['pt-BR', 'en'] as const
export type TemplateLocale = (typeof TEMPLATE_LOCALES)[number]

export const TEMPLATE_IDS = ['finances', 'household', 'trip', 'project', 'library', 'studies', 'kitchen'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value)
}

export function isTemplateLocale(value: unknown): value is TemplateLocale {
  return typeof value === 'string' && (TEMPLATE_LOCALES as readonly string[]).includes(value)
}

/**
 * A date of an example, worked out on the day the template is used, so examples are always
 * about now: `days` from that day (with an optional wall-clock time and end), or `day` of the
 * month `month` months away (0 = this month), never later than that day when the month is
 * this one or an earlier one (something that already happened, like a payment), or the
 * `weekday` (0 = Sunday … 6 = Saturday) of the week `week` weeks away (0 = this one), a week
 * running from Sunday to Saturday as the "this week" filter counts it.
 */
export type TemplateDate =
  | { days: number; time?: string; endDays?: number; endTime?: string }
  | { month: number; day: number }
  | { week: number; weekday: number }

/**
 * The value of a property in an example row, as the template writes it: like a stored value
 * (shared/types PropertyValue), except that a date is a `TemplateDate` and a relation holds the
 * keys of the rows it links to. A two-way relation is written on one side only: the other
 * side is filled in when the template is used.
 */
export type TemplateValue = string | number | boolean | string[] | TemplateDate | null

/** A view of a database or of a linked view; it gets a new id when the template is used. */
export type TemplateView = Omit<DatabaseView, 'id'>

/** An example row: a page of its database. Rows exist only when examples are wanted. */
export interface TemplateRow {
  key?: string
  title: string
  icon?: string
  values?: Record<string, TemplateValue>
  /** What the row's own page holds. */
  children?: TemplateNode[]
}

/**
 * A database of the template. `schema` is stored as it is, except that a relation's
 * `databaseId` is the key of another database of the template (or its own).
 */
export interface TemplateDatabase {
  kind: 'database'
  key: string
  title: string
  icon?: string
  schema: Record<string, PropertySchema>
  views: TemplateView[]
  rows: TemplateRow[]
  /** Drawn in one row with the database block before it. */
  beside?: boolean
}

/** A linked view of a database of the template (`source` is its key). */
export interface TemplateLinked {
  kind: 'linked'
  key?: string
  source: string
  /** Its own title; the source's when absent. */
  title?: string
  views: TemplateView[]
  beside?: boolean
}

/** Any other block: text, headings, lists, callouts, toggles, sub-pages… */
export interface TemplateBlock {
  kind: 'block'
  key?: string
  type: Exclude<BlockType, 'database'>
  props?: Omit<BlockProps, 'schema' | 'views' | 'values' | 'sourceId' | 'system'>
  children?: TemplateNode[]
}

export type TemplateNode = TemplateBlock | TemplateDatabase | TemplateLinked

/** One template in one language. */
export interface Template {
  id: TemplateId
  locale: TemplateLocale
  /** Shown on the card and given to the page that is made. */
  name: string
  /** One line, on the card. */
  description: string
  /** A line icon (ui/lineIcons.ts) without its `icon:` prefix: the card's and the page's. */
  icon: string
  /** The page the template makes, and everything in it. */
  page: TemplateBlock
}

/** Rich text of one plain run. */
export function plain(text: string): RichText {
  return [[text]]
}

/** Every node of a template, the page first, depth first; example rows' children included. */
export function* templateNodes(template: Template): Generator<TemplateNode> {
  const stack: TemplateNode[] = [template.page]
  while (stack.length) {
    const node = stack.pop() as TemplateNode
    yield node
    const kids: TemplateNode[] =
      node.kind === 'database' ? node.rows.flatMap((row) => row.children ?? []) : node.kind === 'block' ? (node.children ?? []) : []
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
}

/** The databases of a template, in document order. */
export function templateDatabases(template: Template): TemplateDatabase[] {
  return [...templateNodes(template)].filter((node): node is TemplateDatabase => node.kind === 'database')
}

/** What a window asks for when it uses a template (see TemplatesApi). */
export interface TemplateRequest {
  id: TemplateId
  locale: TemplateLocale
  /** Whether the example rows are made too ("with examples") or the databases start empty. */
  examples: boolean
  /** The page the template's page goes under; null for the workspace root. */
  parentId: string | null
}

/** `window.api.templates`: the templates are data every process has; only making one crosses over. */
export interface TemplatesApi {
  /** Makes the template's page and everything in it, in one transaction, and returns the page. */
  create(request: TemplateRequest): Promise<Block>
}
