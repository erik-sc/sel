// A LaTeX document, as Overleaf shows one: the source on the left, its preview on the right,
// redrawn a moment after typing stops, with a divider to drag between them. Scrolling one side
// brings the other to the same place, section by section. The source lives in the page's code
// block (language `latex`), so it syncs, has versions and is found by search like any page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { plainText } from '@shared/richtext'
import type { Block } from '@shared/types'
import { applyOps, loadTree, newId, useBlock, useBlocks, useTreePin } from '@/store/blocks'
import { renamePage, reportError } from '@/shell/actions'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'
import { flushOnUnload } from '@/ui/unload'
import { convertLatex, type LatexDiagnostic, type LatexResult, type MathEngine } from './convert'
import { exportLatexTex, LATEX_LANGUAGE, onLatexAction } from './gate'
import { loadMathEngine, loadedMathEngine, mathCache } from './katex'
import { useLatexLocale } from './locale'
import { SourceEditor, type SourceEditorHandle } from './SourceEditor'
import { LATEX_COPY } from './words'
import './latex.css'

type View = 'split' | 'code' | 'preview'

/** The preview is redrawn this long after the last keystroke. */
const PREVIEW_DEBOUNCE_MS = 300
/** Typing is written to the page this long after the last keystroke (and on leaving). */
const SAVE_DEBOUNCE_MS = 500
const SPLIT_KEY = 'sel.latex.split'
const VIEW_KEY = 'sel.latex.view'
const MIN_SPLIT = 0.2
const MAX_SPLIT = 0.8

function readStored<T>(key: string, parse: (raw: string | null) => T): T {
  try {
    return parse(localStorage.getItem(key))
  } catch {
    return parse(null)
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A preference only: the next document opens with the default.
  }
}

const clampSplit = (value: number): number => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value))

function sourceOf(children: readonly (Block | undefined)[]): Block | undefined {
  const code = children.filter((b): b is Block => !!b && b.type === 'code' && b.trashedAt === null)
  return code.find((b) => b.props.language === LATEX_LANGUAGE) ?? code[0]
}

interface Anchor {
  line: number
  top: number
}

/** Where each source line with an element of its own is drawn in the preview, top to bottom. */
function previewAnchors(scroller: HTMLElement): Anchor[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  const found: Anchor[] = []
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-line]')) {
    // Footnotes are drawn at the end, far from the line that wrote them.
    if (el.closest('.latex-footnotes')) continue
    found.push({ line: Number(el.dataset.line), top: el.getBoundingClientRect().top - base })
  }
  found.sort((a, b) => a.line - b.line || a.top - b.top)
  const anchors: Anchor[] = []
  for (const a of found) {
    const last = anchors[anchors.length - 1]
    if (last && (a.top < last.top || a.line === last.line)) continue
    anchors.push(a)
  }
  return anchors
}

function topForLine(anchors: readonly Anchor[], line: number): number {
  if (!anchors.length) return 0
  let i = 0
  while (i + 1 < anchors.length && anchors[i + 1].line <= line) i++
  const a = anchors[i]
  const b = anchors[i + 1]
  if (line < a.line) return 0
  if (!b) return a.top
  return a.top + ((line - a.line) / (b.line - a.line)) * (b.top - a.top)
}

function lineForTop(anchors: readonly Anchor[], top: number): number {
  if (!anchors.length) return 1
  let i = 0
  while (i + 1 < anchors.length && anchors[i + 1].top <= top) i++
  const a = anchors[i]
  const b = anchors[i + 1]
  if (top < a.top) return Math.max(1, a.line * (top / Math.max(1, a.top)))
  if (!b) return a.line
  return a.line + ((top - a.top) / Math.max(1, b.top - a.top)) * (b.line - a.line)
}

