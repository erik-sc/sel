// Data model shared by main, preload and renderer. Everything is a block.

import type { SystemKind } from './system'

export type BlockType =
  | 'page'
  | 'text'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list'
  | 'numbered_list'
  | 'to_do'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'code'
  | 'divider'
  | 'image'
  | 'bookmark'
  | 'database'
  /** Display math in LaTeX, drawn by KaTeX; the source is `props.title` as plain text, like code. */
  | 'equation'

/** Inline formatting: bold, italic, underline, strike, code, link(url), color(name). */
export type Mark = ['b'] | ['i'] | ['u'] | ['s'] | ['c'] | ['a', string] | ['h', string]

/** A run of text with optional marks. Rich text is `Span[]`. */
export type Span = [text: string, marks?: Mark[]]
export type RichText = Span[]

export interface BlockProps {
  /** Text content of the block (page title for pages/databases). */
  title?: RichText
  /** to_do */
  checked?: boolean
  /** code */
  language?: string
  /**
   * page: a special kind of page. `'latex'`: a LaTeX document, whose source is the plain text of
   * its first `code` child (language `latex`), shown as source and preview side by side.
   */
  kind?: 'latex'
  /** page, callout, database: emoji */
  icon?: string
  /** page: css gradient/colour or image url */
  cover?: string
  /** image, bookmark */
  url?: string
  caption?: RichText
  /** toggle: collapsed state */
  collapsed?: boolean
  /** block colour name (text or `<name>_background`) */
  color?: string
  /** page */
  favorite?: boolean
  fullWidth?: boolean
  /**
   * page / database of the tree: when it was archived. An archived page stays where it is
   * (parent and position kept) but leaves the sidebar, the recent pages and what the AI is
   * shown by itself; search still finds it (see Repository.listArchived).
   */
  archivedAt?: number
  /** database only */
  schema?: Record<string, PropertySchema>
  views?: DatabaseView[]
  /**
   * database only: makes the block a linked view of the database with this id.
   * A linked view owns `views` (and optionally `title` / `icon` as overrides);
   * its schema and rows are always those of the source, its own `content` stays empty.
   */
  sourceId?: string
  /**
   * page / database: makes the block part of the app (the Tasks database). Such a block lives
   * at the workspace root and cannot be deleted, moved or retyped (see shared/system.ts).
   */
  system?: SystemKind
  /** page that is a database row: propertyId -> value */
  values?: Record<string, PropertyValue>
  /** database: drawn in one row with the database block before it (see editor/layout.ts) */
  beside?: boolean
  /** meeting page: the calendar occurrence it was made for (its UID and start, ms), so it is made once */
  meetingEvent?: { uid: string; start: number }
}

export interface Block {
  id: string
  type: BlockType
  /** null for workspace-root pages */
  parentId: string | null
  /** Ordered child block ids. For a database: its row pages. */
  content: string[]
  props: BlockProps
  createdAt: number
  updatedAt: number
  /** Set when the block (a page) is in the trash. */
  trashedAt: number | null
}

// ---- Databases ----

export type PropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'created_time'
  | 'last_edited_time'
  | 'relation'
  | 'rollup'
  | 'formula'

export interface SelectOption {
  id: string
  name: string
  color: string
}

export interface PropertySchema {
  id: string
  name: string
  type: PropertyType
  options?: SelectOption[]
  numberFormat?: 'number' | 'percent' | 'currency'
  /** relation: the database whose rows it links to. */
  relation?: RelationConfig
  /** rollup: what it computes from the rows one of the relations links to. */
  rollup?: RollupConfig
  /** formula: the expression it computes for each row. */
  formula?: FormulaConfig
}

/**
 * A relation links a row to rows (pages) of a database, possibly its own. With
 * `syncedPropertyId` it is two-way: that relation property of the target database
 * holds the same links seen from the other side, and edits keep the two in step
 * (see shared/relation.ts).
 */
export interface RelationConfig {
  databaseId: string
  syncedPropertyId?: string
  /** `one`: at most one linked row. Absent: any number. */
  limit?: 'one'
}

export type RollupFunction =
  | 'show_original'
  | 'count'
  | 'count_values'
  | 'count_unique'
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'range'
  | 'earliest'
  | 'latest'
  | 'percent_checked'

/** A rollup reads `propertyId` of the rows that the relation `relationId` links to, and sums them up with `function`. */
export interface RollupConfig {
  /** A relation property of the same database; absent until one is chosen. */
  relationId?: string
  /** A property of the related database; `count` needs none. */
  propertyId?: string
  /**
   * Only the linked rows that pass every rule count ("Date is this month"). Rules name
   * properties of the related database, and only plain ones (no relation, rollup or
   * formula: no chains). Absent: every linked row.
   */
  filters?: ViewFilter[]
  function: RollupFunction
}

/**
 * A formula computes a value for each row from the row's other properties (see
 * shared/database/formula.ts). `expression` names properties by id, as
 * `prop("<id>")`; the editor shows (and takes) their names instead, so a rename never
 * has to rewrite a formula. Results are never stored.
 */
export interface FormulaConfig {
  expression: string
}

