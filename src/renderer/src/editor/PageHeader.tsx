import { useCallback, useEffect, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { Block } from '@shared/types'
import { Popover } from '@/ui/Popover'
import { LazyEmojiPicker, preloadEmojiPicker } from '@/ui/LazyEmojiPicker'
import { Image as ImageIcon, Trash } from '@/ui/icons'
import { useEditor } from './context'
import { getBlock } from '@/store/blocks'
import { COVER_PRESETS } from './blockTypes'
import { EditableText } from './EditableText'
import { getSelectionOffsets } from './richtext-dom'
import { coverStyle } from './sanitize'
import { caretLine } from './keyboard'

const DEFAULT_ICON = '\u{1F4C4}'

export function PageHeader({ page }: { page: Block }): JSX.Element {
  const { ctrl } = useEditor()
  const id = page.id
  const [iconOpen, setIconOpen] = useState(false)
  const [coverOpen, setCoverOpen] = useState(false)
  const [iconEl, setIconEl] = useState<HTMLButtonElement | null>(null)
  const [coverEl, setCoverEl] = useState<HTMLButtonElement | null>(null)
  const icon = page.props.icon
  const style = coverStyle(page.props.cover)

  // A brand-new page starts with the caret in its title. Runs once per page: the
  // block is read from the store so later edits to it do not re-trigger the effect.
  useEffect(() => {
    const p = getBlock(id)
    if (p && !p.props.title?.length && p.content.length === 0) ctrl.focusOrSelect(id, 'start')
  }, [ctrl, id])

  const setCover = (cover: string | null): void => ctrl.update(id, { cover }, { silent: true })

  const onTitleKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, el: HTMLDivElement) => {
      if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
      const o = getSelectionOffsets(el)
      const atEnd = !!o && o.start === o.end && o.start === (el.textContent?.length ?? 0)
      const down = e.key === 'ArrowDown' && !e.shiftKey && caretLine(el).last
      if (e.key === 'Enter' || down || (e.key === 'ArrowRight' && !e.shiftKey && atEnd)) {
        e.preventDefault()
        ctrl.flush(id)
        const first = ctrl.nextVisible(id)
        if (first) ctrl.focusOrSelect(first, 'start')
        else ctrl.insertAfter(null, 'text')
      } else if (e.key === 'Tab') e.preventDefault()
    },
    [ctrl, id]
  )

  return (
    <>
      {style && (
        <div className="pe-cover" style={style}>
          <div className="pe-cover-actions">
            <button ref={setCoverEl} type="button" onClick={() => setCoverOpen((v) => !v)}>
              Change cover
            </button>
            <button type="button" onClick={() => setCover(null)}>
              Remove
            </button>
          </div>
        </div>
      )}
      <div className={`pe-content pe-head${style ? ' has-cover' : ''}${icon ? ' has-icon' : ''}`}>
        {icon && (
          <button ref={setIconEl} type="button" className="pe-icon" title="Change icon" onPointerEnter={preloadEmojiPicker} onFocus={preloadEmojiPicker} onClick={() => setIconOpen((v) => !v)}>
            {icon}
          </button>
        )}
        <div className="pe-head-actions">
          {!icon && (
            <button
              type="button"
              onPointerEnter={preloadEmojiPicker}
              onFocus={preloadEmojiPicker}
              onClick={() => {
                ctrl.update(id, { icon: DEFAULT_ICON }, { silent: true })
                setIconOpen(true)
              }}
            >
              Add icon
            </button>
          )}
          {!style && (
            <button
              type="button"
              onClick={() => setCover(COVER_PRESETS[Math.floor(Math.random() * COVER_PRESETS.length)])}
            >
              <ImageIcon size={14} /> Add cover
            </button>
          )}
        </div>
        <EditableText
          blockId={id}
          mode="title"
          value={page.props.title}
          placeholder="Untitled"
          className="pe-title"
          onKeyDown={onTitleKey}
        />
      </div>
      <Popover open={iconOpen && !!icon} anchor={iconEl} onClose={() => setIconOpen(false)}>
        <LazyEmojiPicker
          onPick={(emoji) => {
            setIconOpen(false)
            ctrl.update(id, { icon: emoji }, { silent: true })
          }}
        />
      </Popover>
      <Popover open={coverOpen && !!style} anchor={coverEl} onClose={() => setCoverOpen(false)} placement="bottom-end">
        <div className="pe-cover-menu">
          <div className="pe-cover-grid">
            {COVER_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={preset === page.props.cover ? 'pe-cover-swatch is-active' : 'pe-cover-swatch'}
                style={{ background: preset }}
                aria-label="Cover preset"
                onClick={() => setCover(preset)}
              />
            ))}
          </div>
          <button
            type="button"
            className="pe-cover-menu-item"
            onClick={() => {
              setCoverOpen(false)
              void window.api.files
                .pickImage()
                .then((url) => {
                  if (url) setCover(url)
                })
                .catch((err) => console.error('[editor] pickImage failed', err))
            }}
          >
            <ImageIcon size={14} /> Upload image
          </button>
          <button
            type="button"
            className="pe-cover-menu-item"
            onClick={() => {
              setCoverOpen(false)
              setCover(null)
            }}
          >
            <Trash size={14} /> Remove cover
          </button>
        </div>
      </Popover>
    </>
  )
}
