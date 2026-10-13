// Slash menu, source picker and block (handle) menu.
import { useEffect, useRef } from 'react'
import type { JSX, SyntheticEvent } from 'react'
import { useStore } from 'zustand'
import { getBlock } from '@/store/blocks'
import { SourcePicker, preloadSourcePicker } from '@/database/lazy'
import { Popover } from '@/ui/Popover'
import { Menu, type MenuItem } from '@/ui/Menu'
import { Copy, Link as LinkIcon, Trash } from '@/ui/icons'
import { useEditor } from './context'
import { TURN_INTO, filterSlashItems, isTextType } from './blockTypes'
import { COLOR_NAMES } from './richtext-dom'

export function SlashMenu(): JSX.Element | null {
  const { ctrl } = useEditor()
  const slash = useStore(ctrl.ui, (s) => s.slash)
  const listRef = useRef<HTMLDivElement>(null)
  const index = slash?.index ?? 0

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [index, slash?.query])

  const items = slash ? filterSlashItems(slash.query) : []
  // The picker behind "Linked database view" is fetched as soon as the menu offers it.
  const offersLinked = items.some((item) => item.linked)
  useEffect(() => {
    if (offersLinked) preloadSourcePicker()
  }, [offersLinked])

  if (!slash) return null
  return (
    <Popover open anchor={slash.rect} onClose={() => ctrl.closeSlash()} className="pe-slash">
      <div className="pe-slash-list" ref={listRef} role="listbox" onMouseDown={(e) => e.preventDefault()}>
        <div className="pe-slash-header">Blocks</div>
        {items.length === 0 && <div className="pe-slash-empty">No results</div>}
        {items.map((item, i) => (
          <div
            key={item.id}
            role="option"
            aria-selected={i === index}
            className={i === index ? 'pe-slash-item is-active' : 'pe-slash-item'}
            onMouseMove={() => {
              const s = ctrl.ui.getState().slash
              if (s && s.index !== i) ctrl.ui.setState({ slash: { ...s, index: i } })
            }}
            onClick={() => ctrl.runSlash(item)}
          >
            <span className="pe-slash-glyph">{item.glyph}</span>
            <span className="pe-slash-text">
              <span className="pe-slash-label">{item.label}</span>
              <span className="pe-slash-hint">{item.hint}</span>
            </span>
          </div>
        ))}
      </div>
    </Popover>
  )
}

const stop = (event: SyntheticEvent): void => event.stopPropagation()

/**
 * The picker of source databases, opened where the slash menu was. It lives in a portal,
 * but React events bubble through the component tree: none of them is for the editor.
 */
export function SourcePickerPopover(): JSX.Element | null {
  const { ctrl } = useEditor()
  const picker = useStore(ctrl.ui, (s) => s.sourcePicker)
  if (!picker) return null
  const close = (): void => {
    ctrl.closeSourcePicker()
    // Back to the block the menu was opened from, with its slash text untouched and the caret
    // after it (the popover hands the focus back to the block, but not the caret position).
    window.setTimeout(() => {
      const active = document.activeElement
      const elsewhere = !!active && active !== document.body && ctrl.focusedKey() !== picker.blockId && active !== ctrl.root
      if (!elsewhere) ctrl.focusBlock(picker.blockId, picker.cut)
    }, 0)
  }
  return (
    <Popover open anchor={picker.rect} onClose={close} className="pe-source-picker">
      <div
        className="pe-source-picker-body"
        onClick={stop}
        onMouseDown={stop}
        onMouseUp={stop}
        onPointerDown={stop}
        onKeyDown={stop}
        onKeyUp={stop}
        onBeforeInput={stop}
        onInput={stop}
        onCopy={stop}
        onCut={stop}
        onPaste={stop}
        onFocus={stop}
        onBlur={stop}
      >
        <SourcePicker
          view={picker.view}
          onPick={(props) => ctrl.insertFromSourcePicker(props)}
          onCreateNew={() => ctrl.insertFromSourcePicker({})}
        />
      </div>
    </Popover>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function BlockMenu(): JSX.Element | null {
  const { ctrl } = useEditor()
  const menu = useStore(ctrl.ui, (s) => s.menu)
  if (!menu) return null
  const close = (): void => {
    ctrl.ui.setState({ menu: null })
    // Give the keyboard back to the block selection unless an action moved focus.
    window.setTimeout(() => {
      const active = document.activeElement
      if (ctrl.ui.getState().selected.length && (!active || active === document.body)) ctrl.root?.focus({ preventScroll: true })
    }, 0)
  }
  const ids = ctrl.targetIds(menu.id)
  const convertible = ids.some((id) => {
    const b = getBlock(id)
    return !!b && (isTextType(b.type) || b.type === 'code')
  })

  const items: MenuItem[] = [
    { id: 'delete', label: 'Delete', icon: <Trash size={14} />, hint: 'Del', danger: true, onSelect: () => ctrl.deleteBlocks(ids) },
    { id: 'duplicate', label: 'Duplicate', icon: <Copy size={14} />, hint: 'Ctrl+D', onSelect: () => ctrl.duplicate(ids) },
    {
      id: 'turn',
      label: 'Turn into',
      disabled: !convertible,
      submenu: TURN_INTO.map((t) => ({
        id: t.id,
        label: t.label,
        icon: <span className="pe-menu-glyph">{t.glyph}</span>,
        onSelect: () => ctrl.turnInto(ids, t.type)
      }))
    },
    {
      id: 'color',
      label: 'Colour',
      submenu: [
        { header: 'Text' },
        { id: 'fg-default', label: 'Default', icon: <span className="pe-swatch">A</span>, onSelect: () => ctrl.setColor(ids, null) },
        ...COLOR_NAMES.map((name) => ({
          id: `fg-${name}`,
          label: capitalize(name),
          icon: <span className={`pe-swatch rt-fg-${name}`}>A</span>,
          onSelect: () => ctrl.setColor(ids, name)
        })),
        { header: 'Background' },
        ...COLOR_NAMES.map((name) => ({
          id: `bg-${name}`,
          label: `${capitalize(name)} background`,
          icon: <span className={`pe-swatch rt-bg-${name}`}>A</span>,
          onSelect: () => ctrl.setColor(ids, `${name}_background`)
        }))
      ]
    },
    { separator: true },
    {
      id: 'link',
      label: 'Copy link to block',
      icon: <LinkIcon size={14} />,
      onSelect: () => void navigator.clipboard.writeText(`selida://${ctrl.pageId}#${menu.id}`)
    }
  ]
  return (
    <Popover open anchor={menu.rect} onClose={close}>
      <Menu items={items} onClose={close} autoFocus />
    </Popover>
  )
}
