// A read-only rendering of a snapshot, in the editor's own block styles (editor.css) but with
// none of its machinery: no contenteditable, no controller, no store. With a diff, differences
// against the current page are marked: added / removed / changed / moved blocks, word-level
// insertions and deletions, and changed properties in words.
import { Fragment, memo, useMemo } from 'react'
import type { JSX, ReactNode } from 'react'
import type { DatabaseView, PropertySchema, PropertyValue, RichText } from '@shared/types'
import type { SnapshotBlock, SnapshotContent, SnapshotRef, SnapshotRow } from '@shared/versions'
import { DEFAULT_CALLOUT_ICON, isTextType } from '@/editor/blockTypes'
import { rowsOf } from '@/editor/layout'
import { blockColorClass, classesForMarks, parseRichText, slice } from '@/editor/richtext-dom'
import { isSafeImageUrl, sanitizeHref } from '@/editor/sanitize'
import { formatValue, orderedProperties, sanitizeValue, VIEW_LABELS } from '@/database/logic/values'
import { ArrowUpRight, Check, ChevronRight, Database as DatabaseIcon, DatabaseLinked, Image as ImageIcon, Link as LinkIcon, Page as PageIcon } from '@/ui/icons'
import type { BlockChange, PropChange, RowChange, TreeDiff, WordOp } from './diff'
import { IconGlyph } from '@/ui/IconGlyph'

interface Lookup {
  blocks: Map<string, SnapshotBlock>
  refs: Map<string, SnapshotRef>
  /** Nested pages the version itself names (the others are only in the current page). */
  versionRefs: Set<string>
  diff: TreeDiff | null
}

// ------------------------------------------------------------------ rich text

function Spans({ value }: { value: RichText }): JSX.Element {
  return (
    <>
      {value.map((span, index) => {
        const marks = span[1] ?? []
        if (!marks.length) return <Fragment key={index}>{span[0]}</Fragment>
        const link = marks.find((mark) => mark[0] === 'a')
        return (
          <span key={index} className={classesForMarks(marks).join(' ')} title={link ? link[1] : undefined}>
            {span[0]}
          </span>
        )
      })}
    </>
  )
}

/**
 * Rich text, optionally with word-level changes. The unchanged and inserted stretches are
 * cut out of the version's own rich text (so they keep their formatting); deleted ones are
 * what the current page has there, as plain text.
 */
function Rich({ value, ops, className, placeholder }: { value: RichText | undefined; ops?: WordOp[]; className?: string; placeholder?: string }): JSX.Element {
  const clean = useMemo(() => parseRichText(value), [value])
  let content: ReactNode
  if (!ops) content = <Spans value={clean} />
  else {
    let offset = 0
    content = ops.map((op, index) => {
      if (op.kind === 'delete') {
        return (
          <del key={index} className="vh-del">
            {op.text}
          </del>
        )
      }
      const part = slice(clean, offset, offset + op.text.length)
      offset += op.text.length
      if (op.kind === 'equal') return <Spans key={index} value={part} />
      return (
        <ins key={index} className="vh-ins">
          <Spans value={part} />
        </ins>
      )
    })
  }
  return (
    <div className={className ? `rt ${className}` : 'rt'} data-placeholder={placeholder}>
      {content}
    </div>
  )
}

// ---------------------------------------------------------------- change marks

function markOf(change: { status: string; moved: boolean } | undefined): { className: string; glyph: string; label: string } | null {
  if (!change) return null
  if (change.status === 'added') return { className: 'vh-added', glyph: '+', label: 'Added in this version' }
  if (change.status === 'removed') return { className: 'vh-removed', glyph: '−', label: 'Not in this version' }
  if (change.status === 'changed') {
    return { className: change.moved ? 'vh-changed vh-moved' : 'vh-changed', glyph: '•', label: change.moved ? 'Changed and moved' : 'Changed' }
  }
  if (change.moved) return { className: 'vh-moved', glyph: '↕', label: 'In another place' }
  return null
}

function Mark({ mark }: { mark: { glyph: string; label: string } }): JSX.Element {
  return (
    <span className="vh-mark" role="img" aria-label={mark.label} title={mark.label}>
      {mark.glyph}
    </span>
  )
}

