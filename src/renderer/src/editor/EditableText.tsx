import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { ClipboardEvent, KeyboardEvent, MouseEvent } from 'react'
import type { RichText } from '@shared/types'
import { getBlock } from '@/store/blocks'
import { useEditor } from './context'
import { MIME_RICHTEXT } from './clipboard'
import { onBlockKeyDown } from './keyboard'
import {
  domToRichText,
  getSelectionOffsets,
  parseRichText,
  renderInto,
  richTextEqual,
  setSelectionOffsets,
  slice,
  textOf,
  toHtml
} from './richtext-dom'
import { sanitizeHref } from './sanitize'
import { TEXT_DEBOUNCE_MS, type Sel } from './types'

export interface EditableTextProps {
  blockId: string
  field?: 'title' | 'caption'
  /** `block`: rich text with shortcuts; `title` / `caption`: single-line plain text. */
  mode: 'block' | 'title' | 'caption'
  value: RichText | undefined
  placeholder?: string
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>, el: HTMLDivElement) => void
}

/** Editables narrower than this have no usable line box to hit-test. */
const MIN_HIT_WIDTH = 3
/** How far inside the first/last line the caret hit-test aims, at most. */
const LINE_INSET = 10

/**
 * Input types that would change structure or formatting behind the model's back.
 * Line breaks, drops and history are handled by the editor itself; the rest can
 * only come from `execCommand`, which the editor never uses for them.
 */
const BLOCKED_INPUT_TYPES: ReadonlySet<string> = new Set([
  'insertParagraph',
  'insertLineBreak',
  'insertFromDrop',
  'deleteByDrag',
  'insertLink',
  'insertOrderedList',
  'insertUnorderedList',
  'insertHorizontalRule'
])

interface CaretDocument {
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

/**
 * One contenteditable bound to a rich-text prop of a block. The model is the
 * source of truth: the DOM is only rewritten when it serialises to something
 * different from the incoming value, so re-renders never move the caret.
 */
export const EditableText = memo(function EditableText({
  blockId,
  field = 'title',
  mode,
  value,
  placeholder,
  className,
  onKeyDown
}: EditableTextProps) {
  const { ctrl } = useEditor()
  const ref = useRef<HTMLDivElement>(null)
  const regKey = field === 'title' ? blockId : `${blockId}:${field}`
  const st = useRef({
    pending: null as RichText | null,
    timer: 0,
    composing: false,
    before: null as Sel,
    after: null as Sel
  })

  const readSel = useCallback((): Sel => {
    const el = ref.current
    const o = el ? getSelectionOffsets(el) : null
    return o ? { kind: 'text', blockId: regKey, start: o.start, end: o.end } : null
  }, [regKey])

  const flush = useCallback(() => {
    const s = st.current
    if (s.timer) {
      window.clearTimeout(s.timer)
      s.timer = 0
    }
    const rt = s.pending
    if (!rt) return
    s.pending = null
    const b = getBlock(blockId)
    if (!b || richTextEqual(b.props[field], rt)) return
    ctrl.commit([{ op: 'update', id: blockId, patch: { props: field === 'title' ? { title: rt } : { caption: rt } } }], {
      before: s.before,
      after: readSel() ?? s.after,
      key: `text:${regKey}`,
      silent: true
    })
  }, [blockId, field, regKey, ctrl, readSel])

  // Keep the DOM in sync with the model without disturbing an in-progress edit.
  useLayoutEffect(() => {
    const el = ref.current
    const s = st.current
    if (!el || s.composing || s.pending) return
    if (richTextEqual(domToRichText(el), parseRichText(value))) return
    const o = document.activeElement === el ? getSelectionOffsets(el) : null
    renderInto(el, value)
    if (o) setSelectionOffsets(el, o.start, o.end)
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const s = st.current
    const unregister = ctrl.register(regKey, {
      el,
      rich: mode === 'block',
      flush,
      sync() {
        if (s.timer) window.clearTimeout(s.timer)
        s.timer = 0
        s.pending = null
        const model = getBlock(blockId)?.props[field]
        if (!richTextEqual(domToRichText(el), parseRichText(model))) renderInto(el, model)
      },
      getSel: () => getSelectionOffsets(el),
      setSel(start, end) {
        el.focus({ preventScroll: true })
        setSelectionOffsets(el, start, end)
        el.scrollIntoView({ block: 'nearest' })
      },
      focusAt(x, edge) {
        el.focus({ preventScroll: true })
        const box = el.getBoundingClientRect()
        const fallback = (): void => setSelectionOffsets(el, edge === 'top' ? 0 : (el.textContent?.length ?? 0))
        const fromPoint = (document as CaretDocument).caretRangeFromPoint
        if (x === null || !fromPoint || box.width < MIN_HIT_WIDTH) fallback()
        else {
          const inset = Math.min(LINE_INSET, box.height / 2)
          const px = Math.max(box.left + 1, Math.min(x, box.right - 1))
          const range = fromPoint.call(document, px, edge === 'top' ? box.top + inset : box.bottom - inset)
          const sel = window.getSelection()
          if (range && sel && el.contains(range.startContainer)) {
            range.collapse(true)
            sel.removeAllRanges()
            sel.addRange(range)
          } else fallback()
        }
        el.scrollIntoView({ block: 'nearest' })
      }
    })
    // Native listener: React's onBeforeInput does not expose inputType reliably.
    const onBeforeInput = (e: InputEvent): void => {
      const t = e.inputType
      if (t.startsWith('history') || t.startsWith('format') || BLOCKED_INPUT_TYPES.has(t)) {
        e.preventDefault()
        return
      }
      if (!s.pending) s.before = readSel()
    }
    el.addEventListener('beforeinput', onBeforeInput)
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput)
      flush()
      unregister()
    }
  }, [ctrl, regKey, blockId, field, mode, flush, readSel])

