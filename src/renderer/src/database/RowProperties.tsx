import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useBlock } from '@/store/blocks'
import { Plus } from '@/ui/icons'
import * as L from './logic'
import { PropertyCell } from './cells'
import { TypeIcon } from './common'
import { AddPropertyMenu, PropertyMenu } from './propertyMenus'
import './database.css'

/**
 * Vertical property list (name | editable value) shown at the top of a page
 * that is a database row. Renders nothing for ordinary pages.
 */
export function RowProperties(props: { pageId: string }): JSX.Element | null {
  const { pageId } = props
  const page = useBlock(pageId)
  const parent = useBlock(page?.parentId ?? null)
  const isRow = !!page && !!parent && parent.type === 'database'

  // Cached by identity: stable while the stored schema is.
  const schema = useMemo(() => L.normalizeDatabase(isRow ? parent : undefined).schema, [isRow, parent])
  const properties = useMemo(() => L.orderedProperties(schema).filter((p) => p.type !== 'title'), [schema])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ propId: string; anchor: HTMLElement } | null>(null)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setEditingId(null)
    setMenu(null)
    setAddAnchor(null)
  }, [pageId])

  if (!isRow || !page || !parent) return null
  const databaseId = parent.id
  const menuProp = menu ? L.propOf(schema, menu.propId) : undefined

  return (
    <div className="db-row-properties">
      {properties.map((prop) => (
        <div className="db-row-property" key={prop.id}>
          <button
            type="button"
            className={menu?.propId === prop.id ? 'db-row-property-name is-active' : 'db-row-property-name'}
            title={prop.name}
            onClick={(event) => {
              const anchor = event.currentTarget
              setMenu((prev) => (prev?.propId === prop.id ? null : { propId: prop.id, anchor }))
            }}
          >
            <TypeIcon type={prop.type} />
            <span>{prop.name}</span>
          </button>
          <div className={editingId === prop.id ? 'db-row-property-value is-editing' : 'db-row-property-value'}>
            <PropertyCell
              databaseId={databaseId}
              row={page}
              prop={prop}
              editing={editingId === prop.id}
              placeholder="Empty"
              onStartEdit={() => setEditingId(prop.id)}
              onStopEdit={(move) => {
                if (!move) {
                  setEditingId(null)
                  return
                }
                const index = properties.findIndex((p) => p.id === prop.id)
                const next = properties[index + (move === 'next' ? 1 : -1)]
                setEditingId(next && next.type !== 'checkbox' && !L.isComputedType(next.type) ? next.id : null)
              }}
            />
          </div>
        </div>
      ))}
      <button type="button" className="db-row-property-add" onClick={(event) => setAddAnchor(event.currentTarget)}>
        <Plus size={14} /> Add a property
      </button>

      {menu && menuProp && (
        <PropertyMenu
          key={menuProp.id}
          databaseId={databaseId}
          prop={menuProp}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      )}
      {addAnchor && <AddPropertyMenu databaseId={databaseId} anchor={addAnchor} onClose={() => setAddAnchor(null)} />}
    </div>
  )
}
