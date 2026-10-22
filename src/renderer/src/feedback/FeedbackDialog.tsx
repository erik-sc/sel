// The feedback dialog: write a bug report or a suggestion, and follow what happened to the ones
// already written. Loaded on demand through Host.tsx.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { FEEDBACK_LIMITS, type FeedbackItem, type FeedbackKind, type FeedbackStatus } from '@shared/feedback'
import { activeTab, tabPage } from '@/store/tabs'
import { isCalendarRoute, isTodayRoute } from '@/briefing/route'
import { Button, IconButton } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import { ArrowUpRight, Close } from '@/ui/icons'
import { notifyError, toast } from '@/ui/toast'
import { closeFeedback, useFeedbackGate } from './gate'
import './feedback.css'

const KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'suggestion', label: 'Suggestion' }
]

/** One feedback window per app window: its title names the dialog. */
const FEEDBACK_TITLE = 'feedback-title'
const LOG_LINES = 'feedback-log-lines'

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: 'Waiting',
  'in-progress': 'In progress',
  'in-review': 'Ready for review',
  done: 'Done',
  declined: 'Declined'
}

const PLACEHOLDER: Record<FeedbackKind, { title: string; description: string }> = {
  bug: {
    title: 'What went wrong?',
    description: 'What did you do, what did you expect, and what happened instead?'
  },
  suggestion: {
    title: 'What would you like sel to do?',
    description: 'What would it be for, and how do you picture it working?'
  }
}

/** Where the user is, in one word: never a page's title or content. */
function currentScreen(): string {
  const pageId = tabPage(activeTab())
  if (isTodayRoute(pageId)) return 'today'
  if (isCalendarRoute(pageId)) return 'calendar'
  return pageId ? 'page' : 'none'
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

type View = 'new' | 'sent'

export function FeedbackDialog(): JSX.Element {
  const open = useFeedbackGate((state) => state.open)
  return (
    <Modal open={open} onClose={closeFeedback} labelledBy={FEEDBACK_TITLE} className="fb-dialog">
      <FeedbackBody />
    </Modal>
  )
}

function FeedbackBody(): JSX.Element {
  const startKind = useFeedbackGate((state) => state.kind)
  const [view, setView] = useState<View>('new')
  const [items, setItems] = useState<FeedbackItem[] | null>(null)

  const refresh = useCallback(() => {
    window.api.feedback.list().then(setItems, (error: unknown) => {
      setItems([])
      notifyError('Your feedback could not be read.', error)
    })
  }, [])

  // Read again every time the dialog opens: the nightly agent changes these files while it is closed.
  useEffect(refresh, [refresh])

  const pending = items?.filter((item) => item.status !== 'done' && item.status !== 'declined').length ?? 0

  return (
    <>
      <header className="fb-head">
        <h2 id={FEEDBACK_TITLE}>Feedback</h2>
        <div className="fb-tabs" role="tablist" aria-label="Feedback">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'new'}
            className={view === 'new' ? 'is-selected' : undefined}
            onClick={() => setView('new')}
          >
            New
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'sent'}
            className={view === 'sent' ? 'is-selected' : undefined}
            onClick={() => setView('sent')}
          >
            Sent{pending > 0 && <span className="fb-count">{pending}</span>}
          </button>
        </div>
        <IconButton label="Close" tooltip={false} onClick={closeFeedback}>
          <Close />
        </IconButton>
      </header>
      {view === 'new' ? (
        <FeedbackForm
          initialKind={startKind}
          onSent={() => {
            refresh()
            setView('sent')
          }}
        />
      ) : (
        <FeedbackList items={items} onChanged={refresh} />
      )}
    </>
  )
}

