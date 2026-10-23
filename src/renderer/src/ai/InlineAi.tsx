// The inline face of an AI action: a prompt bar when the user still has to say what to write,
// then the answer streaming into a preview at the place it would go. The preview is not part
// of the page. Accept turns it into blocks in one undoable step; Discard leaves no trace.
// Loaded on demand (see slot.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { parseTitleSuggestions, type AiAction, type AiRequest } from '@shared/ai'
import { useEditor } from '@/editor/context'
import { setSelectionOffsets } from '@/editor/richtext-dom'
import { Button } from '@/ui/Button'
import { useAiRun } from './client'
import { openAiSetup } from './gate'
import { ACTION_TITLES, errorLines, statusText } from './labels'
import { isBusy } from './machine'
import { MarkdownView } from './MarkdownView'
import { SentNote } from './SentNote'
import { AI_GLYPH, acceptAi, applyAiTitle, discardAi, type AiSession } from './session'
import './ai.css'
import { IconGlyph } from '@/ui/IconGlyph'

interface HighlightRegistry {
  set(name: string, highlight: object): void
  delete(name: string): void
}

const HIGHLIGHT = 'ai-target'

/** Marks the text an action is about while the focus is in the preview (the selection itself is gone by then). */
function useTargetHighlight(session: AiSession): void {
  const { ctrl } = useEditor()
  useEffect(() => {
    const { target } = session
    const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => object }).Highlight
    if (target.kind !== 'range' || !registry || !HighlightCtor) return
    const el = ctrl.focusable(target.blockId)?.el
    if (!el) return
    setSelectionOffsets(el, target.start, target.end)
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    registry.set(HIGHLIGHT, new HighlightCtor(selection.getRangeAt(0).cloneRange()))
    return () => registry.delete(HIGHLIGHT)
  }, [ctrl, session])
}

