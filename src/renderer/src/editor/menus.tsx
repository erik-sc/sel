// Slash menu, source picker and block (handle) menu.
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type { JSX, SyntheticEvent } from 'react'
import { useStore } from 'zustand'
import { getBlock } from '@/store/blocks'
import { SourcePicker, preloadSourcePicker } from '@/database/lazy'
import { Popover } from '@/ui/Popover'
import { Menu, type MenuItem } from '@/ui/Menu'
import type { Block } from '@shared/types'
import { pageLink } from '@shared/pageLink'
import { Columns, Copy, Link as LinkIcon, Trash } from '@/ui/icons'
import { useEditor } from './context'
import { besideChoice } from './layout'
import { TURN_INTO, filterSlashItems, isPlainTextType, isTextType, slashListId, slashOptionId } from './blockTypes'
import { useA11yCopy } from '@/a11y/announce'
import { COLOR_NAMES } from './richtext-dom'
import { MAX_ALT_LENGTH } from './blocks'
import { AI_LANGUAGES, AI_LANGUAGE_LABELS, AI_TONES, AI_TONE_LABELS } from '@shared/ai'
import type { AiAction } from '@shared/ai'
import { useAiGate } from '@/ai/gate'
import { AI_GLYPH, aiOnBlocks, type AiOptions } from '@/ai/session'
import type { EditorController } from './controller'
import { preloadInlineAi } from '@/ai/slot'

export function SlashMenu(): JSX.Element | null {
  const { ctrl } = useEditor()
  const slash = useStore(ctrl.ui, (s) => s.slash)
  const listRef = useRef<HTMLDivElement>(null)
  const index = slash?.index ?? 0
  const a11y = useA11yCopy()

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [index, slash?.query])

  const ai = useAiGate((state) => state.enabled)
  const items = slash ? filterSlashItems(slash.query, ai) : []
  const offersAi = items.some((item) => item.kind === 'ai')
  useEffect(() => {
    if (offersAi) preloadInlineAi()
  }, [offersAi])
  // The picker behind "Linked database view" is fetched as soon as the menu offers it.
  const offersLinked = items.some((item) => item.linked)
  useEffect(() => {
    if (offersLinked) preloadSourcePicker()
  }, [offersLinked])

  if (!slash) return null
  return (
    <Popover open anchor={slash.rect} role="none" onClose={() => ctrl.closeSlash()} className="pe-slash">
      <div
        className="pe-slash-list"
        ref={listRef}
        id={slashListId(slash.blockId)}
        role={items.length ? 'listbox' : undefined}
        aria-label={a11y.blocksMenu}
        onMouseDown={(e) => e.preventDefault()}
      >
        {items.length === 0 && (
          <>
            <div className="pe-slash-header">Blocks</div>
            <div className="pe-slash-empty">No results</div>
          </>
        )}
        {items.map((item, i) => {
          const group = item.kind === 'ai' ? 'AI' : 'Blocks'
          const previous = items[i - 1]
          const first = !previous || (previous.kind === 'ai') !== (item.kind === 'ai')
          return (
            <Fragment key={item.id}>
              {first && (
                <div className="pe-slash-header" role="presentation">
                  {group}
                </div>
              )}
              <div
                id={slashOptionId(slash.blockId, i)}
                role="option"
                aria-selected={i === index}
                className={`pe-slash-item${i === index ? ' is-active' : ''}${item.kind === 'ai' ? ' is-ai' : ''}`}
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
            </Fragment>
          )
        })}
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
    <Popover open anchor={picker.rect} label="Linked database view" onClose={close} className="pe-source-picker">
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

/** "Ask AI" in the block menu: the actions that make sense for whole blocks. */
function aiMenu(ctrl: EditorController, ids: string[]): MenuItem {
  const run = (action: AiAction | null, options?: AiOptions) => (): void => aiOnBlocks(ctrl, action, ids, options)
  return {
    id: 'ai',
    label: 'Ask AI',
    icon: <span className="pe-menu-glyph is-ai">{AI_GLYPH}</span>,
    submenu: [
      { id: 'ai-improve', label: 'Improve writing', onSelect: run('improve') },
      { id: 'ai-fix', label: 'Fix spelling and grammar', onSelect: run('fix') },
      { id: 'ai-shorten', label: 'Shorter', onSelect: run('shorten') },
      { id: 'ai-lengthen', label: 'Longer', onSelect: run('lengthen') },
      { id: 'ai-expand', label: 'Expand with detail', onSelect: run('expand') },
      { id: 'ai-simplify', label: 'Simplify', onSelect: run('simplify') },
      {
        id: 'ai-tone',
        label: 'Change tone',
        submenu: AI_TONES.map((tone) => ({ id: `ai-tone-${tone}`, label: AI_TONE_LABELS[tone], onSelect: run('tone', { tone }) }))
      },
      {
        id: 'ai-translate',
        label: 'Translate',
        submenu: AI_LANGUAGES.map((language) => ({
          id: `ai-lang-${language}`,
          label: AI_LANGUAGE_LABELS[language],
          onSelect: run('translate', { language })
        }))
      },
      { separator: true },
      { id: 'ai-summarize', label: 'Summarize', onSelect: run('summarize') },
      { id: 'ai-actions', label: 'Action items', onSelect: run('actions') },
      { id: 'ai-explain', label: 'Explain', onSelect: run('explain') },
      { id: 'ai-custom', label: 'Custom…', onSelect: run(null) }
    ]
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The block menu's field for an image's alternative text, in place of the menu. */
function AltTextField({ block, onDone }: { block: Block; onDone: () => void }): JSX.Element {
  const { ctrl } = useEditor()
  const id = useId()
  const [value, setValue] = useState(typeof block.props.alt === 'string' ? block.props.alt : '')
  const done = useRef(false)
  const commit = (): void => {
    if (done.current) return
    done.current = true
    if (value.trim() !== (block.props.alt ?? '').trim()) ctrl.update(block.id, { alt: value.trim() })
  }
  return (
    <div className="pe-alt" onMouseDown={stop}>
      <label className="pe-alt-label" htmlFor={id}>
        Alternative text
      </label>
      <textarea
        id={id}
        className="ui-input pe-alt-input"
        rows={3}
        value={value}
        maxLength={MAX_ALT_LENGTH}
        autoFocus
        aria-describedby={`${id}-help`}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            commit()
            onDone()
          }
        }}
      />
      <p className="pe-alt-help" id={`${id}-help`}>
        Read aloud in place of the image. The caption stays as it is.
      </p>
    </div>
  )
}