/** Changed properties in words: what the page has now, struck, then what the version has. */
function PropList({ changes, note }: { changes: PropChange[]; note?: string }): JSX.Element | null {
  if (!changes.length && !note) return null
  return (
    <ul className="vh-props">
      {changes.map((change, index) => (
        <li key={index}>
          <span className="vh-prop-label">{change.label}</span>
          <del className="vh-del">{change.from}</del>
          <span className="vh-arrow" aria-hidden="true">
            →
          </span>
          <ins className="vh-ins">{change.to}</ins>
        </li>
      ))}
      {note && <li className="vh-prop-note">{note}</li>}
    </ul>
  )
}

// ---------------------------------------------------------------------- blocks

function RefBlock({ entry, change, fromVersion }: { entry: SnapshotRef; change: BlockChange | undefined; fromVersion: boolean }): JSX.Element {
  const mark = markOf(change)
  const note =
    change?.status === 'added'
      ? 'Not in the page now. Restoring puts it back if it still exists.'
      : change?.moved
        ? fromVersion
          ? 'In another place in the page now.'
          : 'Not in this version. A restore keeps it, at the end of the page.'
        : null
  return (
    <div className={`blk blk-${entry.type}${mark ? ` ${mark.className}` : ''}`}>
      <div className="blk-row">
        {mark && <Mark mark={mark} />}
        <div className="blk-pagelink vh-ref">
          <span className="blk-pagelink-icon">{entry.icon ? <IconGlyph icon={entry.icon} /> : entry.type === 'database' ? <DatabaseIcon size={16} /> : <PageIcon size={16} />}</span>
          <span className={entry.title ? 'blk-pagelink-title' : 'blk-pagelink-title is-empty'}>{entry.title || 'Untitled'}</span>
          <span className="vh-ref-note">{entry.type === 'database' ? 'Database with its own history' : 'Page with its own history'}</span>
        </div>
      </div>
      {note && <PropList changes={[]} note={note} />}
    </div>
  )
}

function viewNames(views: DatabaseView[] | undefined): string {
  if (!Array.isArray(views) || !views.length) return 'No views'
  return views.map((view) => `${view.name || 'Untitled'} (${(VIEW_LABELS[view.type] ?? view.type).toLowerCase()})`).join(', ')
}

function BlockBody({ block, change, number }: { block: SnapshotBlock; change: BlockChange | undefined; number: number }): JSX.Element {
  const { type, props } = block
  if (isTextType(type)) {
    return (
      <>
        {type === 'bulleted_list' && <span className="blk-marker">•</span>}
        {type === 'numbered_list' && <span className="blk-marker blk-number">{number}.</span>}
        {type === 'to_do' && (
          <span className="blk-check" role="img" aria-label={props.checked ? 'Checked' : 'Not checked'}>
            {props.checked && <Check size={12} />}
          </span>
        )}
        {type === 'toggle' && (
          <span className="blk-toggle-btn" aria-expanded="true" aria-hidden="true">
            <ChevronRight size={14} />
          </span>
        )}
        {type === 'callout' && <span className="blk-callout-icon">{props.icon ?? DEFAULT_CALLOUT_ICON}</span>}
        <Rich value={props.title} ops={change?.text} />
      </>
    )
  }
  if (type === 'code') {
    return (
      <div className="blk-code-box">
        <div className="blk-code-bar vh-code-bar">
          <span className="blk-code-lang">{props.language ?? 'plain text'}</span>
        </div>
        <Rich value={props.title} ops={change?.text} className="blk-code-area vh-code" />
      </div>
    )
  }
  if (type === 'divider') return <div className="blk-divider-line" role="separator" />
  if (type === 'image') {
    if (!isSafeImageUrl(props.url)) {
      return (
        <div className="blk-placeholder">
          <ImageIcon size={16} />
          <span>Empty image</span>
        </div>
      )
    }
    return (
      <figure className="blk-figure">
        <img src={props.url} alt="" draggable={false} />
        <Rich value={props.caption} className="blk-caption" />
      </figure>
    )
  }
  if (type === 'bookmark') {
    const href = sanitizeHref(props.url)
    if (!href) {
      return (
        <div className="blk-placeholder">
          <LinkIcon size={16} />
          <span>Empty bookmark</span>
        </div>
      )
    }
    let host = href
    try {
      host = new URL(href).hostname.replace(/^www\./, '')
    } catch {
      /* keep the raw href */
    }
    return (
      <div className="blk-bookmark">
        <div className="blk-bookmark-text">
          <div className="blk-bookmark-host">{host}</div>
          <div className="blk-bookmark-url">{href}</div>
        </div>
        <ArrowUpRight size={16} />
      </div>
    )
  }
  if (type === 'database') {
    // Below the root a database block is always a linked view: it shows another database.
    return (
      <div className="blk-pagelink vh-ref">
        <span className="blk-pagelink-icon">
          <DatabaseLinked size={16} />
        </span>
        <span className="blk-pagelink-title">Linked view of a database</span>
        <span className="vh-ref-note">{viewNames(props.views)}</span>
      </div>
    )
  }
  return <div className="blk-placeholder">Unsupported block</div>
}

