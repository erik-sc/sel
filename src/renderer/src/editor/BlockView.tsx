import { memo, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from 'zustand'
import type { Block } from '@shared/types'
import { newId, useBlocks } from '@/store/blocks'
import { Check, ChevronRight, DragHandle, Plus } from '@/ui/icons'
import { DatabaseView } from '@/database/lazy'
import { useEditor } from './context'
import { MIME_DRAG } from './clipboard'
import { PLACEHOLDERS, isTextType } from './blockTypes'
import { blockColorClass } from './richtext-dom'
import { rowWidth, rowsOf } from './layout'
import { useEditorCopy } from './copy'
import { isSelected } from './selection'
import { textSel } from './types'
import { EditableText } from './EditableText'
import { BookmarkBlock, CalloutIcon, CodeBlock, ImageBlock, PageLinkBlock } from './blocks'
import { EquationBlock } from './EquationBlock'
import { AiSlot } from '../ai/slot'
import { useA11yCopy } from '@/a11y/announce'

const HEADING_LEVEL: Partial<Record<Block['type'], number>> = { heading_1: 1, heading_2: 2, heading_3: 3 }

/**
 * A list of sibling blocks. `top` when they are the page's own blocks: only there may any block
 * sit beside another; elsewhere only database blocks do (layout.ts).
 */
export const BlockList = memo(function BlockList({ ids, top = false }: { ids: string[]; top?: boolean }): JSX.Element {
  const blocks = useBlocks(ids)
  const copy = useEditorCopy()
  let n = 0
  const view = (b: Block): JSX.Element => {
    n = b.type === 'numbered_list' ? n + 1 : 0
    return <BlockView key={b.id} block={b} number={n} />
  }
  // Blocks marked `beside` share a row with the one before them: each heads a column (layout.ts).
  const rows = rowsOf(
    blocks.filter((b): b is Block => !!b && !b.trashedAt),
    { top }
  )
  return (
    <>
      {rows.map((row) =>
        row.length > 1 ? (
          <Row key={`row:${row[0].id}`} row={row} label={copy.columns(row.length)}>
            {row.map(view)}
          </Row>
        ) : (
          view(row[0])
        )
      )}
    </>
  )
})

/**
 * A row of columns. While a drag would drop into it, it says so (`is-drop-row`), so its gap lines
 * show: a native drag does not update `:hover`. When it is too narrow for its columns and they
 * wrap one under the other, it says that too (`is-wrapped`): a gap line would then stand in the
 * page's margin and read as a quote bar.
 */
function Row({ row, label, children }: { row: Block[]; label: string; children: JSX.Element[] }): JSX.Element {
  const { ctrl } = useEditor()
  const dropHere = useStore(ctrl.ui, (s) => row.some((b) => b.id === s.drop?.id))
  const ref = useRef<HTMLDivElement>(null)
  const [wrapped, setWrapped] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const read = (): void => {
      const columns = el.querySelectorAll<HTMLElement>(':scope > .blk')
      const first = columns[0]
      const last = columns[columns.length - 1]
      setWrapped(!!first && !!last && last.offsetTop > first.offsetTop + 1)
    }
    const observer = new ResizeObserver(read)
    observer.observe(el)
    read()
    return () => observer.disconnect()
  }, [])
  const classes = ['blk-beside']
  if (rowWidth(row) === 'wide') classes.push('is-wide')
  if (dropHere) classes.push('is-drop-row')
  if (wrapped) classes.push('is-wrapped')
  return (
    <div ref={ref} className={classes.join(' ')} role="group" aria-label={label}>
      {children}
    </div>
  )
}