/**
 * title -> stored in block.props.title, not in values.
 * text/url -> string, number -> number, checkbox -> boolean,
 * select -> option id, multi_select -> option ids,
 * date -> { start, end? }: each `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` (a local wall-clock time, no zone);
 * relation -> ids of the linked rows.
 * A rollup or a formula stores nothing: its value is computed whenever it is read.
 */
export type PropertyValue = string | number | boolean | string[] | { start: string; end?: string } | null

export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'chart' | 'calc'

export type ChartKind = 'bar' | 'column' | 'line' | 'area' | 'pie' | 'donut' | 'number'
export type ChartDateBucket = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type ChartAggregate = 'count' | 'count_unique' | 'sum' | 'average' | 'min' | 'max' | 'median' | 'percent_checked'
export type ChartSort = 'x_asc' | 'x_desc' | 'y_asc' | 'y_desc' | 'manual'
export type ChartPalette = 'accent' | 'colourful' | 'options'

/** How a `chart` view turns the rows of its database into a picture (see shared/chart.ts). */
export interface ChartConfig {
  kind: ChartKind
  /** Property id to group by; any type. */
  x?: string
  /** When `x` is a date / created / edited property. */
  xDateBucket?: ChartDateBucket
  y: {
    aggregate: ChartAggregate
    /** Numeric or checkbox property for the aggregates that read values. */
    property?: string
  }
  /** Optional second grouping property: grouped / stacked series. */
  series?: string
  stacked?: boolean
  /** Select options keep their option order under `manual`. */
  sort?: ChartSort
  /** Top N categories; the rest fold into "Other". */
  limit?: number
  /** Include the "No value" group. */
  showEmpty?: boolean
  showValues?: boolean
  showLegend?: boolean
  showGrid?: boolean
  /** line / area: running total along the axis. */
  cumulative?: boolean
  /** `options` uses each select option's own colour. */
  palette?: ChartPalette
  /** Plot height in px; the `--chart-height` token when absent. */
  height?: number
}

/** One figure of a `calc` view: a name and a formula over the view's rows (see shared/database/calc.ts). */
export interface ViewCalc {
  id: string
  name: string
  formula: string
  /** How the result is written; when absent, like the number property it is computed from. */
  format?: 'number' | 'currency' | 'percent'
}

export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'is_empty'
  | 'is_not_empty'
  | 'gt'
  | 'lt'
  | 'checked'
  | 'unchecked'
  /** date-like properties: the value falls in a span named relative to today (`RelativeDate`). */
  | 'date_is'

/**
 * Spans of days counted from today, for the `date_is` operator. A value that covers several
 * days is in a span when any of its days is; `overdue` is before today, `by_today` today or before.
 */
export const RELATIVE_DATES = [
  'today',
  'tomorrow',
  'yesterday',
  'overdue',
  'by_today',
  'next_7_days',
  'past_7_days',
  'this_week',
  'next_week',
  'this_month',
  'last_month',
  'past_30_days',
  'this_year'
] as const
export type RelativeDate = (typeof RELATIVE_DATES)[number]

export interface ViewFilter {
  propertyId: string
  operator: FilterOperator
  value?: PropertyValue
}

export interface ViewSort {
  propertyId: string
  direction: 'asc' | 'desc'
}

export interface DatabaseView {
  id: string
  name: string
  type: ViewType
  /** Property ids in display order; hidden ones are omitted. */
  visibleProperties: string[]
  propertyWidths?: Record<string, number>
  filters: ViewFilter[]
  sorts: ViewSort[]
  /** board: select property id; calendar: date property id */
  groupBy?: string
  /** chart: what is drawn. Kept (but unused) when the view has another type. */
  chart?: ChartConfig
  /** calc: the figures shown. Kept (but unused) when the view has another type. */
  calcs?: ViewCalc[]
}

// ---- Operations ----

export interface CreateBlockInput {
  /** Optional client-generated id (uuid v4). */
  id?: string
  type: BlockType
  parentId: string | null
  props?: BlockProps
  /** Insert after this sibling; null = first; undefined = append. */
  afterId?: string | null
}

export interface UpdateBlockInput {
  type?: BlockType
  /** Shallow-merged into existing props; a key set to null is removed. */
  props?: { [K in keyof BlockProps]?: BlockProps[K] | null }
}

export type Op =
  | { op: 'create'; input: CreateBlockInput }
  | { op: 'update'; id: string; patch: UpdateBlockInput }
  | { op: 'move'; id: string; parentId: string | null; afterId?: string | null }
  | { op: 'delete'; id: string }

export interface SearchResult {
  id: string
  /** Page that contains the hit (same as id when the hit is a page title). */
  pageId: string
  title: string
  icon?: string
  snippet?: string
  /** Titles of ancestor pages, root first. */
  path: string[]
  /** The page that contains the hit is archived, or lies inside one that is. */
  archived?: true
}

export interface ChangeEvent {
  /** Ids of blocks created, updated, moved or deleted. */
  ids: string[]
  /** Identifies the window that made the change (see Api.clientId). */
  origin: string
  /**
   * Pages whose content was replaced as a whole by restoring a version. An editor showing
   * one of them drops its undo history: the recorded steps no longer describe the page.
   */
  reset?: string[]
}

/** One place a database appears: a linked view and the page that contains it (null at the workspace root). */
export interface DatabaseLocation {
  block: Block
  page: Block | null
}

export type Theme = 'light' | 'dark' | 'system'
