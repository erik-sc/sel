// Non rich-text block bodies: code, image, bookmark, sub-page link, callout icon.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { Block } from '@shared/types'
import { getBlock } from '@/store/blocks'
import { Popover } from '@/ui/Popover'
import { LazyEmojiPicker, preloadEmojiPicker } from '@/ui/LazyEmojiPicker'
import { ArrowUpRight, Check, Copy, Image as ImageIcon, Link as LinkIcon, Page as PageIcon } from '@/ui/icons'
import { useEditor } from './context'
import { CODE_LANGUAGES, DEFAULT_CALLOUT_ICON } from './blockTypes'
import { EditableText } from './EditableText'
import { textOf } from './richtext-dom'
import { isSafeImageUrl, sanitizeHref } from './sanitize'
import { TEXT_DEBOUNCE_MS, type Sel } from './types'
import { IconGlyph } from '@/ui/IconGlyph'

/** How long the "Copied" confirmation stays on the copy button. */
const COPIED_FEEDBACK_MS = 1200
/** A caret requested right before the value changed (undo/redo) is re-applied within this window. */
const WANTED_CARET_MS = 300
const PLAIN_TEXT = 'plain text'
const INDENT = '  '

export function CodeBlock({ block }: { block: Block }): JSX.Element {
  const { ctrl } = useEditor()
  const id = block.id
  const model = textOf(block.props.title)
  const [draft, setDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const st = useRef({
    draft: null as string | null,
    timer: 0,
    copiedTimer: 0,
    before: null as Sel,
    last: null as Sel,
    want: null as { start: number; end: number; at: number } | null
  })
  const value = draft ?? model

  const flush = useCallback(() => {
    const s = st.current
    if (s.timer) window.clearTimeout(s.timer)
    s.timer = 0
    const text = s.draft
    if (text === null) return
    s.draft = null
    setDraft(null)
    const b = getBlock(id)
    if (!b || textOf(b.props.title) === text) return
    ctrl.commit([{ op: 'update', id, patch: { props: { title: text ? [[text]] : [] } } }], {
      before: s.before,
      after: s.last ?? s.before,
      key: `text:${id}`,
      silent: true
    })
  }, [id, ctrl])

  const onDraft = (text: string): void => {
    const s = st.current
    s.want = null
    if (s.draft === null) s.before = s.last
    s.draft = text
    setDraft(text)
    const ta = ref.current
    if (ta) s.last = { kind: 'text', blockId: id, start: ta.selectionStart, end: ta.selectionEnd }
    if (s.timer) window.clearTimeout(s.timer)
    s.timer = window.setTimeout(flush, TEXT_DEBOUNCE_MS)
  }

  useLayoutEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.style.height = '0px'
    ta.style.height = `${ta.scrollHeight}px`
    // A selection requested just before the value changed (undo/redo) must survive it.
    const want = st.current.want
    if (want && document.activeElement === ta && performance.now() - want.at < WANTED_CARET_MS) {
      ta.setSelectionRange(Math.min(want.start, ta.value.length), Math.min(want.end, ta.value.length))
    }
  }, [value])

  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    const s = st.current
    const unregister = ctrl.register(id, {
      el: ta,
      rich: false,
      flush,
      sync() {
        if (s.timer) window.clearTimeout(s.timer)
        s.timer = 0
        s.draft = null
        setDraft(null)
      },
      getSel: () => ({ start: ta.selectionStart, end: ta.selectionEnd }),
      setSel(start, end) {
        ta.focus({ preventScroll: true })
        const len = ta.value.length
        s.want = { start, end, at: performance.now() }
        ta.setSelectionRange(Math.min(start, len), Math.min(end, len))
        ta.scrollIntoView({ block: 'nearest' })
      },
      focusAt(_x, edge) {
        ta.focus({ preventScroll: true })
        const p = edge === 'top' ? 0 : ta.value.length
        ta.setSelectionRange(p, p)
        ta.scrollIntoView({ block: 'nearest' })
      }
    })
    return () => {
      flush()
      unregister()
      window.clearTimeout(s.copiedTimer)
    }
  }, [ctrl, id, flush])

  const copy = (): void => {
    const s = st.current
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true)
        window.clearTimeout(s.copiedTimer)
        s.copiedTimer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
      })
      .catch((err: unknown) => console.error('[editor] copy failed', err))
  }

  const insert = (ta: HTMLTextAreaElement, text: string): void => {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end')
    onDraft(ta.value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget
    if (e.nativeEvent.isComposing) return
    const mod = e.ctrlKey || e.metaKey
    const { selectionStart: a, selectionEnd: b } = ta
    if (e.key === 'Tab') {
      e.preventDefault()
      if (!e.shiftKey) insert(ta, INDENT)
      else {
        const lineStart = ta.value.lastIndexOf('\n', a - 1) + 1
        if (ta.value.startsWith(INDENT, lineStart)) {
          ta.setRangeText('', lineStart, lineStart + INDENT.length, 'preserve')
          onDraft(ta.value)
        }
      }
    } else if (e.key === 'Enter' && (mod || e.shiftKey)) {
      e.preventDefault()
      flush()
      ctrl.insertAfter(id, 'text')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const lineStart = ta.value.lastIndexOf('\n', a - 1) + 1
      const indent = /^[ \t]*/.exec(ta.value.slice(lineStart, a))?.[0] ?? ''
      insert(ta, `\n${indent}`)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      ctrl.selectBlocks([id])
    } else if (e.key === 'Backspace' && ta.value === '') {
      e.preventDefault()
      ctrl.turnInto([id], 'text')
    } else if (e.key === 'ArrowUp' && a === b && !e.shiftKey && !ta.value.slice(0, a).includes('\n')) {
      if (ctrl.moveVertical(id, -1, null)) e.preventDefault()
    } else if (e.key === 'ArrowDown' && a === b && !e.shiftKey && !ta.value.slice(b).includes('\n')) {
      if (ctrl.moveVertical(id, 1, null)) e.preventDefault()
    } else if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      ctrl.moveBlocks([id], e.key === 'ArrowUp' ? -1 : 1)
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      ctrl.duplicate([id])
    }
  }

  const language = block.props.language ?? PLAIN_TEXT
  const languages = CODE_LANGUAGES.includes(language) ? CODE_LANGUAGES : [language, ...CODE_LANGUAGES]

  return (
    <div className="blk-code-box">
      <div className="blk-code-bar">
        <select
          className="blk-code-lang"
          value={language}
          aria-label="Language"
          onChange={(e) => ctrl.update(id, { language: e.target.value === PLAIN_TEXT ? null : e.target.value }, { silent: true })}
        >
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" className="blk-code-copy" title="Copy code" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <textarea
        ref={ref}
        className="blk-code-area"
        value={value}
        rows={1}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        data-editable={id}
        onChange={(e) => onDraft(e.target.value)}
        onSelect={(e) => {
          const ta = e.currentTarget
          st.current.last = { kind: 'text', blockId: id, start: ta.selectionStart, end: ta.selectionEnd }
        }}
        onKeyDown={onKeyDown}
        onFocus={() => ctrl.clearBlockSelection()}
        onBlur={flush}
      />
    </div>
  )
}

