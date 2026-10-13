// The assistant: a chat about the page in the active tab, in a panel to the right of it.
// Answers stream in as rich text; each can be put into the page (a click is the user's say-so),
// copied or asked again. Conversations are kept per page for as long as the window lives.
// With Herman on, the same panel is a conversation with him: his figure at the top takes the
// pose of what the request is doing, and the words around the chat are his. Nothing else changes.
import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { create } from 'zustand'
import { AI_LIMITS, type AiTurn } from '@shared/ai'
import { isTodayRoute } from '@/briefing/route'
import { Figure } from '@/herman/Figure'
import { useHerman } from '@/herman/gate'
import { poseFor } from '@/herman/mood'
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
/** What one might ask Herman: of a page, and of the day. */
const HERMAN_OPENERS = ['What is this page really about?', 'What am I avoiding here?', 'Make this shorter', 'What should I do first today?']
const HERMAN_DAY_OPENERS = ['What should I do first today?', 'What can wait until tomorrow?', 'What am I avoiding today?']
const DAY_OPENERS = ['What should I do first today?', 'What is overdue?', 'What does the afternoon look like?']

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
  const route = tabPage(useActiveTab())
  /** On the Today screen the conversation is about the day: its agenda and its open tasks. */
  const today = isTodayRoute(route)
  const pageId = today ? null : route
  const key = route ?? ''
  const herman = useHerman((state) => state.on)
  const mood = useHerman((state) => state.mood)
  const prepared = useHerman((state) => state.prepared)
  const [composing, setComposing] = useState(false)
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

  // A question Herman wrote for the user (from one of his nudges): it waits in the field, unsent.
  useEffect(() => {
    if (prepared === null) return
    setDraft(prepared)
    useHerman.setState({ prepared: null })
    inputRef.current?.focus({ preventScroll: true })
  }, [prepared])

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
        ...(pageId ? { pageId } : today ? { today: true } : {}),
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

  const openers = herman ? (today ? HERMAN_DAY_OPENERS : HERMAN_OPENERS) : today ? DAY_OPENERS : SUGGESTIONS
  const emptyTitle = herman ? (today ? 'Ask about your day' : 'What is on your mind?') : today ? 'Ask about your day' : pageId ? 'Ask about this page' : 'Ask anything'
  const emptyHelp = today
    ? `${herman ? 'Herman' : 'The assistant'} is given today's agenda and open tasks.`
    : pageId
      ? herman
        ? 'Herman reads the page in this tab. He changes nothing unless you insert an answer.'
        : 'The assistant reads the page in this tab. It changes nothing unless you insert an answer.'
      : 'Open a page to ask about what is in it.'

  return (
    <aside
      className={herman ? 'assistant is-herman' : 'assistant'}
      aria-label={herman ? 'Conversation with Herman' : 'Assistant'}
      onKeyDown={(event) => {
        // Escape puts Herman back in his corner (unless it just stopped an answer).
        if (herman && event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
          event.preventDefault()
          toggleAssistant()
        }
      }}
    >
      <header className="assistant-head">
        {!herman && (
          <span className="ai-badge" aria-hidden="true">
            {AI_GLYPH}
          </span>
        )}
        <h2>{herman ? 'Herman' : 'Assistant'}</h2>
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
      {herman && (
        <div className={messages.length === 0 ? 'herman-stage is-large' : 'herman-stage'}>
          <Figure pose={poseFor({ mood, attended: composing || draft.trim() !== '' })} draw />
        </div>
      )}

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
            <p className="assistant-empty-title">{emptyTitle}</p>
            <p className="assistant-empty-help">{emptyHelp}</p>
            {(pageId || today) && (
              <div className="assistant-suggestions">
                {openers.map((suggestion) => (
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
            <span className="assistant-chip-text">{page ? pageTitle(page) : today ? 'Today: agenda and open tasks' : 'No page open'}</span>
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
            placeholder={herman ? 'Ask Herman…' : today ? 'Ask about your day…' : pageId ? 'Ask about this page…' : 'Ask anything…'}
            aria-label="Message"
            onFocus={() => setComposing(true)}
            onBlur={() => setComposing(false)}
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