const BlockList = memo(function BlockList({ ids, lookup }: { ids: string[]; lookup: Lookup }): JSX.Element {
  let number = 0
  const item = (id: string): JSX.Element | null => {
    const change = lookup.diff?.blocks.get(id)
    const entry = lookup.refs.get(id)
    if (entry) {
      number = 0
      return <RefBlock key={id} entry={entry} change={change} fromVersion={lookup.versionRefs.has(id)} />
    }
    const block = lookup.blocks.get(id)
    if (!block) return null
    number = block.type === 'numbered_list' ? number + 1 : 0
    return <BlockItem key={id} block={block} change={change} number={number} lookup={lookup} />
  }
  // Rows as the editor draws them (editor/layout.ts); a reference records no place of its own.
  const placed = ids.flatMap((id) => {
    const entry = lookup.refs.get(id)
    if (entry) return [{ id, type: entry.type, props: {} }]
    const block = lookup.blocks.get(id)
    return block ? [{ id, type: block.type, props: block.props }] : []
  })
  return (
    <>
      {rowsOf(placed).map((row) =>
        row.length > 1 ? (
          <div key={`row:${row[0].id}`} className="blk-beside">
            {row.map((entry) => item(entry.id))}
          </div>
        ) : (
          item(row[0].id)
        )
      )}
    </>
  )
})

function BlockItem({ block, change, number, lookup }: { block: SnapshotBlock; change: BlockChange | undefined; number: number; lookup: Lookup }): JSX.Element {
  const mark = markOf(change)
  const classes = ['blk', `blk-${block.type}`]
  if (block.type === 'to_do' && block.props.checked) classes.push('is-checked')
  const color = blockColorClass(block.props.color)
  if (color) classes.push(color)
  if (mark) classes.push(mark.className)
  const kids = lookup.diff?.children.get(block.id) ?? block.content
  const note = change?.textTooLarge ? 'The text changed. It is too long to compare word by word.' : undefined
  return (
    <div className={classes.join(' ')}>
      <div className="blk-row">
        {mark && <Mark mark={mark} />}
        <BlockBody block={block} change={change} number={number} />
      </div>
      {change && <PropList changes={change.props} note={note} />}
      {kids.length > 0 && (
        <div className="blk-children">
          <BlockList ids={kids} lookup={lookup} />
        </div>
      )}
    </div>
  )
}

// -------------------------------------------------------------------- database

function cellText(prop: PropertySchema, value: PropertyValue | undefined, row: SnapshotRow | undefined): string {
  if (prop.type === 'created_time') return row ? formatValue(row.createdAt, prop) : ''
  // A rollup or a formula is computed from other rows or cells, which a version does not hold; a relation shows how many it links.
  if (prop.type === 'last_edited_time' || prop.type === 'rollup' || prop.type === 'formula') return ''
  return formatValue(sanitizeValue(prop, value ?? null), prop)
}

function RowLine({ row, change, properties, inVersion }: { row: SnapshotRow; change: RowChange | undefined; properties: PropertySchema[]; inVersion: boolean }): JSX.Element {
  const mark = markOf(change)
  const cells = new Map((change?.cells ?? []).map((cell) => [cell.propertyId, cell]))
  const classes = [mark?.className, !inVersion ? 'vh-later' : ''].filter(Boolean).join(' ')
  return (
    <tr className={classes || undefined}>
      {properties.map((prop) => {
        if (prop.type === 'title') {
          return (
            <th key={prop.id} scope="row">
              <span className="vh-cell-title">
                {mark && <Mark mark={mark} />}
                {row.icon && <span className="vh-cell-icon">
                    <IconGlyph icon={row.icon} />
                  </span>}
                <Rich value={row.title} ops={change?.title} placeholder="Untitled" />
              </span>
              {!inVersion && <span className="vh-ref-note">Added since. A restore keeps it.</span>}
            </th>
          )
        }
        const cell = cells.get(prop.id)
        const now = cellText(prop, Object.hasOwn(row.values, prop.id) ? row.values[prop.id] : undefined, row)
        if (!cell) return <td key={prop.id}>{now}</td>
        const before = cellText(prop, cell.from, undefined)
        return (
          <td key={prop.id} className="vh-cell-changed">
            {before && <del className="vh-del">{before}</del>}
            {before && now && ' '}
            {now ? <ins className="vh-ins">{now}</ins> : !before ? null : <span className="vh-empty">Empty</span>}
          </td>
        )
      })}
    </tr>
  )
}