export function ImageBlock({ block }: { block: Block }): JSX.Element {
  const { ctrl } = useEditor()
  const id = block.id
  const url = block.props.url
  if (!isSafeImageUrl(url)) {
    return (
      <button type="button" className="blk-placeholder" onClick={() => void ctrl.pickImage(id)}>
        <ImageIcon size={16} />
        <span>Add an image</span>
      </button>
    )
  }
  return (
    <figure className="blk-figure">
      <img src={url} alt={textOf(block.props.caption)} draggable={false} onDoubleClick={() => void ctrl.pickImage(id)} />
      <EditableText
        blockId={id}
        field="caption"
        mode="caption"
        value={block.props.caption}
        placeholder="Add a caption"
        className="blk-caption"
        onKeyDown={captionKeyDown(ctrl, id)}
      />
    </figure>
  )
}

const captionHandlers = new WeakMap<object, Map<string, (e: KeyboardEvent<HTMLDivElement>) => void>>()

/** Stable per-block handler so the memoised EditableText does not re-render. */
function captionKeyDown(ctrl: ReturnType<typeof useEditor>['ctrl'], id: string): (e: KeyboardEvent<HTMLDivElement>) => void {
  let map = captionHandlers.get(ctrl)
  if (!map) captionHandlers.set(ctrl, (map = new Map()))
  let fn = map.get(id)
  if (!fn) {
    fn = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        ctrl.flush(`${id}:caption`)
        ctrl.insertAfter(id, 'text')
      } else if (e.key === 'Escape') {
        e.preventDefault()
        ctrl.selectBlocks([id])
      }
    }
    map.set(id, fn)
  }
  return fn
}

