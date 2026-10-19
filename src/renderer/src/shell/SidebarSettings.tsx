// Settings → Sidebar: every item, zone by zone, to drag into another order (or move with
// Alt+↑/↓), to show or hide, and a way back to the default. Writes the synced `sidebar` setting.
import { useEffect, useRef, useState } from 'react'
import type { DragEvent, JSX, KeyboardEvent } from 'react'
import {
  dropItem,
  isDefaultSidebar,
  isMiddleItem,
  sidebarOrder,
  stepItem,
  zoneOf,
  type SidebarItemId,
  type SidebarZone
} from '@shared/sidebar'
import { acceleratorOf, formatAccelerator } from '@shared/shortcuts'
import { Button } from '@/ui/Button'
import { DragHandle } from '@/ui/icons'
import { IS_MAC } from '@/ui/platform'
import { SIDEBAR_ITEM_DEFS, useAvailableItem } from './sidebarItems'
import { restoreSidebar, setSidebarItemHidden, setSidebarOrder, useLayout, useSidebarCopy } from './sidebarLayout'
import './sidebar.css'

const ZONES: SidebarZone[] = ['top', 'middle', 'footer']
const PALETTE = formatAccelerator(acceleratorOf('command-palette', IS_MAC) ?? '', IS_MAC)

/** Where a dragged item would land: before or after a row, or at the end of a zone. */
type Drop = { zone: SidebarZone; target: SidebarItemId | null; side: 'before' | 'after' }

export function SidebarSection(): JSX.Element {
  const copy = useSidebarCopy()
  const layout = useLayout()
  const available = useAvailableItem()
  const order = sidebarOrder(layout)
  const listed = order.filter(available)
  const hidden = new Set(layout?.hidden ?? [])
  const [dragging, setDragging] = useState<SidebarItemId | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [said, setSaid] = useState('')
  const rows = useRef(new Map<SidebarItemId, HTMLElement>())
  // A row moved with the keyboard into another zone is a new element: the focus follows it.
  const [refocus, setRefocus] = useState<SidebarItemId | null>(null)

  useEffect(() => {
    if (refocus === null) return
    rows.current.get(refocus)?.focus()
    setRefocus(null)
  })

  const zoneIds = (zone: SidebarZone): SidebarItemId[] => listed.filter((id) => zoneOf(order, id) === zone)

  const announce = (next: SidebarItemId[], id: SidebarItemId): void => {
    const zone = zoneOf(next, id)
    const inZone = next.filter((other) => available(other) && zoneOf(next, other) === zone)
    setSaid(copy.moved(copy.items[id], inZone.indexOf(id) + 1, inZone.length, copy.zones[zone]))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, id: SidebarItemId): void => {
    if (event.target !== event.currentTarget) return
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
      // Plain arrows walk the list.
      if (!event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        const at = listed.indexOf(id) + (event.key === 'ArrowUp' ? -1 : 1)
        if (at >= 0 && at < listed.length) rows.current.get(listed[at])?.focus()
      }
      return
    }
    event.preventDefault()
    const next = stepItem(order, listed, id, event.key === 'ArrowUp' ? -1 : 1)
    if (!next) return
    void setSidebarOrder(next)
    announce(next, id)
    setRefocus(id)
  }

  const allowed = (zone: SidebarZone): boolean => dragging !== null && isMiddleItem(dragging) === (zone === 'middle')

  const onDragOver = (event: DragEvent<HTMLDivElement>, zone: SidebarZone): void => {
    if (!allowed(zone)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const row = (event.target as Element).closest<HTMLElement>('[data-sbs-item]')
    const target = (row?.dataset['sbsItem'] as SidebarItemId | undefined) ?? null
    let side: Drop['side'] = 'after'
    if (row) {
      const box = row.getBoundingClientRect()
      side = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
    }
    if (drop?.zone !== zone || drop.target !== target || drop.side !== side) setDrop({ zone, target, side })
  }

  const onDrop = (event: DragEvent<HTMLDivElement>, zone: SidebarZone): void => {
    event.preventDefault()
    const id = dragging
    setDragging(null)
    setDrop(null)
    if (!id || !drop || drop.zone !== zone) return
    let before: SidebarItemId | null = drop.target
    if (before !== null && drop.side === 'after') {
      const ids = zoneIds(zone).filter((other) => other !== id)
      before = ids[ids.indexOf(before) + 1] ?? null
    }
    if (before === id) return
    const next = dropItem(order, id, zone, before)
    if (!next) return
    void setSidebarOrder(next)
    announce(next, id)
  }

  return (
    <div className="settings2-scroll">
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{copy.itemsTitle}</h3>
        </div>
        <p className="ap-note" id="sbs-help">
          {copy.itemsHelp(PALETTE)}
        </p>
        {ZONES.map((zone) => {
          const ids = zoneIds(zone)
          const atEnd = drop?.zone === zone && drop.target === null
          return (
            <div key={zone} className="sbs-zone">
              <h4 className="sbs-zone-title">
                {copy.zones[zone]}
                {zone === 'middle' && <span className="sbs-zone-help">{copy.middleHelp}</span>}
              </h4>
              <div
                className={atEnd ? 'ap-list sbs-list drop-end' : 'ap-list sbs-list'}
                role="list"
                aria-label={copy.zones[zone]}
                onDragOver={(event) => onDragOver(event, zone)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null)
                }}
                onDrop={(event) => onDrop(event, zone)}
              >
                {ids.length === 0 && <div className="sbs-empty-zone">—</div>}
                {ids.map((id) => {
                  const def = SIDEBAR_ITEM_DEFS[id]
                  const label = copy.items[id]
                  const isHidden = hidden.has(id)
                  const mark = drop?.zone === zone && drop.target === id ? ` drop-${drop.side}` : ''
                  return (
                    <div
                      key={id}
                      ref={(element) => {
                        if (element) rows.current.set(id, element)
                        else rows.current.delete(id)
                      }}
                      data-sbs-item={id}
                      className={`ap-row sbs-row${isHidden ? ' is-hidden' : ''}${dragging === id ? ' is-dragging' : ''}${mark}`}
                      role="listitem"
                      tabIndex={0}
                      aria-label={label}
                      aria-describedby="sbs-help"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', id)
                        setDragging(id)
                      }}
                      onDragEnd={() => {
                        setDragging(null)
                        setDrop(null)
                      }}
                      onKeyDown={(event) => onKeyDown(event, id)}
                    >
                      <span className="sbs-handle" aria-hidden="true">
                        <DragHandle />
                      </span>
                      <span className="sbs-row-name">
                        <span className="sbs-row-icon" aria-hidden="true">
                          {def.icon}
                        </span>
                        <span className="ap-row-label">{label}</span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        className="sbs-switch"
                        aria-checked={!isHidden}
                        aria-label={copy.show(label)}
                        onClick={() => void setSidebarItemHidden(id, !isHidden)}
                      >
                        <span className="sbs-switch-track" aria-hidden="true">
                          <span className="sbs-switch-thumb" />
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="sbs-live" aria-live="polite">
          {said}
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{copy.restore}</span>
              <span className="ap-row-help">{copy.restoreHelp}</span>
            </div>
            <div className="ap-row-control">
              <Button disabled={isDefaultSidebar(layout)} onClick={() => void restoreSidebar()}>
                {copy.restore}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
