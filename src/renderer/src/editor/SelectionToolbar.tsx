import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import type { Mark } from '@shared/types'
import { getBlock } from '@/store/blocks'
import { Code as CodeIcon, Link as LinkIcon, ChevronDown, ChevronRight } from '@/ui/icons'
import { useEditor } from './context'
import { LinkPanel } from './LinkPanel'
import { TURN_INTO } from './blockTypes'
import { COLOR_NAMES, markValueAt, rangeHasMark, selectionRect } from './richtext-dom'
import { AI_LANGUAGES, AI_LANGUAGE_LABELS, AI_TONES, AI_TONE_LABELS, type AiAction } from '@shared/ai'
import { useAiGate } from '@/ai/gate'
import { AI_GLYPH, aiOnRange, type AiOptions } from '@/ai/session'
import { preloadInlineAi } from '@/ai/slot'

/** Space the toolbar needs above the selection (its height plus a gap), in px. */
const TOOLBAR_OFFSET = 44
/** Gap kept from the viewport edge and, when flipped, below the selection. */
const TOOLBAR_GAP = 8
/** Half the toolbar's width: keeps the centred bar inside the viewport. */
const TOOLBAR_HALF_WIDTH = 190
/** The same with the AI button in the bar. */
const TOOLBAR_HALF_WIDTH_AI = 220

/** The AI menu of the toolbar, in order. `tone` and `translate` open a second list. */
const AI_ITEMS: { action: AiAction | null; label: string }[] = [
  { action: 'improve', label: 'Improve' },
  { action: 'fix', label: 'Fix spelling and grammar' },
  { action: 'shorten', label: 'Shorter' },
  { action: 'lengthen', label: 'Longer' },
  { action: 'expand', label: 'Expand with detail' },
  { action: 'simplify', label: 'Simplify' },
  { action: 'tone', label: 'Change tone' },
  { action: 'translate', label: 'Translate' },
  { action: 'explain', label: 'Explain' },
  { action: null, label: 'Custom…' }
]

interface Target {
  id: string
  start: number
  end: number
  rect: DOMRect
}

type Panel = 'link' | 'color' | 'turn' | 'ai' | 'ai-tone' | 'ai-translate' | null

function sameTarget(a: Target, b: Target): boolean {
  return (
    a.id === b.id &&
    a.start === b.start &&
    a.end === b.end &&
    a.rect.top === b.rect.top &&
    a.rect.left === b.rect.left &&
    a.rect.width === b.rect.width &&
    a.rect.bottom === b.rect.bottom
  )
}