function DatabaseTable({ version, current, diff }: { version: SnapshotContent; current: SnapshotContent | null; diff: TreeDiff | null }): JSX.Element {
  const root = version.blocks[0]
  const properties = useMemo(() => orderedProperties(root.props.schema ?? {}), [root.props.schema])
  const versionRows = useMemo(() => new Map((version.rows ?? []).map((row) => [row.id, row])), [version.rows])
  const currentRows = useMemo(() => new Map((current?.rows ?? []).map((row) => [row.id, row])), [current])
  const order = diff ? diff.rowOrder : (version.rows ?? []).map((row) => row.id)
  return (
    <>
      <p className="vh-db-views">Views: {viewNames(root.props.views)}</p>
      {diff && <PropList changes={diff.schema} />}
      {order.length === 0 ? (
        <p className="vh-db-empty">This database had no rows.</p>
      ) : (
        <div className="vh-table-wrap">
          <table className="vh-table">
            <thead>
              <tr>
                {properties.map((prop) => (
                  <th key={prop.id} scope="col">
                    {prop.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map((id) => {
                const row = versionRows.get(id) ?? currentRows.get(id)
                if (!row) return null
                return <RowLine key={id} row={row} change={diff?.rows.get(id)} properties={properties} inVersion={versionRows.has(id)} />
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------------------------ page

/**
 * The blocks of a snapshot without the page around them (no title, no scrolling): for content
 * shown read-only somewhere else, such as an AI answer before it is accepted into a page.
 */
export function SnapshotBlocks({ content }: { content: SnapshotContent }): JSX.Element {
  const lookup = useMemo<Lookup>(
    () => ({ blocks: new Map(content.blocks.map((block) => [block.id, block])), refs: new Map(), versionRefs: new Set(), diff: null }),
    [content]
  )
  return <BlockList ids={content.blocks[0]?.content ?? []} lookup={lookup} />
}

export interface SnapshotViewProps {
  version: SnapshotContent
  /** The page as it is now: where removed blocks and rows are read from. */
  current: SnapshotContent | null
  /** Null hides the changes and shows the version as it was. */
  diff: TreeDiff | null
}

/** One snapshot, read-only. Scrolls on its own. */
export function SnapshotView({ version, current, diff }: SnapshotViewProps): JSX.Element {
  const lookup = useMemo<Lookup>(() => {
    const blocks = new Map<string, SnapshotBlock>()
    const refs = new Map<string, SnapshotRef>()
    // Blocks and references the version lacks are only reachable through a diff.
    for (const b of current?.blocks ?? []) blocks.set(b.id, b)
    for (const r of current?.refs ?? []) refs.set(r.id, r)
    for (const b of version.blocks) blocks.set(b.id, b)
    for (const r of version.refs) refs.set(r.id, r)
    return { blocks, refs, versionRefs: new Set(version.refs.map((r) => r.id)), diff }
  }, [version, current, diff])

  const root = version.blocks[0]
  const change = diff?.blocks.get(root.id)
  const isDatabase = root.type === 'database'
  const linked = isDatabase && typeof root.props.sourceId === 'string'
  const kids = diff?.children.get(root.id) ?? root.content
  const mark = markOf(change)

  return (
    <div className={`pe-root vh-doc${diff ? ' is-diff' : ''}`} tabIndex={-1}>
      <div className={`pe-content pe-head${root.props.icon ? ' has-icon' : ''}`}>
        {root.props.icon && <div className="pe-icon">
            <IconGlyph icon={root.props.icon} />
          </div>}
        <div className={`vh-title${mark ? ` ${mark.className}` : ''}`}>
          <Rich value={root.props.title} ops={change?.text} className="pe-title" placeholder="Untitled" />
        </div>
        {change && <PropList changes={change.props} />}
      </div>
      <div className="pe-content pe-body">
        {linked ? (
          <p className="vh-db-views">Linked view of a database. Views: {viewNames(root.props.views)}</p>
        ) : isDatabase ? (
          <DatabaseTable version={version} current={current} diff={diff} />
        ) : kids.length ? (
          <BlockList ids={kids} lookup={lookup} />
        ) : (
          <p className="vh-db-empty">This page was empty.</p>
        )}
      </div>
    </div>
  )
}
