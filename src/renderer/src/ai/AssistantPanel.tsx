// The assistant: a chat about the page in the active tab, in a panel to the right of it.
// Answers stream in as rich text; each can be put into the page (a click is the user's say-so),
// copied or asked again. Conversations are kept per page for as long as the window lives.
// With Herman on, the same panel is a conversation with him: his figure at the top takes the
// pose of what the request is doing, and the words around the chat are his. He can be told to
// ask his council first (their answers show above his), and what he proposes to build shows as
// a card: nothing is created until Apply is pressed.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX, KeyboardEvent } from 'react'
import { create } from 'zustand'
import { splitActions, type HermanAction } from '@shared/actions'
import { AI_LIMITS, type AiTurn } from '@shared/ai'
import { COUNCIL_KEY, COUNCIL_MEMBERS, COUNCIL_PEOPLE, councilSeats, type CouncilEvent, type CouncilMemberId } from '@shared/council'
import { isTodayRoute, routeTitle } from '@/briefing/route'
import { CouncilFace } from '@/herman/CouncilFace'
import { MEMBER_COLORS } from '@/herman/faces'
import { Figure } from '@/herman/Figure'
import { useHerman } from '@/herman/gate'
import { poseFor } from '@/herman/mood'
import { pageTitle } from '@/shell/actions'
import { PageIcon } from '@/shell/PageIcon'
import { WindowControls } from '@/shell/WindowControls'
import { getBlock, useBlock } from '@/store/blocks'
import { openPage, tabPage, useActiveTab } from '@/store/tabs'
import { Button, IconButton } from '@/ui/Button'
import { Close, Plus } from '@/ui/icons'
import { MOD_KEY } from '@/ui/platform'
import { notifyError, toast } from '@/ui/toast'
import { createdTitles, describeAction, summarizeActions } from './actions'
import { applyActions } from './applyActions'
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
  /** User messages: whether the council was asked. Assistant messages: how each member fared. */
  withCouncil?: boolean
  council?: Seat[]
  /** Assistant messages: what became of the proposal in the answer. */
  proposal?: Outcome
}

interface Seat {
  member: CouncilMemberId
  status: CouncilEvent['status']
  text?: string
}

type Outcome = { state: 'applying' | 'dismissed' } | { state: 'applied'; done: string[]; skipped: string[]; open: string | null }

/** Conversations by page id ('' for no page), and whether the next question goes to the council. */
const useChats = create<{ chats: Record<string, Message[]>; council: boolean }>(() => ({ chats: {}, council: false }))
const NO_MESSAGES: Message[] = []
let nextMessageId = 0

function setChat(key: string, update: (messages: Message[]) => Message[]): void {
  useChats.setState((state) => ({ chats: { ...state.chats, [key]: update(state.chats[key] ?? NO_MESSAGES) } }))
}

const SUGGESTIONS = ['Summarize this page', 'What are the action items?', 'What is missing or unclear?']
/** What one might ask Herman: of a page, and of the day. */
const HERMAN_OPENERS = ['What is this page really about?', 'What am I avoiding here?', 'Make this shorter', 'What should I do first today?']
const HERMAN_DAY_OPENERS = ['What should I do first today?', 'What can wait until tomorrow?', 'What am I avoiding today?']
/** What one might put to the whole council: the work of putting a workspace in order. */
const COUNCIL_OPENERS = [
  'Organize this space',
  'Find what is duplicated, stale or misplaced',
  'Turn these notes into a database',
  'Plan the next week from what is here'
]
const COUNCIL_DAY_OPENERS = ['Plan my day from what is here', 'Sort out what is overdue', 'Organize my workspace']
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

/** The colour a member is drawn and named in, for an element and what is inside it. */
const memberStyle = (member: CouncilMemberId): CSSProperties => ({ '--member-color': `var(--c-${MEMBER_COLORS[member]})` }) as CSSProperties

/** What the council said, each member under a line that opens; what they drafted to build is counted, and Herman's proposal carries it. */
function CouncilView({ seats, working }: { seats: readonly Seat[]; working: boolean }): JSX.Element {
  return (
    <div className="council" aria-label="Council">
      {seats.map((seat) => {
        const { name, role } = COUNCIL_PEOPLE[seat.member]
        const state =
          seat.status === 'thinking' ? (working ? (seat.text ?? 'thinking…') : 'stopped') : seat.status === 'failed' ? 'no answer' : ''
        const said = seat.status === 'done' && seat.text ? splitActions(seat.text) : null
        const drafted = said?.actions.length ?? 0
        return (
          <details key={seat.member} className={`council-seat is-${seat.status}`} style={memberStyle(seat.member)}>
            <summary>
              <CouncilFace member={seat.member} state={seat.status === 'thinking' && !working ? 'idle' : seat.status} />
              <span className="council-name">{name}</span>
              <span className="council-role">{role}</span>
              {drafted > 0 && <span className="council-drafted">{drafted === 1 ? '1 change drafted' : `${drafted} changes drafted`}</span>}
              {state && <span className="council-state">{state}</span>}
            </summary>
            {said ? (
              <MarkdownView markdown={said.text} />
            ) : seat.status === 'failed' && seat.text ? (
              <p className="council-note">{seat.text}</p>
            ) : null}
          </details>
        )
      })}
    </div>
  )
}

