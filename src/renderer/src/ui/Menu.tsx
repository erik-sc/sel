import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { ChevronRight } from './icons'
import { Popover } from './Popover'

export type MenuItem =
  | {
      id: string
      label: string
      icon?: ReactNode
      hint?: string
      danger?: boolean
      disabled?: boolean
      onSelect?: () => void
      submenu?: MenuItem[]
    }
  | { separator: true }
  | { header: string }

export interface MenuProps {
  items: MenuItem[]
  onClose?: () => void
  autoFocus?: boolean
  /**
   * ArrowUp on the first item calls this instead of wrapping to the last: for a field drawn
   * above the list, which takes the focus back.
   */
  onExitStart?: () => void
  /**
   * The menu is a Tab stop of its own: for a menu drawn under fields in the same popover, so Tab
   * reaches it from them instead of leaving the popover.
   */
  tabbable?: boolean
}

type ActionItem = Extract<MenuItem, { id: string }>

function isAction(item: MenuItem | undefined): item is ActionItem {
  return !!item && 'id' in item
}

export function Menu(props: MenuProps) {
  return <MenuList {...props} />
}

function MenuList({ items, onClose, autoFocus, onExitStart, tabbable, onBack }: MenuProps & { onBack?: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [active, setActive] = useState(-1)
  const [sub, setSub] = useState<{ index: number; focus: boolean } | null>(null)
  const baseId = useId()
  const itemId = (index: number): string => `${baseId}-${index}`

  const selectable = (index: number): boolean => {
    const item = items[index]
    return isAction(item) && !item.disabled
  }

  const move = (from: number, delta: number): number => {
    for (let step = 1; step <= items.length; step++) {
      const index = (((from + delta * step) % items.length) + items.length) % items.length
      if (selectable(index)) return index
    }
    return -1
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount: `autoFocus` describes how the menu was opened, and `move` (new on every render) only reads the items the menu was opened with.
  useEffect(() => {
    if (!autoFocus) return
    rootRef.current?.focus({ preventScroll: true })
    setActive(move(-1, 1))
  }, [])

  useEffect(() => {
    if (active >= 0) itemRefs.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (index: number, viaKeyboard: boolean): void => {
    const item = items[index]
    if (!isAction(item) || item.disabled) return
    if (item.submenu) {
      setSub({ index, focus: viaKeyboard })
      return
    }
    item.onSelect?.()
    onClose?.()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== rootRef.current || event.nativeEvent.isComposing) return
    switch (event.key) {
      case 'ArrowDown':
        setActive(move(active, 1))
        break
      case 'ArrowUp':
        if (onExitStart && (active < 0 || active === move(-1, 1))) {
          setActive(-1)
          onExitStart()
        } else setActive(move(active < 0 ? 0 : active, -1))
        break
      case 'Home':
        setActive(move(-1, 1))
        break
      case 'End':
        setActive(move(0, -1))
        break
      case 'Enter':
      case ' ':
        if (active >= 0) choose(active, true)
        break
      case 'ArrowRight': {
        const item = items[active]
        if (isAction(item) && item.submenu && !item.disabled) setSub({ index: active, focus: true })
        else return
        break
      }
      case 'ArrowLeft':
        if (!onBack) return
        onBack()
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const subItem = sub ? items[sub.index] : undefined
  const closeSub = (): void => {
    setSub(null)
    rootRef.current?.focus({ preventScroll: true })
  }

  return (
    <div
      className="ui-menu"
      role="menu"
      tabIndex={tabbable ? 0 : -1}
      ref={rootRef}
      aria-activedescendant={active >= 0 ? itemId(active) : undefined}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => {
        if ('separator' in item) return <div key={`s${index}`} className="ui-menu-separator" role="separator" />
        if ('header' in item) {
          return (
            <div key={`h${index}`} className="ui-menu-header">
              {item.header}
            </div>
          )
        }
        const classes = ['ui-menu-item']
        if (index === active || sub?.index === index) classes.push('is-active')
        if (item.danger) classes.push('is-danger')
        if (item.disabled) classes.push('is-disabled')
        return (
          <div
            key={item.id}
            id={itemId(index)}
            ref={(el) => {
              itemRefs.current[index] = el
            }}
            className={classes.join(' ')}
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.submenu ? 'menu' : undefined}
            aria-expanded={item.submenu ? sub?.index === index : undefined}
            onMouseEnter={() => {
              if (item.disabled) return
              setActive(index)
              setSub(item.submenu ? { index, focus: false } : null)
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(index, false)}
          >
            {item.icon !== undefined && <span className="ui-menu-icon">{item.icon}</span>}
            <span className="ui-menu-label">{item.label}</span>
            {item.hint && <span className="ui-menu-hint">{item.hint}</span>}
            {item.submenu && (
              <span className="ui-menu-chevron">
                <ChevronRight size={12} />
              </span>
            )}
          </div>
        )
      })}
      {sub && isAction(subItem) && subItem.submenu && (
        <Popover open anchor={itemRefs.current[sub.index] ?? null} placement="right-start" role="none" onClose={closeSub}>
          <MenuList
            key={subItem.id}
            items={subItem.submenu}
            autoFocus={sub.focus}
            onBack={closeSub}
            onClose={() => {
              setSub(null)
              onClose?.()
            }}
          />
        </Popover>
      )}
    </div>
  )
}