/** Floating formatting toolbar shown above a non-empty text selection. */
export function SelectionToolbar(): JSX.Element | null {
  const { ctrl } = useEditor()
  const [target, setTarget] = useState<Target | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [url, setUrl] = useState('')
  const [urlInvalid, setUrlInvalid] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const mouseDown = useRef(false)
  const linkRequest = useStore(ctrl.ui, (s) => s.linkRequest)
  const ai = useAiGate((state) => state.enabled)
  // While an AI preview is open the toolbar stays out of the way.
  const aiBusy = useStore(ctrl.ui, (s) => s.ai !== null)

  const read = useCallback((): Target | null => {
    const key = ctrl.focusedKey()
    const f = key ? ctrl.focusable(key) : undefined
    if (!key || !f?.rich) return null
    const o = f.getSel()
    if (!o || o.end <= o.start) return null
    const rect = selectionRect(f.el)
    return rect ? { id: key, start: o.start, end: o.end, rect } : null
  }, [ctrl])

  const compute = useCallback(() => {
    // Focus is in the toolbar itself (link input): keep the stored range.
    if (barRef.current?.contains(document.activeElement)) return
    const next = mouseDown.current ? null : read()
    // Same range in the same place: keep the object, so nothing re-renders.
    setTarget((prev) => (prev && next && sameTarget(prev, next) ? prev : next))
    if (!next) setPanel(null)
  }, [read])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && barRef.current?.contains(e.target)) return
      mouseDown.current = true
      setTarget(null)
      setPanel(null)
    }
    let upTimer = 0
    const onUp = (): void => {
      if (!mouseDown.current) return
      mouseDown.current = false
      window.clearTimeout(upTimer)
      upTimer = window.setTimeout(compute, 0)
    }
    // Scroll does not bubble: capture it on the document so any scrolling ancestor repositions the bar.
    // One measurement per frame, however many scroll events arrive.
    let frame = 0
    const onScroll = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        compute()
      })
    }
    const scrollOpts = { capture: true, passive: true }
    document.addEventListener('selectionchange', compute)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('mouseup', onUp, true)
    document.addEventListener('scroll', onScroll, scrollOpts)
    return () => {
      window.clearTimeout(upTimer)
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', compute)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('mouseup', onUp, true)
      document.removeEventListener('scroll', onScroll, scrollOpts)
    }
  }, [compute])

  const openLink = useCallback((t: Target) => {
    setUrl(markValueAt(getBlock(t.id)?.props.title, t.start, t.end, 'a') ?? '')
    setUrlInvalid(false)
    setPanel('link')
  }, [])

  // Ctrl+K
  useEffect(() => {
    if (!linkRequest) return
    const t = read()
    if (!t) return
    setTarget(t)
    openLink(t)
  }, [linkRequest, read, openLink])

  if (!target || aiBusy) return null
  const title = getBlock(target.id)?.props.title
  const has = (kind: string): boolean => rangeHasMark(title, target.start, target.end, kind)
  const range = { id: target.id, start: target.start, end: target.end }
  const above = target.rect.top - TOOLBAR_OFFSET
  const top = above < TOOLBAR_GAP ? target.rect.bottom + TOOLBAR_GAP : above
  const centre = target.rect.left + target.rect.width / 2
  const half = ai ? TOOLBAR_HALF_WIDTH_AI : TOOLBAR_HALF_WIDTH
  const left = Math.max(half, Math.min(centre, window.innerWidth - half))
  const aiOpen = panel === 'ai' || panel === 'ai-tone' || panel === 'ai-translate'

  const runAi = (action: AiAction | null, options?: AiOptions): void => {
    setPanel(null)
    aiOnRange(ctrl, action, range, options)
  }

  const markButton = (kind: string, mark: Mark, label: string, content: ReactNode, cls = ''): JSX.Element => (
    <button
      type="button"
      title={label}
      aria-pressed={has(kind)}
      className={`pe-tb-btn ${cls}${has(kind) ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => ctrl.toggleMark(mark, range)}
    >
      {content}
    </button>
  )

  const applyLink = (value: string | null): void => {
    // A url that is not allowed changes nothing (it must not silently remove an existing link).
    if (ctrl.setLink(range, value)) setPanel(null)
    else setUrlInvalid(true)
  }

  return createPortal(
    <div
      ref={barRef}
      className="pe-toolbar"
      style={{ top, left }}
      role="toolbar"
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      <div className="pe-tb-row">
        {ai && (
          <>
            <button
              type="button"
              title="Ask AI about the selection"
              aria-haspopup="menu"
              aria-expanded={aiOpen}
              className={`pe-tb-btn pe-tb-wide pe-tb-ai${aiOpen ? ' is-active' : ''}`}
              onPointerEnter={preloadInlineAi}
              onClick={() => setPanel(aiOpen ? null : 'ai')}
            >
              <span aria-hidden="true">{AI_GLYPH}</span> AI
            </button>
            <span className="pe-tb-sep" />
          </>
        )}
        <button type="button" className="pe-tb-btn pe-tb-wide" onClick={() => setPanel(panel === 'turn' ? null : 'turn')}>
          Turn into <ChevronDown size={12} />
        </button>
        <span className="pe-tb-sep" />
        {markButton('b', ['b'], 'Bold (Ctrl+B)', 'B', 'pe-tb-b')}
        {markButton('i', ['i'], 'Italic (Ctrl+I)', 'I', 'pe-tb-i')}
        {markButton('u', ['u'], 'Underline (Ctrl+U)', 'U', 'pe-tb-u')}
        {markButton('s', ['s'], 'Strikethrough (Ctrl+Shift+S)', 'S', 'pe-tb-s')}
        {markButton('c', ['c'], 'Code (Ctrl+E)', <CodeIcon size={14} />)}
        <button
          type="button"
          title="Link (Ctrl+K)"
          className={`pe-tb-btn${has('a') ? ' is-active' : ''}`}
          onClick={() => (panel === 'link' ? setPanel(null) : openLink(target))}
        >
          <LinkIcon size={14} />
        </button>
        <span className="pe-tb-sep" />
        <button type="button" title="Colour" className="pe-tb-btn pe-tb-wide" onClick={() => setPanel(panel === 'color' ? null : 'color')}>
          A <ChevronDown size={12} />
        </button>
      </div>
      {panel === 'link' && (
        <LinkPanel
          value={url}
          invalid={urlInvalid}
          hasLink={has('a')}
          pageId={ctrl.pageId}
          onChange={(value) => {
            setUrl(value)
            setUrlInvalid(false)
          }}
          onApply={applyLink}
          onCancel={() => {
            setPanel(null)
            ctrl.focusBlock(range.id, range.start, range.end)
          }}
        />
      )}
      {panel === 'color' && (
        <div className="pe-tb-panel pe-tb-colors">
          <div className="pe-tb-heading">Text</div>
          <div className="pe-tb-swatches">
            <button type="button" className="pe-swatch" title="Default" onClick={() => ctrl.setMark(range, 'h', null)}>
              A
            </button>
            {COLOR_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                title={name}
                className={`pe-swatch rt-fg-${name}`}
                onClick={() => ctrl.setMark(range, 'h', ['h', name])}
              >
                A
              </button>
            ))}
          </div>
          <div className="pe-tb-heading">Background</div>
          <div className="pe-tb-swatches">
            <button type="button" className="pe-swatch" title="Default" onClick={() => ctrl.setMark(range, 'hb', null)}>
              A
            </button>
            {COLOR_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                title={`${name} background`}
                className={`pe-swatch rt-bg-${name}`}
                onClick={() => ctrl.setMark(range, 'hb', ['h', `${name}_background`])}
              >
                A
              </button>
            ))}
          </div>
        </div>
      )}
      {panel === 'ai' && (
        <div className="pe-tb-panel pe-tb-turn pe-tb-ai-menu" role="menu">
          {AI_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="pe-tb-turn-item"
              onClick={() => {
                if (item.action === 'tone') setPanel('ai-tone')
                else if (item.action === 'translate') setPanel('ai-translate')
                else runAi(item.action)
              }}
            >
              <span className="pe-tb-ai-label">{item.label}</span>
              {(item.action === 'tone' || item.action === 'translate') && <ChevronRight size={12} />}
            </button>
          ))}
        </div>
      )}
      {panel === 'ai-tone' && (
        <div className="pe-tb-panel pe-tb-turn pe-tb-ai-menu" role="menu">
          <div className="pe-tb-heading">Change tone</div>
          {AI_TONES.map((tone) => (
            <button key={tone} type="button" role="menuitem" className="pe-tb-turn-item" onClick={() => runAi('tone', { tone })}>
              {AI_TONE_LABELS[tone]}
            </button>
          ))}
        </div>
      )}
      {panel === 'ai-translate' && (
        <div className="pe-tb-panel pe-tb-turn pe-tb-ai-menu" role="menu">
          <div className="pe-tb-heading">Translate to</div>
          {AI_LANGUAGES.map((language) => (
            <button
              key={language}
              type="button"
              role="menuitem"
              className="pe-tb-turn-item"
              onClick={() => runAi('translate', { language })}
            >
              {AI_LANGUAGE_LABELS[language]}
            </button>
          ))}
        </div>
      )}
      {panel === 'turn' && (
        <div className="pe-tb-panel pe-tb-turn">
          {TURN_INTO.map((t) => (
            <button
              key={t.id}
              type="button"
              className="pe-tb-turn-item"
              onClick={() => {
                setPanel(null)
                ctrl.turnInto([range.id], t.type)
              }}
            >
              <span className="pe-menu-glyph">{t.glyph}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
