// The assistant: a chat about the page in the active tab, in a panel to the right of it.
// Answers stream in as rich text; each can be put into the page (a click is the user's say-so),
// copied or asked again. Conversations are kept per page for as long as the window lives.
import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { create } from 'zustand'
import { AI_LIMITS, type AiTurn } from '@shared/ai'
import { pageTitle } from '@/shell/actions'
import { PageIcon } from '@/shell/PageIcon'
import { useBlock } from '@/store/blocks'
import { tabPage, useActiveTab } from '@/store/tabs'
import { Button, IconButton } from '@/ui/Button'
import { Close, Plus } from '@/ui/icons'
import { MOD_KEY } from '@/ui/platform'
import { notifyError, toast } from '@/ui/toast'
import { startRun, type RunHandle } from './client'
import { aiReady, openAiSetup, toggleAssistant, useAiGate } from './gate'
import { errorLines, statusText } from './labels'
import { IDLE, isBusy, reduceRun, type RunEvent, type RunState } from './machine'
import { MarkdownView } from './MarkdownView'
import { AI_GLYPH } from './session'
import './ai.css'

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** Assistant messages: the request behind the answer. */
  run?: RunState
  /** User messages: whether a selection was sent along. */
  withSelection?: boolean
}

/** Conversations by page id ('' for no page). */
const useChats = create<{ chats: Record<string, Message[]> }>(() => ({ chats: {} }))
const NO_MESSAGES: Message[] = []
let nextMessageId = 0

function setChat(key: string, update: (messages: Message[]) => Message[]): void {
  useChats.setState((state) => ({ chats: { ...state.chats, [key]: update(state.chats[key] ?? NO_MESSAGES) } }))
}

const SUGGESTIONS = ['Summarize this page', 'What are the action items?', 'What is missing or unclear?']

/** The finished turns before `upTo`, as the main process wants them: capped in number and size. */
function historyOf(messages: readonly Message[], upTo: number): AiTurn[] {
  const turns: AiTurn[] = []
  for (const message of messages.slice(0, upTo)) {
    if (message.role === 'assistant' && message.run?.status !== 'done') continue
    const text = message.text.slice(0, AI_LIMITS.historyTurnChars)
    if (text.trim()) turns.push({ role: message.role, text })
  }
  return turns.slice(-(AI_LIMITS.historyTurns - 2))
}

