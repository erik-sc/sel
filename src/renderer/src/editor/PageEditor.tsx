import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, JSX, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Block } from '@shared/types'
import { getBlock, isTreeCached, loadTree, takePrefetchedTree, useBlock, useTreePin } from '@/store/blocks'
import { clearBlockSelection, setBlockSelection } from '@/store/selection'
import { RowProperties } from '@/database/lazy'
import { EditorContext, type EditorContextValue } from './context'
import { MIME_BLOCKS } from './clipboard'
import { EditorController } from './controller'
import type { DropTarget } from './types'
import { isTextType } from './blockTypes'
import { BlockList } from './BlockView'
import { Backlinks } from './Backlinks'
import { PageHeader } from './PageHeader'
import { BlockMenu, SlashMenu, SourcePickerPopover } from './menus'
import { SelectionToolbar } from './SelectionToolbar'
import { SkeletonLines as Skeleton } from '@/ui/Skeleton'
import { flushOnUnload } from '@/ui/unload'
import { bootMark } from '@/boot'
import { takeMenuKey } from '@/a11y/keys'
import { useAiGate } from '@/ai/gate'
import { aiConsolidate, aiOnPage, insertFromAssistant, scopeOf } from '@/ai/session'
import type { AiTarget } from '@/ai/plan'
import { AiSlot, preloadInlineAi } from '@/ai/slot'
import { MeetingSlot } from '@/meetings/slot'
import './editor.css'

export interface PageEditorProps {
  pageId: string
  onOpenPage: (id: string, opts?: { newTab?: boolean }) => void
  /** The page's blocks only, without its title, properties, meeting and backlinks: a task's notes in the task panel. */
  bodyOnly?: boolean
}

export function PageEditor(props: PageEditorProps): JSX.Element {
  // A fresh controller (history, selection, registry) per page.
  return <PageEditorInner key={props.pageId} {...props} />
}

/** Areas inside the editor that manage their own input (embedded database, row properties). */
const FOREIGN = '.blk-database-box, .pe-rowprops, .ai-slot, .mt-slot, .pe-backlinks'
const INTERACTIVE = '.rt, textarea, input, select, button, a, .blk-bookmark, .blk-pagelink'
/** Vertical mouse travel (px) before a press on empty space becomes a block-selection drag. */
const DRAG_SELECT_THRESHOLD = 6
/** Dropping right of this offset (px) from a text block's left edge nests the dragged blocks inside it. */
const DROP_INSIDE_OFFSET = 56
/** Fallback probe (px from the body's left edge) for finding the block on a row when the pointer is in the margin. */
const ROW_PROBE_OFFSET = 120

function RowPropertiesGate({ page, onOpenPage }: { page: Block; onOpenPage: PageEditorProps['onOpenPage'] }): JSX.Element | null {
  const parent = useBlock(page.parentId)
  if (parent?.type !== 'database') return null
  return (
    <div className="pe-content pe-rowprops">
      <RowProperties pageId={page.id} onOpenPage={onOpenPage} />
    </div>
  )
}

