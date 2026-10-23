// The conversation balloon: a chat about the page in the active tab (or the day, on Today), in a
// balloon that comes out of the persona in the corner it keeps (the bottom-right corner when the
// persona is off). Before anything is typed it offers a few questions for the moment (./suggest.ts);
// answers stream in as rich text and can be put into the page, copied or asked again; what an
// answer proposes to build shows as a card that builds nothing until Apply. Long conversations
// can take a larger sheet. "Earlier" brings back the last conversations, and the log of what the
// AI applied undoes a batch. It never covers the caret of the page: it moves to the other edge,
// or fades, like the persona.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent, RefObject } from 'react'
import { splitActions, type HermanAction } from '@shared/actions'
import { AI_LIMITS } from '@shared/ai'
import { AI_HISTORY_CAPS } from '@shared/aiHistory'
import { isTodayRoute } from '@/briefing/route'
import { caretBox } from '@/herman/avoid'
import { useHerman, usePersona } from '@/herman/gate'
import type { HomeLocale } from '@/home/copy'
import { useHome } from '@/home/store'
import { routeTitle } from '@/screens'
import { pageTitle } from '@/shell/actions'
import { PageIcon } from '@/shell/PageIcon'
import { getBlock, useBlock } from '@/store/blocks'
import { openPage, tabPage, useActiveTab } from '@/store/tabs'
import { Button, IconButton } from '@/ui/Button'
import { ArrowUpRight, ChevronLeft, Clock, Close, Plus, Undo } from '@/ui/icons'
import { MOD_KEY } from '@/ui/platform'
import { notifyError, toast } from '@/ui/toast'
import { createdTitles, describeAction, summarizeActions } from './actions'
import { AppliedLog, UndoControls } from './AppliedLog'
import { loadAppliedLog, recordApplied, useAppliedLog } from './appliedStore'
import { applyActions } from './applyActions'
import { useBalloon, type ReplyNote } from './balloonGate'
import { balloonCopy, whenText, type BalloonCopy } from './balloonCopy'
import { contextCopy } from './contextCopy'
import {
  ask,
  cancel,
  deleteAllConversations,
  deliver,
  isRunning,
  loadConversations,
  reopen,
  retry,
  setOutcome,
  startOver,
  useConversations,
  type AskScope,
  type Conversation,
  type Message,
  type Outcome
} from './conversations'
import { aiReady, closeAssistant, openAiSetup, requestPageAi, useAiGate } from './gate'
import { errorLines, statusText } from './labels'
import { IDLE, isBusy } from './machine'
import { MarkdownView } from './MarkdownView'
import { LockMark } from './PrivateLock'
import { useAiPrivacy } from './privacy'
import { placeBalloon, type Placement } from './placement'
import { SentNote } from './SentNote'
import { AI_GLYPH } from './session'
import { suggestionsFor, type Moment, type Suggestion } from './suggest'
import './ai.css'

/** A proposal with more steps than this shows a summary, and the steps on request. */
const PROPOSAL_OPEN_STEPS = 6
/** The persona's figure height by size (herman.css). */
const FIGURE_PX = { small: 84, medium: 168 } as const
const NO_NOTES: ReplyNote[] = []

/** Whether the last balloon was the larger sheet: the next one opens the same way. */
let wasExpanded = false

type View = 'chat' | 'earlier' | 'applied'

/** What an answer proposes to build, and the button that builds it. */
function Proposal({
  actions,
  outcome,
  pageId,
  copy,
  onApply,
  onDismiss,
  onUndone
}: {
  actions: readonly HermanAction[]
  outcome: Outcome | undefined
  pageId: string | null
  copy: BalloonCopy
  onApply(): void
  onDismiss(): void
  onUndone(): void
}): JSX.Element | null {
  const undone = useAppliedLog((state) =>
    outcome?.state === 'applied' && outcome.logId ? !!state.entries.find((entry) => entry.id === outcome.logId)?.undoneAt : false
  )
  if (outcome?.state === 'dismissed') return null
  if (outcome?.state === 'applied' && !undone) {
    const { open, logId } = outcome
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
        <div className="ai-proposal-buttons">
          {open && open !== pageId && <Button onClick={() => openPage(open)}>{copy.open}</Button>}
          {logId && <UndoControls id={logId} onUndone={onUndone} />}
        </div>
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
      <p className="ai-proposal-title">{copy.proposed}</p>
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
          {copy.apply}
        </Button>
        <Button disabled={outcome?.state === 'applying'} onClick={onDismiss}>
          {copy.dismiss}
        </Button>
      </div>
    </div>
  )
}