export function LatexDocument({ pageId }: { pageId: string }): JSX.Element {
  const locale = useLatexLocale()
  const copy = LATEX_COPY[locale]
  const page = useBlock(pageId)
  useTreePin(pageId)
  const children = useBlocks(page?.content ?? [])
  const source = sourceOf(children)
  const stored = source ? plainText(source.props.title) : null
  const readOnly = !!page?.trashedAt

  const [loaded, setLoaded] = useState(false)
  const [engine, setEngine] = useState<MathEngine | null>(() => loadedMathEngine())
  const [engineFailed, setEngineFailed] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [result, setResult] = useState<LatexResult | null>(null)
  const [view, setViewState] = useState<View>(() => readStored(VIEW_KEY, (raw) => (raw === 'code' || raw === 'preview' ? raw : 'split')))
  const [split, setSplit] = useState(() => readStored(SPLIT_KEY, (raw) => clampSplit(Number(raw) || 0.5)))
  const [showProblems, setShowProblems] = useState(true)
  const [busy, setBusy] = useState<'pdf' | 'tex' | null>(null)

  const editor = useRef<SourceEditorHandle>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const panesRef = useRef<HTMLDivElement>(null)
  const sourceId = useRef<string | null>(null)
  sourceId.current = source?.id ?? null
  const pending = useRef<{ timer: number; text: string | null }>({ timer: 0, text: null })
  const committed = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    loadTree(pageId)
      .then(() => alive && setLoaded(true))
      .catch((error: unknown) => {
        console.error('[latex] loadTree failed', error)
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [pageId])

  useEffect(() => {
    if (engine) return
    loadMathEngine().then(setEngine, (error: unknown) => {
      console.error('[latex] KaTeX could not be loaded', error)
      setEngineFailed(true)
    })
  }, [engine])

  // A document whose source block went missing (deleted elsewhere) gets an empty one back.
  useEffect(() => {
    if (!loaded || !page || page.trashedAt || source || page.content.some((id) => !children.find((b) => b?.id === id))) return
    void applyOps([
      {
        op: 'create',
        input: { id: newId(), type: 'code', parentId: pageId, afterId: null, props: { title: [], language: LATEX_LANGUAGE } }
      }
    ]).catch(reportError('restore the document source'))
  }, [loaded, page, source, children, pageId])

  // The first text, then changes made elsewhere (another window, sync, a restored version).
  // While an edit of this window waits to be written, it wins.
  useEffect(() => {
    if (stored === null) return
    if (text === null) {
      committed.current = stored
      setText(stored)
      return
    }
    if (pending.current.text !== null) return
    if (stored !== committed.current && stored !== editor.current?.getValue()) {
      editor.current?.setValue(stored)
      setText(stored)
    }
    committed.current = stored
  }, [stored, text])

  const commit = useCallback((): Promise<unknown> => {
    const p = pending.current
    window.clearTimeout(p.timer)
    p.timer = 0
    const value = p.text
    const id = sourceId.current
    if (value === null || !id) return Promise.resolve()
    p.text = null
    committed.current = value
    return applyOps([{ op: 'update', id, patch: { props: { title: value ? [[value]] : [] } } }]).catch(reportError('save the document'))
  }, [])

  useEffect(() => {
    const off = flushOnUnload(() => void commit())
    return () => {
      off()
      void commit()
    }
  }, [commit])

  const onInput = useCallback(
    (value: string) => {
      setText(value)
      const p = pending.current
      p.text = value
      window.clearTimeout(p.timer)
      p.timer = window.setTimeout(() => void commit(), SAVE_DEBOUNCE_MS)
    },
    [commit]
  )

  // The preview: at once the first time, then a moment after typing stops.
  const drawn = useRef(false)
  useEffect(() => {
    if (text === null || !engine) return
    const timer = window.setTimeout(
      () => {
        drawn.current = true
        setResult(convertLatex(text, { engine, locale, cache: mathCache }))
      },
      drawn.current ? PREVIEW_DEBOUNCE_MS : 0
    )
    return () => window.clearTimeout(timer)
  }, [text, engine, locale])

  const setView = (next: View): void => {
    setViewState(next)
    store(VIEW_KEY, next)
  }

  // ---- scroll sync

  const sync = useRef({ ignoreEditor: 0, ignorePreview: 0, frame: 0 })
  const onEditorScroll = useCallback(() => {
    const s = sync.current
    if (performance.now() < s.ignoreEditor || view !== 'split') return
    cancelAnimationFrame(s.frame)
    s.frame = requestAnimationFrame(() => {
      const preview = previewRef.current
      const ed = editor.current
      if (!preview || !ed) return
      s.ignorePreview = performance.now() + 120
      preview.scrollTop = topForLine(previewAnchors(preview), ed.topLine()) - 16
    })
  }, [view])
  const onPreviewScroll = useCallback(() => {
    const s = sync.current
    if (performance.now() < s.ignorePreview || view !== 'split') return
    cancelAnimationFrame(s.frame)
    s.frame = requestAnimationFrame(() => {
      const preview = previewRef.current
      const ed = editor.current
      if (!preview || !ed) return
      s.ignoreEditor = performance.now() + 120
      ed.scrollToLine(lineForTop(previewAnchors(preview), preview.scrollTop + 16))
    })
  }, [view])

  // ---- divider

  const onDividerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const panes = panesRef.current
    if (!panes || e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const rect = panes.getBoundingClientRect()
    let last = split
    const move = (ev: PointerEvent): void => {
      last = clampSplit((ev.clientX - rect.left) / rect.width)
      setSplit(last)
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      store(SPLIT_KEY, String(last))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  const onDividerKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const delta = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0
    if (!delta) return
    e.preventDefault()
    const next = clampSplit(split + delta)
    setSplit(next)
    store(SPLIT_KEY, String(next))
  }

  // ---- export

  const exportTex = async (): Promise<void> => {
    setBusy('tex')
    try {
      await commit()
      exportLatexTex(pageId)
    } finally {
      setBusy(null)
    }
  }

  const exportPdf = useCallback(async (): Promise<void> => {
    const value = editor.current?.getValue() ?? text
    if (value === null || !engine || busy) return
    setBusy('pdf')
    // Printed is the document as typed now, alone: see the print rules in latex.css.
    const root = document.createElement('div')
    root.className = 'latex-print-root'
    root.innerHTML = convertLatex(value, { engine, locale, cache: mathCache }).html
    document.body.appendChild(root)
    document.documentElement.classList.add('latex-printing')
    try {
      await commit()
      const saved = await window.api.pages.exportPdf(pageId, locale === 'pt-BR' ? 'A4' : 'Letter')
      if (saved.saved) toast(copy.exported, { kind: 'success' })
    } catch (error) {
      notifyError(copy.couldNotExport, error)
    } finally {
      document.documentElement.classList.remove('latex-printing')
      root.remove()
      setBusy(null)
    }
  }, [text, engine, busy, locale, commit, pageId, copy])

  useEffect(
    () =>
      onLatexAction((id, action) => {
        if (id !== pageId) return false
        if (action === 'export-pdf') void exportPdf()
        else if (action === 'find') {
          if (view === 'preview') setView('split')
          editor.current?.openFind()
        }
        return true
      }),
    [pageId, exportPdf, view]
  )

  const jump = (d: LatexDiagnostic): void => {
    if (view === 'preview') setView('split')
    requestAnimationFrame(() => editor.current?.goToLine(d.line))
  }

  const diagnostics = result?.diagnostics ?? []
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.length - errors
  const status = useMemo(() => {
    if (engineFailed) return copy.loadFailed
    if (!result) return copy.rendering
    if (!diagnostics.length) return copy.ok
    return [errors ? copy.errors(errors) : '', warnings ? copy.warnings(warnings) : ''].filter(Boolean).join(' · ')
  }, [engineFailed, result, diagnostics.length, errors, warnings, copy])

  const pageTitle = plainText(page?.props.title)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)

  return (
    <div className="latex-screen" data-view={view}>
      <div className="latex-toolbar">
        <input
          className="latex-title-input"
          value={titleDraft ?? pageTitle}
          aria-label="Title"
          readOnly={readOnly}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (titleDraft !== null) void renamePage(pageId, titleDraft.trim() || pageTitle).catch(reportError('rename the page'))
            setTitleDraft(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              if (e.key === 'Escape') setTitleDraft(null)
              e.currentTarget.blur()
            }
          }}
        />
        <div className="latex-seg" role="group" aria-label={copy.viewLabel}>
          {(['code', 'split', 'preview'] as const).map((v) => (
            <button key={v} type="button" className="latex-seg-btn" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'code' ? copy.code : v === 'split' ? copy.split : copy.preview}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`latex-status${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`}
          aria-expanded={diagnostics.length ? showProblems : undefined}
          title={diagnostics.length ? (showProblems ? copy.hideProblems : copy.showProblems) : undefined}
          disabled={!diagnostics.length}
          onClick={() => {
            setShowProblems((s) => !s)
            if (view === 'preview') setView('split')
          }}
        >
          <span className="latex-status-dot" aria-hidden="true" />
          {status}
        </button>
        <div className="latex-actions">
          <Button variant="ghost" disabled={!!busy || text === null} onClick={() => void exportTex()}>
            {copy.exportTex}
          </Button>
          <Button variant="ghost" disabled={!!busy || !result} onClick={() => void exportPdf()}>
            {busy === 'pdf' ? copy.exporting : copy.exportPdf}
          </Button>
        </div>
      </div>
      <div className="latex-panes" ref={panesRef} style={{ ['--latex-split' as string]: String(split) }}>
        <section className="latex-source-pane" aria-label={copy.sourceLabel}>
          {text !== null && (
            <SourceEditor
              ref={editor}
              initial={text}
              copy={copy}
              diagnostics={diagnostics}
              readOnly={readOnly}
              onInput={onInput}
              onScroll={onEditorScroll}
            />
          )}
          {showProblems && diagnostics.length > 0 && (
            <div className="latex-problems" role="list" aria-label={copy.problems}>
              {diagnostics.map((d, i) => (
                <button key={i} type="button" role="listitem" className={`latex-problem is-${d.severity}`} onClick={() => jump(d)}>
                  <span className="latex-problem-line">{copy.line(d.line)}</span>
                  <span className="latex-problem-message">{d.message}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <div
          className="latex-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label={copy.divider}
          aria-valuemin={MIN_SPLIT * 100}
          aria-valuemax={MAX_SPLIT * 100}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          onPointerDown={onDividerDown}
          onKeyDown={onDividerKey}
          onDoubleClick={() => {
            setSplit(0.5)
            store(SPLIT_KEY, '0.5')
          }}
        />
        <section className="latex-preview-pane" aria-label={copy.preview}>
          <div className="latex-preview-scroll" ref={previewRef} onScroll={onPreviewScroll}>
            {result ? (
              <div className="latex-paper" dangerouslySetInnerHTML={{ __html: result.html }} />
            ) : (
              <div className="latex-paper is-waiting">{engineFailed ? copy.loadFailed : copy.rendering}</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