  const handleInput = (data: string | null): void => {
    const el = ref.current
    if (!el) return
    const s = st.current
    let rt = domToRichText(el)
    // Chrome leaves a <br> behind in an emptied editable, which hides the placeholder.
    if (rt.length === 0 && el.firstChild) el.textContent = ''
    if (mode !== 'block') {
      const plain = textOf(rt).replace(/\n/g, ' ')
      rt = plain ? [[plain]] : []
    }
    s.after = readSel()
    // The edit is pending before the hooks run: a hook that rewrites the block first
    // flushes it, so the typed text gets its own undo step.
    s.pending = rt
    if (s.timer) window.clearTimeout(s.timer)
    s.timer = 0
    if (mode === 'block' && s.after?.kind === 'text' && ctrl.afterInput(blockId, rt, s.after.start, data)) {
      // The hook rewrote the block: the model is the truth now.
      s.pending = null
      return
    }
    s.timer = window.setTimeout(flush, TEXT_DEBOUNCE_MS)
  }

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
    if (mode === 'block') {
      flush()
      if (ctrl.handlePaste(e.clipboardData, blockId)) return
      document.execCommand('insertText', false, text.replace(/\n+$/, ''))
    } else if (text) {
      document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' ').trim())
    }
  }

  const handleCopy = (e: ClipboardEvent<HTMLDivElement>, cut: boolean): void => {
    const el = ref.current
    const o = el ? getSelectionOffsets(el) : null
    if (!el || !o || o.end <= o.start) return
    e.stopPropagation()
    e.preventDefault()
    const part = slice(domToRichText(el), o.start, o.end)
    e.clipboardData.setData('text/plain', textOf(part))
    if (mode === 'block') {
      e.clipboardData.setData('text/html', toHtml(part))
      e.clipboardData.setData(MIME_RICHTEXT, JSON.stringify(part))
    }
    if (cut) document.execCommand('delete')
  }

  const handleClick = (e: MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = sanitizeHref(a.getAttribute('href'))
    if (href && (e.ctrlKey || e.metaKey)) void window.api.app.openExternal(href)
  }

  return (
    <div
      ref={ref}
      className={className ? `rt ${className}` : 'rt'}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      data-editable={regKey}
      data-rich={mode === 'block' ? '1' : undefined}
      data-placeholder={placeholder}
      onInput={(e) => {
        const native = e.nativeEvent as InputEvent
        if (st.current.composing || native.isComposing) return
        handleInput(native.inputType === 'insertText' ? native.data : null)
      }}
      onCompositionStart={() => {
        st.current.composing = true
      }}
      onCompositionEnd={(e) => {
        st.current.composing = false
        handleInput(e.data || null)
      }}
      onKeyDown={(e) => {
        if (!ref.current) return
        if (mode === 'block') onBlockKeyDown(ctrl, blockId, e, ref.current)
        else onKeyDown?.(e, ref.current)
      }}
      onFocus={() => ctrl.clearBlockSelection()}
      onMouseDown={() => ctrl.clearPendingMarks()}
      onBlur={() => {
        ctrl.clearPendingMarks()
        if (!st.current.composing) flush()
        const slash = ctrl.ui.getState().slash
        if (slash && slash.blockId === blockId) ctrl.closeSlash()
      }}
      onPaste={handlePaste}
      onCopy={(e) => handleCopy(e, false)}
      onCut={(e) => handleCopy(e, true)}
      onClick={handleClick}
      onAuxClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault()
      }}
    />
  )
})