function PageEditorInner({ pageId, onOpenPage, bodyOnly = false }: PageEditorProps): JSX.Element {
  const ctrl = useMemo(() => new EditorController(pageId), [pageId])
  const page = useBlock(pageId)
  // The controller reads the page's blocks synchronously: none may be evicted while it is open.
  useTreePin(pageId)
  // A page whose blocks are all still cached (a tab or a page visited a moment ago) is shown
  // at once; `loadTree` below then only brings it up to date.
  const [loaded, setLoaded] = useState(() => isTreeCached(pageId))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const ctx = useMemo<EditorContextValue>(() => ({ ctrl, onOpenPage }), [ctrl, onOpenPage])

  useEffect(() => {
    ctrl.onOpenPage = onOpenPage
  }, [ctrl, onOpenPage])

  // Undo history can hold a lot of text. It goes when the page really closes (StrictMode's
  // simulated unmount sets the effect up again before the microtask runs).
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (!mounted.current) ctrl.history.clear()
      })
    }
  }, [ctrl])

  // A version was restored over this page (from any window): the recorded undo steps describe
  // blocks that may no longer exist, and replaying one could corrupt the restored content.
  useEffect(
    () =>
      window.api.onChange((event) => {
        if (!Array.isArray(event.reset) || !event.reset.includes(pageId)) return
        ctrl.history.clear()
        // What the backend says is the page now, whatever was cached or half-typed.
        loadTree(pageId).catch((err) => console.error('[editor] reload after restore failed', err))
      }),
    [pageId, ctrl]
  )

  useEffect(() => {
    let alive = true
    if (isTreeCached(pageId)) bootMark('first-page')
    // At start-up the tree was requested while this code was still loading (see main.tsx).
    const loading = takePrefetchedTree(pageId) ?? loadTree(pageId)
    loading
      .catch((err) => console.error('[editor] loadTree failed', err))
      .finally(() => {
        if (alive) setLoaded(true)
        bootMark('first-page')
      })
    // Typing still inside the debounce is written when the window loses focus or closes.
    const flush = (): void => ctrl.flushAll()
    const offUnload = flushOnUnload(flush)
    window.addEventListener('blur', flush)
    return () => {
      alive = false
      offUnload()
      window.removeEventListener('blur', flush)
      ctrl.flushAll()
      ctrl.dispose()
    }
  }, [pageId, ctrl])

  // The inline prompt opens on a single key (Space on an empty line): its code is fetched while
  // the page sits idle, so that the first use does not wait for it.
  const aiOn = useAiGate((state) => state.enabled)
  useEffect(() => {
    if (!aiOn || !loaded) return
    const id = window.requestIdleCallback(preloadInlineAi, { timeout: 3000 })
    return () => window.cancelIdleCallback(id)
  }, [aiOn, loaded])

  // A page-level AI action asked for from the page menu ("Summarize page", "Suggest title").
  const aiCommand = useAiGate((state) => (state.command?.pageId === pageId ? state.command : null))
  useEffect(() => {
    if (!aiCommand || !loaded) return
    useAiGate.setState({ command: null })
    if (aiCommand.action === 'consolidate') aiConsolidate(ctrl)
    else aiOnPage(ctrl, aiCommand.action, null)
  }, [aiCommand, loaded, ctrl])

  // While the conversation balloon is open it can see what is selected here and put answers into
  // the page. The selection is remembered when the focus leaves the editor for the balloon.
  const assistantOpen = useAiGate((state) => state.enabled && state.balloonOpen)
  useEffect(() => {
    if (!assistantOpen) return
    let scope: AiTarget | null = null
    let lastBlock: string | null = null
    const track = (): void => {
      const root = rootRef.current
      const active = document.activeElement
      if (!root || !active || !root.contains(active) || active.closest(FOREIGN)) return
      const sel = ctrl.currentSel()
      if (sel?.kind === 'text') lastBlock = sel.blockId.split(':')[0] === pageId ? lastBlock : sel.blockId.split(':')[0]
      const found = scopeOf(ctrl, sel)
      scope = found?.target ?? null
      const current = useAiGate.getState().scope
      if (found ? current?.text !== found.text || current.pageId !== pageId : current !== null) {
        useAiGate.setState({ scope: found ? { pageId, text: found.text } : null })
      }
    }
    const bridge = {
      pageId,
      insert: (markdown: string, mode: 'below' | 'replace'): boolean => {
        const done = insertFromAssistant(ctrl, markdown, mode, scope, lastBlock)
        if (done && mode === 'replace') {
          scope = null
          useAiGate.setState({ scope: null })
        }
        return done
      }
    }
    track()
    useAiGate.setState({ editor: bridge })
    document.addEventListener('selectionchange', track)
    const offSelected = ctrl.ui.subscribe((state, previous) => {
      if (state.selected !== previous.selected) track()
    })
    return () => {
      document.removeEventListener('selectionchange', track)
      offSelected()
      if (useAiGate.getState().editor === bridge) useAiGate.setState({ editor: null, scope: null })
    }
  }, [assistantOpen, ctrl, pageId])

  // The blocks selected here, for the word count in the top bar.
  useEffect(() => {
    setBlockSelection(pageId, ctrl.ui.getState().selected)
    const off = ctrl.ui.subscribe((state, previous) => {
      if (state.selected !== previous.selected) setBlockSelection(pageId, state.selected)
    })
    return () => {
      off()
      clearBlockSelection(pageId)
    }
  }, [ctrl, pageId])

  /** True when the event really happened inside the editor surface (not in a portal or embed). */
  const own = (target: EventTarget | null): target is HTMLElement =>
    target instanceof HTMLElement && !!rootRef.current?.contains(target) && !target.closest(FOREIGN)

  const blockElAt = (x: number, y: number): HTMLElement | null => {
    const root = rootRef.current
    if (!root) return null
    const pick = (px: number): HTMLElement | null => {
      const el = document.elementFromPoint(px, y)
      const blk = el instanceof Element && root.contains(el) ? el.closest<HTMLElement>('[data-block-id]') : null
      return blk
    }
    const body = root.querySelector('.pe-body')?.getBoundingClientRect()
    return pick(x) ?? (body ? pick(body.left + Math.min(body.width / 2, ROW_PROBE_OFFSET)) : null)
  }

  // ---- keyboard ---------------------------------------------------------

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!own(e.target)) return
    const tag = e.target.tagName
    if (tag === 'INPUT' || tag === 'SELECT') return
    const mod = e.ctrlKey || e.metaKey
    const lower = e.key.toLowerCase()
    if (mod && !e.altKey && lower === 'z') {
      e.preventDefault()
      void (e.shiftKey ? ctrl.redo() : ctrl.undo())
      return
    }
    if (mod && !e.altKey && !e.shiftKey && lower === 'y') {
      e.preventDefault()
      void ctrl.redo()
      return
    }
    const { selected } = ctrl.ui.getState()
    if (e.target !== rootRef.current) return
    if (mod && !e.shiftKey && lower === 'a') {
      e.preventDefault()
      ctrl.selectAll()
      return
    }
    if (!selected.length) return
    // The Menu key or Shift+F10: the selected blocks' menu, as the drag handle opens it.
    if (takeMenuKey(e)) {
      e.preventDefault()
      const id = selected[selected.length - 1]
      const el = rootRef.current?.querySelector(`[data-block-id="${CSS.escape(id)}"] > .blk-row`)
      if (el) ctrl.ui.setState({ menu: { id, rect: el.getBoundingClientRect() } })
      return
    }
    if (mod) {
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        ctrl.moveBlocks(selected, e.key === 'ArrowUp' ? -1 : 1)
      } else if (!e.shiftKey && lower === 'd') {
        e.preventDefault()
        ctrl.duplicate(selected)
      }
      return
    }
    switch (e.key) {
      case 'Backspace':
      case 'Delete':
        e.preventDefault()
        ctrl.deleteBlocks(selected)
        break
      case 'Escape':
        e.preventDefault()
        ctrl.clearBlockSelection()
        break
      case 'Enter': {
        e.preventDefault()
        ctrl.focusOrSelect(selected[selected.length - 1], 'end')
        break
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        if (e.shiftKey) ctrl.extendSelection(dir)
        else ctrl.moveSelection(dir)
        break
      }
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) ctrl.outdent(selected)
        else ctrl.indent(selected)
        break
    }
  }

  // ---- mouse: shift+click and drag across blocks ------------------------

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || !own(e.target)) return
    const t = e.target
    if (t.closest('.blk-gutter, .pe-cover, .pe-head-actions, .pe-icon')) return
    const startEl = t.closest<HTMLElement>('[data-block-id]')
    const startId = startEl?.dataset.blockId ?? null
    if (e.shiftKey) {
      const anchor = ctrl.shiftAnchor()
      if (anchor && startId && anchor !== startId) {
        e.preventDefault()
        ctrl.selectRange(anchor, startId)
        return
      }
    }
    const interactive = !!t.closest(INTERACTIVE)
    if (ctrl.ui.getState().selected.length) ctrl.clearBlockSelection()
    if (t.closest('textarea, input, select')) return
    const startX = e.clientX
    const startY = e.clientY
    let anchorId = startId
    let active = false
    // The selection rectangle: drawn from the press point once the drag is a block selection.
    let marquee: HTMLDivElement | null = null
    const drawMarquee = (x: number, y: number): void => {
      if (!marquee) {
        marquee = document.createElement('div')
        marquee.className = 'pe-marquee'
        document.body.appendChild(marquee)
      }
      marquee.style.left = Math.min(startX, x) + 'px'
      marquee.style.top = Math.min(startY, y) + 'px'
      marquee.style.width = Math.abs(x - startX) + 'px'
      marquee.style.height = Math.abs(y - startY) + 'px'
    }
    const root = e.currentTarget
    // Started on empty space: select every block the rectangle touches.
    const sweep = (ev: MouseEvent): void => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_SELECT_THRESHOLD) return
      active = true
      ev.preventDefault()
      window.getSelection()?.removeAllRanges()
      drawMarquee(ev.clientX, ev.clientY)
      const left = Math.min(startX, ev.clientX)
      const right = Math.max(startX, ev.clientX)
      const top = Math.min(startY, ev.clientY)
      const bottom = Math.max(startY, ev.clientY)
      const hit: string[] = []
      for (const el of root.querySelectorAll<HTMLElement>('.blk[data-block-id] > .blk-row')) {
        const r = el.getBoundingClientRect()
        if (r.bottom < top || r.top > bottom || r.right < left || r.left > right) continue
        const id = el.parentElement?.dataset.blockId
        if (id) hit.push(id)
      }
      const { anchor, head } = ctrl.ui.getState()
      if (!hit.length) {
        if (ctrl.ui.getState().selected.length) ctrl.clearBlockSelection()
      } else if (anchor !== hit[0] || head !== hit[hit.length - 1]) ctrl.selectRange(hit[0], hit[hit.length - 1])
    }
    const move = (ev: MouseEvent): void => {
      if (!startId) return sweep(ev)
      const cur = blockElAt(ev.clientX, ev.clientY)?.dataset.blockId ?? null
      if (!active) {
        if (anchorId ? !cur || cur === anchorId : !cur || Math.abs(ev.clientY - startY) < DRAG_SELECT_THRESHOLD) return
        active = true
        anchorId = anchorId ?? cur
      }
      ev.preventDefault()
      window.getSelection()?.removeAllRanges()
      drawMarquee(ev.clientX, ev.clientY)
      if (anchorId && cur) {
        const { anchor, head } = ctrl.ui.getState()
        if (anchor !== anchorId || head !== cur) ctrl.selectRange(anchorId, cur)
      }
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      marquee?.remove()
      // A plain click on a block without text (divider, image...) selects it.
      if (!active && startId && !interactive && t.closest('.blk-row')) ctrl.selectBlocks([startId])
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---- clipboard (block-selection mode; text blocks handle their own) -----
  // Native listeners on the document: with no DOM selection the browser targets
  // these events at <body>, not at the focused editor root.
  useEffect(() => {
    const active = (): boolean => !!rootRef.current && document.activeElement === rootRef.current
    const onCopy = (e: ClipboardEvent): void => {
      const { selected } = ctrl.ui.getState()
      if (!selected.length || !active() || !e.clipboardData) return
      e.preventDefault()
      const { text, json } = ctrl.copyPayload(selected)
      e.clipboardData.setData('text/plain', text)
      e.clipboardData.setData(MIME_BLOCKS, json)
      if (e.type === 'cut') ctrl.deleteBlocks(selected)
    }
    const onPaste = (e: ClipboardEvent): void => {
      if (!active() || !e.clipboardData) return
      e.preventDefault()
      ctrl.handlePaste(e.clipboardData, null)
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [ctrl])

  // ---- drag & drop ------------------------------------------------------

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    const files = e.dataTransfer.types.includes('Files')
    if ((!ctrl.dragIds && !files) || !own(e.target)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = ctrl.dragIds ? 'move' : 'copy'
    let drop: DropTarget | null = null
    const el = blockElAt(e.clientX, e.clientY)
    const id = el?.dataset.blockId
    if (el && id) {
      const row = el.querySelector(':scope > .blk-row') ?? el
      const r = row.getBoundingClientRect()
      const b = getBlock(id)
      if (e.clientY < r.top + r.height / 2) drop = { id, pos: 'before' }
      else if (b && isTextType(b.type) && e.clientX > r.left + DROP_INSIDE_OFFSET) drop = { id, pos: 'inside' }
      else drop = { id, pos: 'after' }
    } else {
      const last = ctrl.lastBlock()
      if (last) drop = { id: last, pos: 'after' }
    }
    const cur = ctrl.ui.getState().drop
    if (cur?.id !== drop?.id || cur?.pos !== drop?.pos) ctrl.ui.setState({ drop })
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    const files = Array.from(e.dataTransfer.files)
    if ((!ctrl.dragIds && !files.length) || !own(e.target)) return
    e.preventDefault()
    const drop = ctrl.ui.getState().drop
    const ids = ctrl.dragIds
    ctrl.dragIds = null
    ctrl.ui.setState({ drop: null })
    if (ids) {
      if (drop) ctrl.moveTo(ids, drop)
    } else void ctrl.dropFiles(files, drop)
  }

  const fullWidth = !!page?.props.fullWidth

  return (
    <EditorContext.Provider value={ctx}>
      <div
        ref={(el) => {
          rootRef.current = el
          ctrl.root = el
        }}
        className={['pe-root pe-page', fullWidth ? 'is-full' : '', bodyOnly ? 'is-body-only' : ''].filter(Boolean).join(' ')}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragLeave={(e) => {
          // Leaving the editor (or the window: relatedTarget is null), not just moving between its children.
          const to = e.relatedTarget
          const inside = to instanceof Node && !!rootRef.current?.contains(to)
          if (!inside && ctrl.ui.getState().drop) ctrl.ui.setState({ drop: null })
        }}
      >
        {page ? (
          <>
            {!bodyOnly && (
              <>
                <PageHeader page={page} />
                <RowPropertiesGate page={page} onOpenPage={onOpenPage} />
                <MeetingSlot page={page} />
              </>
            )}
            <div className="pe-content pe-body">
              {loaded && <AiSlot anchorId={null} />}
              {loaded ? <BlockList ids={page.content} top /> : <Skeleton />}
            </div>
            <div
              className="pe-tail"
              onClick={() => {
                if (loaded) ctrl.focusTail()
              }}
            />
            {loaded && !bodyOnly && <Backlinks pageId={page.id} />}
          </>
        ) : (
          <div className="pe-content pe-body pe-loading">
            <div className="pe-skeleton-title" aria-hidden="true" />
            <Skeleton />
          </div>
        )}
      </div>
      <SlashMenu />
      <SourcePickerPopover />
      <SelectionToolbar />
      <BlockMenu />
    </EditorContext.Provider>
  )
}