/** The seats that are on, as stored; read again whenever the council chip is switched on. */
function useSeated(on: boolean): CouncilMemberId[] {
  const [seated, setSeated] = useState<CouncilMemberId[]>([])
  useEffect(() => {
    if (!on) return
    let alive = true
    window.api.app.getSetting<unknown>(COUNCIL_KEY).then(
      (stored) => {
        const seats = councilSeats(stored)
        if (alive) setSeated(COUNCIL_MEMBERS.filter((member) => seats[member].enabled))
      },
      (error: unknown) => console.error('the council could not be read', error)
    )
    return () => {
      alive = false
    }
  }, [on])
  return on ? seated : []
}

/** A proposal with more steps than this shows a summary, and the steps on request. */
const PROPOSAL_OPEN_STEPS = 6

/** What an answer proposes to build, and the button that builds it. */
function Proposal({
  actions,
  outcome,
  pageId,
  onApply,
  onDismiss
}: {
  actions: readonly HermanAction[]
  outcome: Outcome | undefined
  pageId: string | null
  onApply(): void
  onDismiss(): void
}): JSX.Element | null {
  if (outcome?.state === 'dismissed') return null
  if (outcome?.state === 'applied') {
    const { open } = outcome
    return (
      <div className="ai-proposal is-applied" role="status">
        <ul>
          {outcome.done.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
          {outcome.skipped.map((line, index) => (
            <li key={`s${index}`} className="is-skipped">
              {line}
            </li>
          ))}
        </ul>
        {open && open !== pageId && (
          <div className="ai-proposal-buttons">
            <Button onClick={() => openPage(open)}>Open</Button>
          </div>
        )}
      </div>
    )
  }
  const created = createdTitles(actions)
  const steps = (
    <ul>
      {actions.map((action, index) => (
        <li key={index}>{describeAction(action, { currentPageId: pageId, get: getBlock }, created)}</li>
      ))}
    </ul>
  )
  return (
    <div className="ai-proposal">
      <p className="ai-proposal-title">Proposed</p>
      {actions.length > PROPOSAL_OPEN_STEPS ? (
        <details className="ai-proposal-steps">
          <summary>{summarizeActions(actions)}</summary>
          {steps}
        </details>
      ) : (
        steps
      )}
      <div className="ai-proposal-buttons">
        <Button variant="primary" disabled={outcome?.state === 'applying'} onClick={onApply}>
          Apply
        </Button>
        <Button disabled={outcome?.state === 'applying'} onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}

export function AssistantPanel(): JSX.Element {
  const route = tabPage(useActiveTab())
  /** On the Today screen the conversation is about the day: its agenda and its open tasks. */
  const today = isTodayRoute(route)
  const pageId = routeTitle(route) ? null : route
  const key = route ?? ''
  const herman = useHerman((state) => state.on)
  const mood = useHerman((state) => state.mood)
  const prepared = useHerman((state) => state.prepared)
  const [composing, setComposing] = useState(false)
  const page = useBlock(pageId)
  const messages = useChats((state) => state.chats[key] ?? NO_MESSAGES)
  /** Herman asks his council before he answers. Only he has one. */
  const council = useChats((state) => state.council) && herman
  const seated = useSeated(council)
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
    const previous =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
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

  const answer = (question: string, history: AiTurn[], selectionText: string | null, withCouncil: boolean): void => {
    const id = ++nextMessageId
    setChat(key, (list) => [...list, { id, role: 'assistant', text: '', run: IDLE }])
    const patch = (change: (message: Message) => Message): void =>
      setChat(key, (list) => list.map((message) => (message.id === id ? change(message) : message)))
    const onCouncil = ({ member, status, text }: CouncilEvent): void =>
      patch((message) => {
        // Only the request this answer is waiting for speaks for its council.
        if (!message.run || !isBusy(message.run)) return message
        const seat: Seat = { member, status, ...(text ? { text } : {}) }
        const seats = message.council ?? []
        return {
          ...message,
          council: seats.some((entry) => entry.member === member)
            ? seats.map((entry) => (entry.member === member ? seat : entry))
            : [...seats, seat]
        }
      })
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
        ...(history.length ? { history } : {}),
        ...(withCouncil ? { council: true } : {})
      },
      emit,
      onCouncil
    )
  }

  /** The user pressed Apply: what the answer proposed is built, and the card says what was done. */
  const apply = (id: number, actions: readonly HermanAction[]): void => {
    const set = (proposal: Outcome | undefined): void =>
      setChat(key, (list) => list.map((message) => (message.id === id ? { ...message, proposal } : message)))
    set({ state: 'applying' })
    applyActions(actions, pageId).then(
      (plan) => set({ state: 'applied', done: plan.done, skipped: plan.skipped, open: plan.open }),
      (error: unknown) => {
        set(undefined)
        notifyError('That could not be applied.', error)
      }
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
      setChat(key, (list) => [
        ...list,
        { id: ++nextMessageId, role: 'user', text: question, withSelection: !!selection, withCouncil: council }
      ])
      answer(question, history, selection, council)
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
    answer(question.text, history, question.withSelection ? selection : null, !!question.withCouncil && herman)
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

  const openers = council
    ? today
      ? COUNCIL_DAY_OPENERS
      : COUNCIL_OPENERS
    : herman
      ? today
        ? HERMAN_DAY_OPENERS
        : HERMAN_OPENERS
      : today
        ? DAY_OPENERS
        : SUGGESTIONS
  const emptyTitle = council
    ? 'The council is seated'
    : herman
      ? today
        ? 'Ask about your day'
        : 'What is on your mind?'
      : today
        ? 'Ask about your day'
        : pageId
          ? 'Ask about this page'
          : 'Ask anything'
  // Herman does not explain himself: with him on there is no help line, only the openers.
  const emptyHelp = herman
    ? null
    : today
      ? "The assistant is given today's agenda and open tasks."
      : pageId
        ? 'The assistant reads this page and what is around it. Nothing changes unless you insert an answer or apply what it proposes.'
        : 'Open a page to ask about what is in it.'
  /** How each seated member fares in the answer being written now; at rest they are simply there. */
  const benchState = (member: CouncilMemberId): 'idle' | 'thinking' | 'done' | 'failed' => {
    if (!busy) return 'done'
    return last?.council?.find((seat) => seat.member === member)?.status ?? 'idle'
  }

  return (
    <aside
      className={herman ? 'assistant glass is-herman' : 'assistant glass'}
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
        {/* The panel reaches the top of the window: the window's own buttons sit here while it is open. */}
        <WindowControls />
      </header>
      {herman && (
        <div className={messages.length === 0 ? 'herman-stage is-large' : 'herman-stage'}>
          <Figure pose={poseFor({ mood, attended: composing || draft.trim() !== '' })} draw />
        </div>
      )}
      {seated.length > 0 && (
        <div className="council-bench" aria-label="The council">
          {seated.map((member) => (
            <CouncilFace key={member} member={member} state={benchState(member)} draw label />
          ))}
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
            {emptyHelp && <p className="assistant-empty-help">{emptyHelp}</p>}
            {(pageId || today || council) && (
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
            // What is read and what is proposed are told apart; the proposal shows as a card below.
            const parsed = splitActions(message.text)
            const text = parsed.text
            const hasText = text.trim().length > 0
            return (
              <div key={message.id} className={`assistant-message is-assistant${working ? ' is-streaming' : ''}`}>
                {message.council?.length ? <CouncilView seats={message.council} working={working} /> : null}
                {hasText ? <MarkdownView markdown={text} /> : working ? <div className="ai-skeleton" aria-hidden="true" /> : null}
                {working && parsed.pending && (
                  <p className="ai-status" role="status">
                    Writing down what to build…
                  </p>
                )}
                {!working && run.status === 'done' && parsed.actions.length > 0 && (
                  <Proposal
                    actions={parsed.actions}
                    outcome={message.proposal}
                    pageId={pageId}
                    onApply={() => apply(message.id, parsed.actions)}
                    onDismiss={() =>
                      setChat(key, (list) =>
                        list.map((entry) => (entry.id === message.id ? { ...entry, proposal: { state: 'dismissed' } } : entry))
                      )
                    }
                  />
                )}
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
                        <button
                          type="button"
                          disabled={!editor}
                          title={editor ? undefined : 'Open a page to insert into'}
                          onClick={() => insert(text, 'below')}
                        >
                          Insert below
                        </button>
                        <button
                          type="button"
                          disabled={!editor || !selection}
                          title={selection ? undefined : 'Select text in the page first'}
                          onClick={() => insert(text, 'replace')}
                        >
                          Replace selection
                        </button>
                        <button type="button" onClick={() => copy(text)}>
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
          {herman && (
            <button
              type="button"
              className={council ? 'assistant-chip is-toggle is-on' : 'assistant-chip is-toggle'}
              aria-pressed={council}
              title="Herman asks his council first: they read the workspace and draft changes, and he proposes one plan. Who sits on it is in Settings."
              onClick={() => useChats.setState((state) => ({ council: !state.council }))}
            >
              Council
            </button>
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