const BlockView = memo(function BlockView({ block, number }: { block: Block; number: number }): JSX.Element {
  const { ctrl, onOpenPage } = useEditor()
  const a11y = useA11yCopy()
  const id = block.id
  const type = block.type
  const selected = useStore(ctrl.ui, (s) => isSelected(s.selected, id))
  const drop = useStore(ctrl.ui, (s) => (s.drop?.id === id ? s.drop.pos : null))
  const menuOpen = useStore(ctrl.ui, (s) => s.menu?.id === id)
  const aiHere = useStore(ctrl.ui, (s) => s.ai?.anchorId === id)
  const collapsed = type === 'toggle' && !!block.props.collapsed
  const nests = type !== 'page' && type !== 'database'
  const showKids = nests && block.content.length > 0 && !collapsed

  const classes = ['blk', `blk-${type}`]
  if (selected) classes.push('is-selected')
  if (drop) classes.push(`drop-${drop}`)
  if (menuOpen) classes.push('is-menu-open')
  if (aiHere) classes.push('has-ai')
  if (type === 'to_do' && block.props.checked) classes.push('is-checked')
  const cc = blockColorClass(block.props.color)
  if (cc) classes.push(cc)

  let body: JSX.Element
  if (isTextType(type)) {
    body = (
      <>
        {type === 'bulleted_list' && (
          <span className="blk-marker" contentEditable={false}>
            {'•'}
          </span>
        )}
        {type === 'numbered_list' && (
          <span className="blk-marker blk-number" contentEditable={false}>
            {number}.
          </span>
        )}
        {type === 'to_do' && (
          <button
            type="button"
            className="blk-check"
            role="checkbox"
            aria-checked={!!block.props.checked}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ctrl.toggleChecked(id)}
          >
            {block.props.checked && <Check size={12} />}
          </button>
        )}
        {type === 'toggle' && (
          <button
            type="button"
            className="blk-toggle-btn"
            aria-expanded={!collapsed}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ctrl.toggleCollapsed(id)}
          >
            <ChevronRight size={14} />
          </button>
        )}
        {type === 'callout' && <CalloutIcon block={block} />}
        {HEADING_LEVEL[type] ? (
          // A heading says its level; the text inside is still the block's field.
          <div className="blk-heading" role="heading" aria-level={HEADING_LEVEL[type]}>
            <EditableText
              blockId={id}
              mode="block"
              value={block.props.title}
              placeholder={PLACEHOLDERS[type]}
              roleDescription={a11y.block[type]}
            />
          </div>
        ) : (
          <EditableText
            blockId={id}
            mode="block"
            value={block.props.title}
            placeholder={PLACEHOLDERS[type]}
            roleDescription={a11y.block[type]}
          />
        )}
      </>
    )
  } else if (type === 'code') body = <CodeBlock block={block} />
  else if (type === 'equation') body = <EquationBlock block={block} />
  else if (type === 'divider') body = <div className="blk-divider-line" role="separator" />
  else if (type === 'image') body = <ImageBlock block={block} />
  else if (type === 'bookmark') body = <BookmarkBlock block={block} />
  else if (type === 'page') body = <PageLinkBlock block={block} />
  else if (type === 'database') {
    body = (
      <div className="blk-database-box">
        <DatabaseView databaseId={id} inline onOpenPage={onOpenPage} />
      </div>
    )
  } else {
    // A type this version does not know (written by a newer one): show it inert rather than guess.
    body = <div className="blk-placeholder">Unsupported block</div>
  }

  return (
    <div className={classes.join(' ')} data-block-id={id}>
      <div className="blk-row">
        <div className="blk-gutter" contentEditable={false}>
          <button
            type="button"
            className="blk-handle"
            title="Add a block below"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ctrl.insertBelowWithSlash(id)}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="blk-handle blk-drag"
            title="Drag to move, click for options"
            draggable
            onDragStart={(e) => {
              ctrl.flushAll()
              const ids = ctrl.targetIds(id)
              ctrl.dragIds = ids
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(MIME_DRAG, JSON.stringify(ids))
              const el = e.currentTarget.closest('.blk')
              if (el) e.dataTransfer.setDragImage(el, 0, 0)
            }}
            onDragEnd={() => {
              ctrl.dragIds = null
              ctrl.ui.setState({ drop: null })
            }}
            onClick={(e) => {
              if (!ctrl.ui.getState().selected.includes(id)) ctrl.selectBlocks([id])
              ctrl.ui.setState({ menu: { id, rect: e.currentTarget.getBoundingClientRect() } })
            }}
          >
            <DragHandle size={16} />
          </button>
        </div>
        {body}
      </div>
      {showKids && (
        <div className="blk-children">
          <BlockList ids={block.content} />
        </div>
      )}
      {type === 'toggle' && !collapsed && block.content.length === 0 && (
        <button
          type="button"
          className="blk-toggle-empty"
          onClick={() => {
            const child = newId()
            ctrl.commit([{ op: 'create', input: { id: child, type: 'text', parentId: id, afterId: null, props: {} } }], {
              after: textSel(child, 0)
            })
          }}
        >
          Empty toggle. Click to add a block inside.
        </button>
      )}
      {aiHere && <AiSlot anchorId={id} />}
    </div>
  )
})