export function AssistantPanel(): JSX.Element {
  const pageId = tabPage(useActiveTab())
  const key = pageId ?? ''
  const page = useBlock(pageId)
  const messages = useChats((state) => state.chats[key] ?? NO_MESSAGES)
  const editor = useAiGate((state) => (state.editor && state.editor.pageId === pageId ? state.editor : null))
  const scope = useAiGate((state) => (state.scope && state.scope.pageId === pageId ? state.scope : null))
  const [draft, setDraft] = useState('')
  /** The selection the user took out of scope with the chip's close button. */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const handle = useRef<RunHandle | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const selection = scope && scope.text !== dismissed ? scope.text : null
  const last = messages[messages.length - 1]
  const busy = !!last?.run && isBusy(last.run)

  // Closing the panel gives the keyboard back to where it was (the caret in the page, usually).
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
    return () => {
      window.setTimeout(() => {
        const active = document.activeElement
        if (!previous?.isConnected || (active && active !== document.body)) return
        previous.focus({ preventScroll: true })
        if (range && previous.contains(range.startContainer) && previous.contains(range.endContainer)) {
          const current = window.getSelection()
          current?.removeAllRanges()
          current?.addRange(range)
        }
      }, 0)
    }
  }, [])

  // Another page: whatever was being answered for the previous one stops.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    return () => {
      handle.current?.cancel()
      handle.current = null
    }
  }, [key])

  // Follow the answer as it grows, unless the user scrolled up to read.
  const tail = last?.run?.text.length ?? 0
  const stick = useRef(true)
  useEffect(() => {
    const list = listRef.current
    if (list && stick.current) list.scrollTop = list.scrollHeight
  }, [messages.length, tail])

  const answer = (question: string, history: AiTurn[], selectionText: string | null): void => {
    const id = ++nextMessageId
    setChat(key, (list) => [...list, { id, role: 'assistant', text: '', run: IDLE }])
    const emit = (event: RunEvent): void => {
      setChat(key, (list) =>
        list.map((message) => {
          if (message.id !== id || !message.run) return message
          const run = reduceRun(message.run, event)
          return run === message.run ? message : { ...message, run, text: run.text }
        })
      )
      if (event.type === 'error' && event.code === 'not-installed') openAiSetup('not-installed')
    }
    handle.current = startRun(
      {
        action: 'ask',
        instruction: question,
        ...(pageId ? { pageId } : {}),
        ...(selectionText ? { selectionText: selectionText.slice(0, AI_LIMITS.selection) } : {}),
        ...(history.length ? { history } : {})
      },
      emit
    )
  }

  const send = (raw: string): void => {
    const question = raw.trim().slice(0, AI_LIMITS.instruction)
    if (!question || busy) return
    setDraft('')
    stick.current = true
    void aiReady().then((ready) => {
      if (!ready) {
        setDraft(question)
        return
      }
      const history = historyOf(useChats.getState().chats[key] ?? NO_MESSAGES, Number.MAX_SAFE_INTEGER)
      setChat(key, (list) => [...list, { id: ++nextMessageId, role: 'user', text: question, withSelection: !!selection }])
      answer(question, history, selection)
    })
  }

  /** Asks the question behind an answer again, replacing that answer. */
  const retry = (index: number): void => {
    if (busy) return
    const list = useChats.getState().chats[key] ?? NO_MESSAGES
    const question = list[index - 1]
    if (!question || question.role !== 'user') return
    const history = historyOf(list, index - 1)
    setChat(key, (current) => current.slice(0, index))
    stick.current = true
    answer(question.text, history, question.withSelection ? selection : null)
  }

  const insert = (text: string, mode: 'below' | 'replace'): void => {
    if (!editor?.insert(text, mode)) toast('There was nothing to insert.')
  }

  const copy = (text: string): void => {
    navigator.clipboard.writeText(text).then(
      () => toast('Copied.', { kind: 'success', duration: 1600 }),
      (error: unknown) => notifyError('Could not copy the answer.', error)
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(draft)
    } else if (event.key === 'Escape' && busy) {
      event.preventDefault()
      handle.current?.cancel()
    }
  }

  return (
    <aside className="assistant" aria-label="Assistant">
      <header className="assistant-head">
        <span className="ai-badge" aria-hidden="true">
          {AI_GLYPH}
        </span>
        <h2>Assistant</h2>
        <IconButton
          label="New conversation"
          size="small"
          disabled={messages.length === 0}
          onClick={() => {
            handle.current?.cancel()
            setChat(key, () => NO_MESSAGES)
            inputRef.current?.focus({ preventScroll: true })
          }}
        >
          <Plus />
        </IconButton>
        <IconButton label="Close" shortcut={`${MOD_KEY}J`} size="small" onClick={toggleAssistant}>
          <Close />
        </IconButton>
      </header>

      <div
        className="assistant-list"
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {messages.length === 0 ? (
          <div className="assistant-empty">
            <p className="assistant-empty-title">{pageId ? 'Ask about this page' : 'Ask anything'}</p>
            <p className="assistant-empty-help">
              {pageId ? 'The assistant reads the page in this tab. It changes nothing unless you insert an answer.' : 'Open a page to ask about what is in it.'}
            </p>
            {pageId && (
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" className="assistant-suggestion" onClick={() => send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((message, index) => {
            if (message.role === 'user') {
              return (
                <div key={message.id} className="assistant-message is-user">
                  <div className="assistant-bubble">{message.text}</div>
                </div>
              )
            }
            const run = message.run ?? IDLE
            const working = isBusy(run)
            const error = run.status === 'error' && run.error ? errorLines(run.error) : null
            const hasText = message.text.trim().length > 0
            return (
              <div key={message.id} className={`assistant-message is-assistant${working ? ' is-streaming' : ''}`}>
                {hasText ? <MarkdownView markdown={message.text} /> : working ? <div className="ai-skeleton" aria-hidden="true" /> : null}
                {(working || run.status === 'cancelled') && (
                  <p className="ai-status" role="status" aria-live="polite">
                    {statusText(run)}
                  </p>
                )}
                {error && (
                  <div className="ai-error" role="alert">
                    <p>{error.message}</p>
                    {error.detail && <p className="ai-error-detail">{error.detail}</p>}
                  </div>
                )}
                {run.truncated && <p className="ai-note">The answer was cut off because it got too long.</p>}
                {!working && (
                  <div className="assistant-actions">
                    {hasText && (
                      <>
                        <button type="button" disabled={!editor} title={editor ? undefined : 'Open a page to insert into'} onClick={() => insert(message.text, 'below')}>
                          Insert below
                        </button>
                        <button type="button" disabled={!editor || !selection} title={selection ? undefined : 'Select text in the page first'} onClick={() => insert(message.text, 'replace')}>
                          Replace selection
                        </button>
                        <button type="button" onClick={() => copy(message.text)}>
                          Copy
                        </button>
                      </>
                    )}
                    {index === messages.length - 1 && (
                      <button type="button" onClick={() => retry(index)}>
                        Retry
                      </button>
                    )}
                    {run.error?.code === 'not-logged-in' && (
                      <button type="button" onClick={() => openAiSetup('not-logged-in')}>
                        How to sign in
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <footer className="assistant-foot">
        <div className="assistant-context" aria-label="In scope">
          <span className="assistant-chip" title={page ? pageTitle(page) : undefined}>
            {page ? <PageIcon block={page} size={12} /> : null}
            <span className="assistant-chip-text">{page ? pageTitle(page) : 'No page open'}</span>
          </span>
          {selection && (
            <span className="assistant-chip is-selection" title={selection.slice(0, 300)}>
              <span className="assistant-chip-text">Selection: {selection.replace(/\s+/g, ' ').slice(0, 40)}</span>
              <button type="button" aria-label="Leave the selection out" onClick={() => setDismissed(selection)}>
                <Close size={10} />
              </button>
            </span>
          )}
        </div>
        <div className="assistant-composer">
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            maxLength={AI_LIMITS.instruction}
            placeholder={pageId ? 'Ask about this page…' : 'Ask anything…'}
            aria-label="Message"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {busy ? (
            <Button onClick={() => handle.current?.cancel()}>Stop</Button>
          ) : (
            <Button variant="primary" disabled={!draft.trim()} onClick={() => send(draft)}>
              Send
            </Button>
          )}
        </div>
      </footer>
    </aside>
  )
}