function isMailto(href: string): boolean {
  return href.toLowerCase().startsWith('mailto:')
}

export function BookmarkBlock({ block }: { block: Block }): JSX.Element {
  const { ctrl } = useEditor()
  const id = block.id
  const href = sanitizeHref(block.props.url)
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  if (!href || isMailto(href)) {
    return (
      <div className={`blk-placeholder blk-bookmark-input${invalid ? ' is-invalid' : ''}`}>
        <LinkIcon size={16} />
        <input
          value={draft}
          placeholder="Paste a link and press Enter"
          aria-label="Bookmark link"
          onChange={(e) => {
            setDraft(e.target.value)
            setInvalid(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const next = sanitizeHref(draft)
              if (next && !isMailto(next)) ctrl.update(id, { url: next }, { silent: true })
              else setInvalid(true)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              ctrl.selectBlocks([id])
            }
          }}
        />
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
    <div
      className="blk-bookmark"
      role="link"
      tabIndex={-1}
      title={href}
      onClick={(e) => {
        if (!e.shiftKey) void window.api.app.openExternal(href)
      }}
    >
      <div className="blk-bookmark-text">
        <div className="blk-bookmark-host">{host}</div>
        <div className="blk-bookmark-url">{href}</div>
      </div>
      <ArrowUpRight size={16} />
    </div>
  )
}

export function PageLinkBlock({ block }: { block: Block }): JSX.Element {
  const { onOpenPage } = useEditor()
  const title = textOf(block.props.title)
  return (
    <div
      className="blk-pagelink"
      role="link"
      tabIndex={-1}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onClick={(e) => {
        if (!e.shiftKey) onOpenPage(block.id, e.ctrlKey || e.metaKey ? { newTab: true } : undefined)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) onOpenPage(block.id, { newTab: true })
      }}
    >
      <span className="blk-pagelink-icon">{block.props.icon ? <IconGlyph icon={block.props.icon} /> : <PageIcon size={16} />}</span>
      <span className={title ? 'blk-pagelink-title' : 'blk-pagelink-title is-empty'}>{title || 'Untitled'}</span>
    </div>
  )
}

export function CalloutIcon({ block }: { block: Block }): JSX.Element {
  const { ctrl } = useEditor()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="blk-callout-icon"
        contentEditable={false}
        title="Change icon"
        onPointerEnter={preloadEmojiPicker}
        onFocus={preloadEmojiPicker}
        onClick={() => setOpen((v) => !v)}
      >
        {block.props.icon ?? DEFAULT_CALLOUT_ICON}
      </button>
      <Popover open={open} anchor={ref.current} onClose={() => setOpen(false)}>
        <LazyEmojiPicker
          onPick={(emoji) => {
            setOpen(false)
            ctrl.update(block.id, { icon: emoji ?? DEFAULT_CALLOUT_ICON }, { silent: true })
          }}
        />
      </Popover>
    </>
  )
}