export function BlockMenu(): JSX.Element | null {
  const { ctrl } = useEditor()
  const menu = useStore(ctrl.ui, (s) => s.menu)
  const ai = useAiGate((state) => state.enabled)
  // The image whose alternative text is being written, in place of the menu.
  const [altFor, setAltFor] = useState<string | null>(null)
  const altRef = useRef<string | null>(null)
  altRef.current = altFor
  // A menu opened again starts as the menu.
  useEffect(() => setAltFor(null), [menu])
  if (!menu) return null
  const close = (): void => {
    setAltFor(null)
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
    return !!b && (isTextType(b.type) || isPlainTextType(b.type))
  })
  // A single database block can join the row of the one before it, or leave its row.
  const only = ids.length === 1 ? getBlock(ids[0]) : undefined
  const siblings = only?.parentId
    ? (getBlock(only.parentId)?.content ?? []).map(getBlock).filter((b): b is Block => !!b && !b.trashedAt)
    : []
  const beside = only ? besideChoice(siblings, only.id) : null

  const items: MenuItem[] = [
    { id: 'delete', label: 'Delete', icon: <Trash size={14} />, hint: 'Del', danger: true, onSelect: () => ctrl.deleteBlocks(ids) },
    { id: 'duplicate', label: 'Duplicate', icon: <Copy size={14} />, hint: 'Ctrl+D', onSelect: () => ctrl.duplicate(ids) },
    ...(only && beside
      ? [
          {
            id: 'beside',
            label: beside === 'beside' ? 'Place beside the previous block' : 'Place below the previous block',
            icon: <Columns size={14} />,
            onSelect: () => ctrl.setBeside(only.id, beside === 'beside')
          }
        ]
      : []),
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
    ...(ai && convertible ? [aiMenu(ctrl, ids)] : []),
    ...(only?.type === 'image' && only.props.url
      ? [
          {
            id: 'alt',
            label: 'Alternative text…',
            onSelect: () => {
              altRef.current = only.id
              setAltFor(only.id)
            }
          }
        ]
      : []),
    { separator: true },
    {
      id: 'link',
      label: 'Copy link to block',
      icon: <LinkIcon size={14} />,
      // Pasted over text, or into the link field, it links to this block's page.
      onSelect: () => void navigator.clipboard.writeText(pageLink(ctrl.pageId, menu.id))
    }
  ]
  return (
    <Popover open anchor={menu.rect} role={altFor ? 'dialog' : 'none'} label="Alternative text" onClose={close}>
      {altFor && only ? (
        <AltTextField block={only} onDone={close} />
      ) : (
        <Menu
          items={items}
          // "Alternative text…" keeps the popover open: its field takes the menu's place.
          onClose={() => {
            if (!altRef.current) close()
          }}
          autoFocus
        />
      )}
    </Popover>
  )
}
