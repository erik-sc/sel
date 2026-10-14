import { memo } from 'react'
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
import { rowsOf } from './layout'
import { isSelected } from './selection'
import { textSel } from './types'
import { EditableText } from './EditableText'
import { BookmarkBlock, CalloutIcon, CodeBlock, ImageBlock, PageLinkBlock } from './blocks'
import { AiSlot } from '../ai/slot'

export const BlockList = memo(function BlockList({ ids }: { ids: string[] }): JSX.Element {
  const blocks = useBlocks(ids)
  let n = 0
  const view = (b: Block): JSX.Element => {
    n = b.type === 'numbered_list' ? n + 1 : 0
    return <BlockView key={b.id} block={b} number={n} />
  }
  // Database blocks marked `beside` share a row with the one before them (layout.ts).
  const rows = rowsOf(blocks.filter((b): b is Block => !!b && !b.trashedAt))
  return (
    <>
      {rows.map((row) =>
        row.length > 1 ? (
          <div key={`row:${row[0].id}`} className="blk-beside">
            {row.map(view)}
          </div>
        ) : (
          view(row[0])
        )
      )}
    </>
  )
})

const BlockView = memo(function BlockView({ block, number }: { block: Block; number: number }): JSX.Element {
  const { ctrl, onOpenPage } = useEditor()
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
        <EditableText blockId={id} mode="block" value={block.props.title} placeholder={PLACEHOLDERS[type]} />
      </>
    )
  } else if (type === 'code') body = <CodeBlock block={block} />
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