function FeedbackForm({ initialKind, onSent }: { initialKind: FeedbackKind; onSent: () => void }): JSX.Element {
  const [kind, setKind] = useState<FeedbackKind>(initialKind)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [attachLog, setAttachLog] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [])

  const canSend = title.trim().length > 0 && !busy

  const send = (): void => {
    if (!canSend) return
    setBusy(true)
    window.api.feedback.create({ kind, title, description, screen: currentScreen(), attachLog }).then(
      () => {
        setBusy(false)
        setTitle('')
        setDescription('')
        setAttachLog(false)
        toast(kind === 'bug' ? 'Bug saved. The nightly run will look at it.' : 'Suggestion saved. The nightly run will look at it.')
        onSent()
      },
      (error: unknown) => {
        setBusy(false)
        notifyError('Your feedback could not be saved.', error)
      }
    )
  }

  return (
    <form
      className="fb-body"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
      onKeyDown={(event) => {
        // Ctrl+Enter sends from the description too.
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          send()
        }
      }}
    >
      <div className="fb-kinds" role="radiogroup" aria-label="Kind">
        {KINDS.map((option) => (
          <button
            type="button"
            key={option.value}
            role="radio"
            aria-checked={kind === option.value}
            className={kind === option.value ? 'is-selected' : undefined}
            onClick={() => setKind(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="fb-field">
        <span>Title</span>
        <input
          ref={titleRef}
          className="ui-input"
          value={title}
          maxLength={FEEDBACK_LIMITS.title}
          placeholder={PLACEHOLDER[kind].title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="fb-field">
        <span>Details</span>
        <textarea
          className="fb-textarea"
          value={description}
          maxLength={FEEDBACK_LIMITS.description}
          rows={7}
          placeholder={PLACEHOLDER[kind].description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <LogAttachment attach={attachLog} onChange={setAttachLog} />
      <p className="fb-note">Saved on this computer only. The nightly development run reads it and opens a pull request for review.</p>
      <footer className="fb-foot">
        <Button variant="ghost" onClick={closeFeedback}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!canSend}>
          {busy ? 'Saving…' : kind === 'bug' ? 'Report bug' : 'Send suggestion'}
        </Button>
      </footer>
    </form>
  )
}

/**
 * Whether the report carries the last lines of sel's log (src/main/log.ts): off unless asked,
 * and readable before it is saved. The log holds error messages, never what a page says.
 */
function LogAttachment({ attach, onChange }: { attach: boolean; onChange: (attach: boolean) => void }): JSX.Element {
  const [lines, setLines] = useState<string[] | null>(null)
  const [shown, setShown] = useState(false)

  const toggle = (): void => {
    const next = !shown
    setShown(next)
    if (next) {
      window.api.feedback.logTail().then(setLines, (error: unknown) => {
        setLines([])
        notifyError('The log could not be read.', error)
      })
    }
  }

  return (
    <div className="fb-log">
      <div className="fb-log-row">
        <label className="fb-check">
          <input type="checkbox" checked={attach} onChange={(event) => onChange(event.target.checked)} />
          <span>Attach the last lines of sel's log</span>
        </label>
        <button type="button" className="fb-link" aria-expanded={shown} aria-controls={LOG_LINES} onClick={toggle}>
          {shown ? 'Hide' : 'See what goes'}
        </button>
      </div>
      {shown && (
        // A scrolling box is reached with the keyboard to be read.
        <pre id={LOG_LINES} className="fb-log-lines" tabIndex={0} aria-label="Log lines" aria-busy={lines === null}>
          {lines === null ? '' : lines.length ? lines.join('\n') : 'The log is empty: nothing has gone wrong lately.'}
        </pre>
      )}
    </div>
  )
}

function FeedbackList({ items, onChanged }: { items: FeedbackItem[] | null; onChanged: () => void }): JSX.Element {
  const openFolder = (): void => {
    window.api.feedback.openFolder().catch((error: unknown) => notifyError('The folder could not be opened.', error))
  }

  return (
    <div className="fb-body">
      {items === null ? (
        <div className="fb-list" aria-busy="true" />
      ) : items.length === 0 ? (
        <p className="fb-empty">Nothing sent yet. Bugs and suggestions you write appear here with what became of them.</p>
      ) : (
        <ul className="fb-list">
          {items.map((item) => (
            <FeedbackRow key={item.id} item={item} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <footer className="fb-foot is-split">
        <Button variant="ghost" onClick={openFolder}>
          Open folder
        </Button>
        <Button onClick={closeFeedback}>Close</Button>
      </footer>
    </div>
  )
}

function FeedbackRow({ item, onChanged }: { item: FeedbackItem; onChanged: () => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const pr = item.resolution?.pr ?? null
  const note = item.resolution?.note ?? null

  const withdraw = (): void => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    window.api.feedback.withdraw(item.id).then(onChanged, (error: unknown) => {
      setConfirming(false)
      notifyError('It could not be withdrawn.', error)
      onChanged()
    })
  }

  return (
    <li className="fb-item">
      <div className="fb-item-top">
        <span className={`fb-kind is-${item.kind}`}>{item.kind === 'bug' ? 'Bug' : 'Suggestion'}</span>
        <span className="fb-item-title">{item.title}</span>
        <span className={`fb-status is-${item.status}`}>{STATUS_LABEL[item.status]}</span>
      </div>
      {item.description && <p className="fb-item-text">{item.description}</p>}
      {note && <p className="fb-item-note">{note}</p>}
      <div className="fb-item-foot">
        <span className="fb-item-date">{formatDate(item.createdAt)}</span>
        {pr && (
          <Button
            variant="ghost"
            icon={<ArrowUpRight />}
            onClick={() => window.api.app.openExternal(pr).catch((error: unknown) => notifyError('The link could not be opened.', error))}
          >
            Pull request
          </Button>
        )}
        {item.status === 'open' && (
          <Button variant={confirming ? 'danger' : 'ghost'} onClick={withdraw} onBlur={() => setConfirming(false)}>
            {confirming ? 'Withdraw?' : 'Withdraw'}
          </Button>
        )}
      </div>
    </li>
  )
}