/** The small lines other features put under an answer (the persona's memory: "Remembered: …"). */
function Notes({ conversationId, messageId }: { conversationId: string; messageId: number }): JSX.Element | null {
  const notes = useBalloon((state) => state.notes[`${conversationId}:${messageId}`] ?? NO_NOTES)
  if (!notes.length) return null
  return (
    <div className="ai-reply-notes">
      {notes.map((note) => (
        <p key={note.id} className="ai-reply-note">
          <span>{note.text}</span>
          {note.action && (
            <button
              type="button"
              onClick={() => {
                const action = note.action
                if (action) void Promise.resolve(action.run()).catch((error: unknown) => console.error('a note action failed', error))
              }}
            >
              {note.action.label}
            </button>
          )}
        </p>
      ))}
    </div>
  )
}

/** The moment the suggestions are chosen for: read when the balloon opens and when the page changes. */
function useMoment(pageId: string | null, today: boolean, isPrivate: boolean): Moment {
  const page = useBlock(pageId)
  const [overdue, setOverdue] = useState(0)
  const [meeting, setMeeting] = useState(false)
  useEffect(() => {
    let alive = true
    Promise.resolve(window.api.briefing.get())
      .then((briefing) => {
        if (alive) setOverdue(briefing?.tasks?.overdue?.length ?? 0)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  const parentId = page?.parentId ?? null
  useEffect(() => {
    let alive = true
    setMeeting(false)
    if (!pageId || !parentId) return
    Promise.resolve(window.api.meetings.status())
      .then((status) => {
        if (!alive || !status?.databaseId || status.databaseId !== parentId) return
        return Promise.resolve(window.api.meetings.audio.info(pageId)).then((info) => {
          if (alive) setMeeting(info?.state === 'ready')
        })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [pageId, parentId])
  const kind = page?.type === 'page' || page?.type === 'database' ? page.type : null
  return {
    hour: new Date().getHours(),
    page: pageId && page && kind ? { id: pageId, kind, empty: page.content.length === 0, private: isPrivate } : null,
    today,
    overdue,
    meeting
  }
}

/** Gives the keyboard back to where it was (the caret in the page, usually) when the balloon goes. */
function useFocusReturn(): void {
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
}

/** Where the balloon goes, worked out again when the area, the caret or its own height change. */
function usePlacement(ref: RefObject<HTMLElement | null>, expanded: boolean): Placement | null {
  const anchor = useBalloon((state) => state.anchor)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const last = useRef('')
  useLayoutEffect(() => {
    const balloon = ref.current
    const area = balloon?.parentElement
    if (!balloon || !area) return
    let pending: ReturnType<typeof setTimeout> | undefined
    const survey = (): void => {
      pending = undefined
      const rect = area.getBoundingClientRect()
      const caret = caretBox(area)
      const next = placeBalloon({
        area: { width: rect.width, height: rect.height },
        corner: anchor?.corner ?? 'bottom-right',
        figure: anchor ? FIGURE_PX[anchor.size] : null,
        expanded,
        height: balloon.offsetHeight,
        caret: caret
          ? { left: caret.left - rect.left, right: caret.right - rect.left, top: caret.top - rect.top, bottom: caret.bottom - rect.top }
          : null
      })
      const key = JSON.stringify(next)
      if (key === last.current) return
      last.current = key
      setPlacement(next)
    }
    const soon = (): void => {
      pending ??= setTimeout(survey, 90)
    }
    survey()
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon)
    resized?.observe(balloon)
    resized?.observe(area)
    document.addEventListener('selectionchange', soon)
    area.addEventListener('scroll', soon, true)
    window.addEventListener('resize', soon)
    return () => {
      clearTimeout(pending)
      resized?.disconnect()
      document.removeEventListener('selectionchange', soon)
      area.removeEventListener('scroll', soon, true)
      window.removeEventListener('resize', soon)
    }
  }, [ref, anchor, expanded])
  return placement
}

const FOCUSABLE = 'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])'

export function Balloon(): JSX.Element {
  const route = tabPage(useActiveTab())
  /** On the Today screen the conversation is about the day: its agenda and its open tasks. */
  const today = isTodayRoute(route)
  const pageId = routeTitle(route) ? null : route
  const key = route ?? ''
  const locale = useHome((state) => state.locale)
  const { persona: chosen, name: personaName } = usePersona()
  const copy = balloonCopy(locale, chosen)
  const persona = useHerman((state) => state.on)
  const prepared = useHerman((state) => state.prepared)
  const name = persona ? personaName : copy.assistant
  const page = useBlock(pageId)
  // A page private from the AI: nothing of it is sent (not even the selection); a question goes without it.
  const privacy = useAiPrivacy(pageId, true)
  const isPrivate = privacy !== null
  const words = contextCopy(locale, chosen)
  const conversation = useConversations((state) => {
    const id = state.active[key]
    return id ? state.list.find((entry) => entry.id === id) : undefined
  })
  const messages = conversation?.messages ?? []
  const editor = useAiGate((state) => (state.editor && state.editor.pageId === pageId ? state.editor : null))
  const scope = useAiGate((state) => (state.scope && state.scope.pageId === pageId ? state.scope : null))
  const pending = useBalloon((state) => state.pending)
  const [draft, setDraft] = useState('')
  const [view, setView] = useState<View>('chat')
  const [expanded, setExpanded] = useState(wasExpanded)
  /** The selection the user took out of scope with the chip's close button. */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const selection = !isPrivate && scope && scope.text !== dismissed ? scope.text : null
  const busy = isRunning(conversation)
  const moment = useMoment(pageId, today, isPrivate)
  const placement = usePlacement(ref, expanded)
  const anchor = useBalloon((state) => state.anchor)

  useFocusReturn()

  useEffect(() => {
    void loadConversations()
    // A proposal applied and then undone (here or in Settings) shows as a proposal again.
    void loadAppliedLog()
  }, [])

  useEffect(() => {
    wasExpanded = expanded
  }, [expanded])

  // Once placed (it is hidden while it is measured, and a hidden field takes no focus), on another
  // page, or back to the conversation: the field takes the keyboard.
  const placed = placement !== null
  useEffect(() => {
    if (placed && view === 'chat') inputRef.current?.focus({ preventScroll: true })
  }, [placed, key, view])

  // An answer that arrived on its own (a routine's) and that the user chose to see.
  useEffect(() => {
    if (!pending) return
    useBalloon.setState({ pending: null })
    deliver(key, pending)
    setView('chat')
  }, [pending, key])

  // A question the persona wrote for the user (from one of its nudges): it waits in the field, unsent.
  useEffect(() => {
    if (prepared === null) return
    setDraft(prepared)
    useHerman.setState({ prepared: null })
    setView('chat')
    inputRef.current?.focus({ preventScroll: true })
  }, [prepared])

  // Follow the answer as it grows, unless the user scrolled up to read.
  const last = messages[messages.length - 1]
  const tail = last?.run?.text.length ?? 0
  const stick = useRef(true)
  useEffect(() => {
    const list = listRef.current
    if (list && stick.current) list.scrollTop = list.scrollHeight
  }, [messages.length, tail, view])

  const currentScope: AskScope = pageId && !isPrivate ? { pageId } : today ? { today: true } : {}

  const send = (raw: string, scopeOverride?: AskScope): void => {
    const question = raw.trim().slice(0, AI_LIMITS.instruction)
    if (!question || busy) return
    setDraft('')
    stick.current = true
    void aiReady().then((ready) => {
      if (!ready) {
        setDraft(question)
        return
      }
      const asked = scopeOverride ?? currentScope
      ask(key, question, asked, asked.pageId ? selection : null)
    })
  }

  const suggest = (suggestion: Suggestion): void => {
    if (suggestion.run === 'consolidate' && pageId) {
      // The meeting's notes have their own action, which reads the transcript and writes into the page with a preview.
      requestPageAi(pageId, 'consolidate')
      closeAssistant()
      return
    }
    send(suggestion.prompt, suggestion.scope === 'today' ? { today: true } : currentScope)
  }

  /** The user pressed Apply: what the answer proposed is built, logged, and the card says what was done. */
  const apply = (target: Conversation, index: number, actions: readonly HermanAction[]): void => {
    const message = target.messages[index]
    const question = target.messages[index - 1]
    setOutcome(target.id, message.id, { state: 'applying' })
    applyActions(actions, pageId).then(
      (applied) => {
        const logId = recordApplied(applied, {
          request: question?.role === 'user' ? question.text : target.title,
          conversationId: target.id
        })
        setOutcome(target.id, message.id, {
          state: 'applied',
          done: applied.done,
          skipped: applied.skipped,
          open: applied.open,
          ...(logId ? { logId } : {})
        })
      },
      (error: unknown) => {
        setOutcome(target.id, message.id, undefined)
        notifyError(copy.applyFailed, error)
      }
    )
  }

  const insert = (text: string, mode: 'below' | 'replace'): void => {
    if (!editor?.insert(text, mode)) toast(copy.nothingToInsert)
  }

  const copyText = (text: string): void => {
    navigator.clipboard.writeText(text).then(
      () => toast(copy.copied, { kind: 'success', duration: 1600 }),
      (error: unknown) => notifyError(copy.copyFailed, error)
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return
    if (event.key === 'Escape') {
      // Esc stops an answer first, then leaves a list for the conversation, then closes.
      event.preventDefault()
      event.stopPropagation()
      if (busy && view === 'chat') cancel(conversation?.id)
      else if (view !== 'chat') setView('chat')
      else closeAssistant()
      return
    }
    if (event.key === 'Tab') {
      // The keyboard stays in the balloon while it is open.
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((item) => !item.closest('[hidden]'))
      if (!items.length) return
      const first = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  const onFieldKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(draft)
    }
  }

  const suggestions = view === 'chat' && messages.length === 0 && !busy ? suggestionsFor(moment, locale) : []
  const emptyTitle = persona
    ? copy.emptyTitle.persona
    : today
      ? copy.emptyTitle.today
      : pageId && !isPrivate
        ? copy.emptyTitle.page
        : copy.emptyTitle.none
  // The persona does not explain itself: with it on there is no help line, only the suggestions. A private page is said either way.
  const emptyHelp = isPrivate
    ? words.panelPrivate
    : persona
      ? null
      : today
        ? copy.emptyHelp.today
        : pageId
          ? copy.emptyHelp.page
          : copy.emptyHelp.none
  const placeholder = persona
    ? copy.placeholder.persona
    : today
      ? copy.placeholder.today
      : pageId && !isPrivate
        ? copy.placeholder.page
        : copy.placeholder.none

  const corner = anchor?.corner ?? 'bottom-right'
  const classes = ['ai-balloon', `is-${corner.split('-')[1]}`]
  if (placement) classes.push(`is-${placement.edge}`, `is-${placement.attach}`)
  if (anchor) classes.push(`is-figure-${anchor.size}`)
  if (placement?.aside) classes.push('is-aside')
  if (expanded) classes.push('is-expanded')
  if (!placement) classes.push('is-measuring')

  return (
    <section
      ref={ref}
      className={classes.join(' ')}
      style={placement?.style}
      role="dialog"
      aria-labelledby={titleId}
      data-view={view}
      onKeyDown={onKeyDown}
    >
      <header className="ai-balloon-head">
        {view !== 'chat' ? (
          <IconButton label={copy.back} size="small" onClick={() => setView('chat')}>
            <ChevronLeft />
          </IconButton>
        ) : (
          !persona && (
            <span className="ai-badge" aria-hidden="true">
              {AI_GLYPH}
            </span>
          )
        )}
        <h2 id={titleId}>{view === 'earlier' ? copy.earlier : view === 'applied' ? copy.applied : name}</h2>
        {view === 'chat' && (
          <>
            <IconButton label={copy.earlier} size="small" onClick={() => setView('earlier')}>
              <Clock />
            </IconButton>
            <IconButton label={copy.applied} size="small" onClick={() => setView('applied')}>
              <Undo />
            </IconButton>
            <IconButton
              label={copy.newConversation}
              size="small"
              disabled={messages.length === 0}
              onClick={() => {
                startOver(key)
                inputRef.current?.focus({ preventScroll: true })
              }}
            >
              <Plus />
            </IconButton>
          </>
        )}
        <IconButton
          label={expanded ? copy.shrink : copy.expand}
          size="small"
          aria-pressed={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ArrowUpRight />
        </IconButton>
        <IconButton label={copy.close} shortcut={`${MOD_KEY}J`} size="small" onClick={closeAssistant}>
          <Close />
        </IconButton>
      </header>

      {view === 'earlier' ? (
        <Earlier
          copy={copy}
          locale={locale}
          onOpen={(id) => {
            reopen(key, id)
            setView('chat')
          }}
        />
      ) : view === 'applied' ? (
        <div className="ai-balloon-body">
          <p className="ai-balloon-note">{copy.logNote}</p>
          <AppliedLog />
        </div>
      ) : (
        <>
          <div
            className="ai-balloon-body"
            ref={listRef}
            // Scrollable: it can be reached and scrolled with the keyboard.
            tabIndex={0}
            role="region"
            aria-label={copy.dialogLabel(name)}
            onScroll={(event) => {
              const el = event.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
          >
            {messages.length === 0 ? (
              <div className="ai-balloon-empty">
                <p className="ai-balloon-empty-title">{emptyTitle}</p>
                {emptyHelp && <p className="ai-balloon-empty-help">{emptyHelp}</p>}
                {suggestions.length > 0 && (
                  <div className="ai-suggestions" role="group" aria-label={copy.suggestions}>
                    {suggestions.map((suggestion) => (
                      <button key={suggestion.id} type="button" className="ai-suggestion" onClick={() => suggest(suggestion)}>
                        {suggestion.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              conversation &&
              messages.map((message, index) => (
                <MessageView
                  key={message.id}
                  conversation={conversation}
                  message={message}
                  index={index}
                  isLast={index === messages.length - 1}
                  name={name}
                  copy={copy}
                  pageId={pageId}
                  canInsert={!!editor}
                  hasSelection={!!selection}
                  onApply={(actions) => apply(conversation, index, actions)}
                  onInsert={insert}
                  onCopy={copyText}
                  onRetry={() => {
                    stick.current = true
                    retry(conversation.id, index, selection)
                  }}
                />
              ))
            )}
          </div>

          <footer className="ai-balloon-foot">
            <div className="ai-balloon-context" aria-label={copy.inScope}>
              {privacy ? (
                <span className="ai-chip" title={words.privateWhy[privacy.reason]}>
                  <LockMark why={words.privateWhy[privacy.reason]} />
                  <span className="ai-chip-text">{words.panelPrivateChip}</span>
                </span>
              ) : (
                <span className="ai-chip" title={page ? pageTitle(page) : undefined}>
                  {page ? <PageIcon block={page} size={12} /> : null}
                  <span className="ai-chip-text">{page ? pageTitle(page) : today ? copy.todayChip : copy.noPage}</span>
                </span>
              )}
              {selection && (
                <span className="ai-chip is-selection" title={selection.slice(0, 300)}>
                  <span className="ai-chip-text">
                    {copy.selection}: {selection.replace(/\s+/g, ' ').slice(0, 40)}
                  </span>
                  <button type="button" aria-label={copy.leaveSelectionOut} onClick={() => setDismissed(selection)}>
                    <Close size={10} />
                  </button>
                </span>
              )}
            </div>
            <div className="ai-balloon-composer">
              <textarea
                ref={inputRef}
                rows={2}
                value={draft}
                maxLength={AI_LIMITS.instruction}
                placeholder={placeholder}
                aria-label={copy.message}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onFieldKeyDown}
              />
              {busy ? (
                <Button onClick={() => cancel(conversation?.id)}>{copy.stop}</Button>
              ) : (
                <Button variant="primary" disabled={!draft.trim()} onClick={() => send(draft)}>
                  {copy.send}
                </Button>
              )}
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

function MessageView({
  conversation,
  message,
  index,
  isLast,
  name,
  copy,
  pageId,
  canInsert,
  hasSelection,
  onApply,
  onInsert,
  onCopy,
  onRetry
}: {
  conversation: Conversation
  message: Message
  index: number
  isLast: boolean
  name: string
  copy: BalloonCopy
  pageId: string | null
  canInsert: boolean
  hasSelection: boolean
  onApply(actions: readonly HermanAction[]): void
  onInsert(text: string, mode: 'below' | 'replace'): void
  onCopy(text: string): void
  onRetry(): void
}): JSX.Element {
  if (message.role === 'user') {
    return (
      <div className="ai-message is-user">
        <div className="ai-message-bubble">{message.text}</div>
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
    <div className={`ai-message is-assistant${working ? ' is-streaming' : ''}`}>
      {hasText ? <MarkdownView markdown={text} /> : working ? <div className="ai-skeleton" aria-hidden="true" /> : null}
      {working && parsed.pending && (
        <p className="ai-status" role="status">
          {copy.writingActions}
        </p>
      )}
      {!working && run.status === 'done' && parsed.actions.length > 0 && (
        <Proposal
          actions={parsed.actions}
          outcome={message.proposal}
          pageId={pageId}
          copy={copy}
          onApply={() => onApply(parsed.actions)}
          onDismiss={() => setOutcome(conversation.id, message.id, { state: 'dismissed' })}
          onUndone={() => setOutcome(conversation.id, message.id, undefined)}
        />
      )}
      {!working && run.status === 'done' && parsed.rejected > 0 && (
        <p className="ai-status" role="status">
          {copy.unreadable(name, parsed.rejected)}
        </p>
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
      {run.truncated && <p className="ai-note">{copy.truncated}</p>}
      {run.status === 'done' && <SentNote sent={run.sent} />}
      <Notes conversationId={conversation.id} messageId={message.id} />
      {!working && (
        <div className="ai-message-actions">
          {hasText && (
            <>
              <button
                type="button"
                disabled={!canInsert}
                title={canInsert ? undefined : copy.openPageToInsert}
                onClick={() => onInsert(text, 'below')}
              >
                {copy.insertBelow}
              </button>
              <button
                type="button"
                disabled={!canInsert || !hasSelection}
                title={hasSelection ? undefined : copy.selectFirst}
                onClick={() => onInsert(text, 'replace')}
              >
                {copy.replaceSelection}
              </button>
              <button type="button" onClick={() => onCopy(text)}>
                {copy.copy}
              </button>
            </>
          )}
          {isLast && index > 0 && (
            <button type="button" onClick={onRetry}>
              {copy.retry}
            </button>
          )}
          {run.error?.code === 'not-logged-in' && (
            <button type="button" onClick={() => openAiSetup('not-logged-in')}>
              {copy.howToSignIn}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** "Earlier": the last conversations, newest first; one brings it back. */
function Earlier({ copy, locale, onOpen }: { copy: BalloonCopy; locale: HomeLocale; onOpen(id: string): void }): JSX.Element {
  const list = useConversations((state) => state.list)
  const loaded = useConversations((state) => state.loaded)
  const [confirming, setConfirming] = useState(false)
  const shown = [...list].filter((conversation) => conversation.messages.length > 0).sort((a, b) => b.updatedAt - a.updatedAt)
  const now = Date.now()
  return (
    <div className="ai-balloon-body">
      {!loaded ? null : shown.length === 0 ? (
        <p className="ai-balloon-note">{copy.earlierEmpty}</p>
      ) : (
        <>
          <ul className="ai-earlier">
            {shown.map((conversation) => (
              <li key={conversation.id}>
                <button type="button" className="ai-earlier-item" onClick={() => onOpen(conversation.id)}>
                  <span className="ai-earlier-title">{conversation.title || '…'}</span>
                  <span className="ai-earlier-when">{whenText(conversation.updatedAt, now, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="ai-earlier-foot">
            <p className="ai-balloon-note">{copy.earlierNote(AI_HISTORY_CAPS.conversations)}</p>
            {confirming ? (
              <div className="ai-earlier-confirm" role="group" aria-label={copy.confirmDeleteAll(shown.length)}>
                <span>{copy.confirmDeleteAll(shown.length)}</span>
                <Button
                  variant="danger"
                  onClick={() => {
                    setConfirming(false)
                    deleteAllConversations().then(
                      () => toast(copy.deleted, { kind: 'success', duration: 1600 }),
                      (error: unknown) => notifyError(copy.deleteAll, error)
                    )
                  }}
                >
                  {copy.deleteAll}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  {copy.cancel}
                </Button>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                {copy.deleteAll}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