export function InlineAi({ session }: { session: AiSession }): JSX.Element {
  const { ctrl } = useEditor()
  const [run, controls] = useAiRun()
  /** The request on screen; null while the prompt bar waits for the user's words. */
  const [request, setRequest] = useState<AiRequest | null>(() => (session.action ? { action: session.action, ...session.base } : null))
  const [text, setText] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closed = useRef(false)
  useTargetHighlight(session)

  const send = useCallback(
    (next: AiRequest) => {
      setRequest(next)
      setText('')
      controls.start(next)
    },
    [controls]
  )

  // An action that needs no words starts as soon as its preview is on screen.
  const initial = useRef(request)
  useEffect(() => {
    if (initial.current) controls.start(initial.current)
  }, [controls])

  // The keyboard is here from the start, and stays here when the prompt bar turns into the preview.
  const asking = request === null
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: 'nearest' })
    ;(inputRef.current ?? rootRef.current)?.focus({ preventScroll: true })
  }, [asking])

  // Not signed in or not installed: the one sheet that explains what to do.
  const errorCode = run.error?.code
  useEffect(() => {
    if (errorCode === 'not-installed') openAiSetup('not-installed')
  }, [errorCode])

  // Before the first request has left (the effect above runs after the first paint) it is already on its way.
  const busy = isBusy(run) || (run.status === 'idle' && request !== null)
  // The answer grew while it streamed: once it is whole, its buttons are brought into view.
  useEffect(() => {
    if (!busy) rootRef.current?.scrollIntoView({ block: 'nearest' })
  }, [busy])
  const isTitle = request?.action === 'title'
  const hasAnswer = run.text.trim().length > 0
  const settled = run.status === 'done' || run.status === 'cancelled'
  const canAccept = settled && hasAnswer && !isTitle
  const titles = useMemo(() => (isTitle && run.status === 'done' ? parseTitleSuggestions(run.text) : []), [isTitle, run.status, run.text])

  const discard = (): void => {
    if (closed.current) return
    closed.current = true
    discardAi(ctrl)
  }
  const accept = (): void => {
    if (!canAccept || closed.current) return
    closed.current = true
    acceptAi(ctrl, run.text)
  }
  /** A change to the answer on screen: the draft becomes the text the next request works on. */
  const refine = (action: AiAction, instruction?: string): void => {
    if (!hasAnswer) return
    send({ action, pageId: session.base.pageId, selectionText: run.text, ...(instruction ? { instruction } : {}) })
  }
  const submit = (): void => {
    const words = text.trim()
    if (!words) return
    if (!request) send({ action: 'custom', ...session.base, instruction: words })
    else if (hasAnswer && settled) refine('custom', words)
    else send({ ...request, instruction: words })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    // Nothing typed here is for the editor around it.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      discard()
      return
    }
    const inInput = event.target === inputRef.current
    if (!request && inInput && event.key === 'Backspace' && !text) {
      // Backing out of an empty prompt: as if Space had never been pressed.
      event.preventDefault()
      discard()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    // Enter on a focused button presses that button.
    if (event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    if (inInput && text.trim()) submit()
    else accept()
  }

  if (!request) {
    return (
      <div
        ref={rootRef}
        className="ai-prompt"
        role="group"
        aria-label="Ask AI"
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // An empty prompt bar that loses the focus goes away quietly; the caret is wherever the user put it.
          const to = event.relatedTarget
          if (text.trim() || closed.current || (to instanceof Node && event.currentTarget.contains(to))) return
          closed.current = true
          ctrl.ui.setState({ ai: null })
        }}
      >
        <span className="ai-badge" aria-hidden="true">
          {AI_GLYPH}
        </span>
        <input
          ref={inputRef}
          className="ai-input"
          value={text}
          maxLength={2000}
          placeholder={session.prompt ?? 'Ask AI to write…'}
          aria-label={session.prompt ?? 'Ask AI to write'}
          onChange={(event) => setText(event.target.value)}
        />
        <Button variant="primary" className="ai-send" disabled={!text.trim()} onClick={submit}>
          Write
        </Button>
        <span className="ai-hint">Esc to close</span>
      </div>
    )
  }

  const status = statusText(run)
  const error = run.status === 'error' && run.error ? errorLines(run.error) : null
  return (
    <div
      ref={rootRef}
      className={`ai-card${busy ? ' is-streaming' : ''}${error ? ' is-error' : ''}`}
      role="group"
      aria-label="AI suggestion"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="ai-card-head">
        <span className="ai-badge">
          <span aria-hidden="true">{AI_GLYPH}</span> AI
        </span>
        <span className="ai-card-title">{ACTION_TITLES[request.action]}</span>
        <span className="ai-status" role="status" aria-live="polite">
          {status}
        </span>
      </div>

      <div className="ai-card-body" aria-busy={busy}>
        {isTitle ? (
          titles.length > 0 ? (
            <div className="ai-titles" role="listbox" aria-label="Title suggestions">
              {titles.map((entry, index) => (
                <button
                  key={index}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="ai-title-option"
                  onClick={() => applyAiTitle(ctrl, entry.title, entry.emoji)}
                >
                  <span className="ai-title-emoji" aria-hidden="true">
                    {entry.emoji && <IconGlyph icon={entry.emoji} />}
                  </span>
                  <span>{entry.title}</span>
                </button>
              ))}
            </div>
          ) : busy ? (
            <div className="ai-skeleton" aria-hidden="true" />
          ) : !error ? (
            <p className="ai-note">No suggestions this time.</p>
          ) : null
        ) : hasAnswer ? (
          <MarkdownView markdown={run.text} />
        ) : busy ? (
          <div className="ai-skeleton" aria-hidden="true" />
        ) : !error ? (
          <p className="ai-note">{run.status === 'cancelled' ? 'Stopped before anything was written.' : 'The answer was empty.'}</p>
        ) : null}
        {error && (
          <div className="ai-error" role="alert">
            <p>{error.message}</p>
            {error.detail && <p className="ai-error-detail">{error.detail}</p>}
          </div>
        )}
        {run.truncated && <p className="ai-note">The answer was cut off because it got too long.</p>}
        {run.status === 'done' && <SentNote sent={run.sent} />}
      </div>

      <div className="ai-bar">
        <div className="ai-actions">
          {busy ? (
            <Button onClick={() => controls.cancel()}>Stop</Button>
          ) : (
            <>
              {!isTitle && (
                <Button variant="primary" disabled={!canAccept} onClick={accept}>
                  Accept <kbd className="ai-kbd">↵</kbd>
                </Button>
              )}
              <Button onClick={discard}>
                Discard <kbd className="ai-kbd">Esc</kbd>
              </Button>
              <Button variant="ghost" onClick={() => send(request)}>
                Try again
              </Button>
              {canAccept && (
                <>
                  <Button variant="ghost" onClick={() => refine('lengthen')}>
                    Make longer
                  </Button>
                  <Button variant="ghost" onClick={() => refine('shorten')}>
                    Make shorter
                  </Button>
                </>
              )}
              {errorCode === 'not-logged-in' && (
                <Button variant="ghost" onClick={() => openAiSetup('not-logged-in')}>
                  How to sign in
                </Button>
              )}
            </>
          )}
        </div>
        {!isTitle && (
          <input
            ref={inputRef}
            className="ai-input"
            value={text}
            maxLength={2000}
            readOnly={busy}
            placeholder={canAccept ? 'Ask for a change…' : 'Add a note for the next try…'}
            aria-label="Ask for a change"
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </div>
    </div>
  )
}
