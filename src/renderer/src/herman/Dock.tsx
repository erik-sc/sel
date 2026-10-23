// Herman's corner: the small figure docked at the edge of the page area, and the bubble he
// speaks in. He keeps out of the way (steps aside from the caret and from menus, leaves while a
// dialog is open), can be dragged to any corner, and opens the conversation when clicked.
// What he says unasked is composed by the main process; this file only asks, at quiet moments,
// whether there is something, and shows it.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { HermanCommand, HermanCorner, HermanFeedback, HermanNudge, HermanState } from '@shared/herman'
import { toggleAssistant, useAiGate } from '@/ai/gate'
import { announcementActions, putAway, useAlarms, type AnnouncementAction } from '@/alarms/gate'
import { openToday } from '@/briefing/route'
import { newMeeting } from '@/meetings/gate'
import { openCloseDay } from '@/notebook/route'
import { startRefine } from '@/tasks/gate'
import { getBlock } from '@/store/blocks'
import { activeTab, isBlockId, openPage, tabPage, useTabs } from '@/store/tabs'
import { setSettingsOpen, useUi } from '@/store/ui'
import { useToasts } from '@/ui/toast'
import { Herman64 } from './Herman64'
import { useHerman, usePersona } from './gate'
import { cornerAfterKey, editingSince, near, nearestCorner, poseFor, type Box } from './mood'

/** How long a line of his stays before it leaves by itself. */
const BUBBLE_MS = 20_000
const GREETING_MS = 45_000
/** A briefing or a reminder the user asked for stays longer: it is read aloud first. */
const ANNOUNCE_MS = 120_000
/** He does not ask the main process while a key was pressed this recently. */
const SETTLE_MS = 3000
/** The first question after start-up waits for the window to come to rest. */
const FIRST_ASK_MS = 20_000
const DRAG_START_PX = 6
/** How close the caret or a menu may come before he steps aside, and how far it must go before he returns. */
const NEAR_PX = 28
const CLEAR_PX = 52

interface Bubble {
  /** Set for a nudge: how the main process knows it. */
  id?: string
  text: string
  action?: HermanNudge['action']
  greeting?: boolean
  /** Said while AI is turned off: the line offers the settings. */
  settings?: boolean
  /** Set for a briefing, a reminder or an event (shared/alarms.ts): its id, and what can be done about it. */
  announcement?: string
  choices?: AnnouncementAction[]
}

function editable(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
}

/** Where the caret is on screen, when it is in the page (not in a panel, a dialog or a field of the shell). */
function caretBox(area: HTMLElement): Box | null {
  const active = document.activeElement
  if (!editable(active) || !area.contains(active)) return null
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  let rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    // An empty line has no box of its own: the block it is in stands for it.
    const node = selection.focusNode
    const element = node instanceof Element ? node : node?.parentElement
    if (!element) return null
    rect = element.getBoundingClientRect()
  }
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

const FLOATING = '.ui-popover, .pe-toolbar, .ui-toast'
const MODAL = '.ui-modal-overlay'

export function Dock(): JSX.Element | null {
  const version = useHerman((state) => state.version)
  const mood = useHerman((state) => state.mood)
  const { name } = usePersona()
  const aiOn = useAiGate((state) => state.enabled)
  const panelOpen = useAiGate((state) => state.enabled && state.panelOpen)
  const toasts = useToasts((state) => state.toasts.length)
  const [state, setState] = useState<HermanState | null>(null)
  const [corner, setCorner] = useState<HermanCorner>('bottom-right')
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [attended, setAttended] = useState(false)
  const [aside, setAside] = useState(false)
  const [away, setAway] = useState(false)
  const [front, setFront] = useState(() => document.hasFocus())
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<Bubble | null>(null)
  bubbleRef.current = bubble
  const asideRef = useRef(false)
  asideRef.current = aside

  // ---- his settings, as the main process reads them ----

  const load = useCallback((): void => {
    window.api.herman.state().then(
      (next) => {
        setState(next)
        setCorner(next.corner)
      },
      (error: unknown) => console.error('herman could not be loaded', error)
    )
  }, [])

  useEffect(load, [load, version])

  useEffect(() => {
    const onFocus = (): void => {
      setFront(true)
      // The quiet hours may have begun or ended while the window was away.
      load()
    }
    const onBlur = (): void => setFront(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [load])

  // ---- what he says ----

  const dismiss = useCallback((feedback?: HermanFeedback): void => {
    const current = bubbleRef.current
    if (!current) return
    setBubble(null)
    if (current.id) void window.api.herman.nudge.dismiss(current.id, feedback).catch(() => undefined)
    if (current.announcement) putAway(current.announcement)
  }, [])

  // A briefing at one of its times, a task's reminder, an event about to start: said at once, over
  // anything else he was saying, with what can be done about it (open, snooze, record).
  const announcement = useAlarms((alarms) => alarms.current)
  useEffect(() => {
    if (!announcement) return
    if (bubbleRef.current?.announcement === announcement.id) return
    if (bubbleRef.current) dismiss()
    setBubble({ text: announcement.text, announcement: announcement.id, choices: announcementActions(announcement) })
  }, [announcement, dismiss])

  // The first meeting: once he has drawn himself, a hello and his name. Said once.
  const greeting = state?.greeting ?? null
  useEffect(() => {
    if (!greeting) return
    const timer = setTimeout(() => {
      setBubble({ text: greeting, greeting: true })
      void window.api.herman.met().catch(() => undefined)
      setState((current) => (current ? { ...current, greeting: null } : current))
    }, 3800)
    return () => clearTimeout(timer)
  }, [greeting])

  // A line leaves by itself after a while, unless the pointer or the focus is on it.
  const bubbleKey = bubble ? (bubble.id ?? bubble.text) : null
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!bubbleKey || held) return
    const timer = setTimeout(
      () => dismiss(),
      bubbleRef.current?.greeting ? GREETING_MS : bubbleRef.current?.announcement ? ANNOUNCE_MS : BUBBLE_MS
    )
    return () => clearTimeout(timer)
  }, [bubbleKey, held, dismiss])

  // He speaks for a moment when a line appears, then listens while it is up.
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    if (!bubbleKey) return
    setFresh(true)
    const timer = setTimeout(() => setFresh(false), 2800)
    return () => {
      clearTimeout(timer)
      setFresh(false)
    }
  }, [bubbleKey])

  // ---- nudges: asking the main process, at quiet moments, whether he has something to say ----

  const nudges = !!state?.enabled && state.nudges && !state.greeting
  const quiet = useRef({ away: false, panelOpen: false })
  quiet.current = { away, panelOpen }
  useEffect(() => {
    if (!nudges) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastKey = performance.now()
    let editing: { since: number; last: number } | null = null
    let pageId = tabPage(activeTab())
    /** Days the page in front had gone untouched when it was opened; told to the main process once. */
    let untouched: number | undefined
    let stopped = false

    const notePage = (): void => {
      const next = tabPage(activeTab())
      if (next === pageId) return
      pageId = next
      editing = null
      const block = next && isBlockId(next) ? getBlock(next) : undefined
      untouched = block ? Math.max(0, Math.floor((Date.now() - block.updatedAt) / 86_400_000)) : undefined
    }
    const offTabs = useTabs.subscribe(notePage)

    const onKey = (event: KeyboardEvent): void => {
      lastKey = performance.now()
      if (editable(event.target) && dockRef.current?.parentElement?.contains(event.target)) {
        editing = editingSince(editing, lastKey)
        // Once it is being written in, the page is no longer one that was just reopened.
        untouched = undefined
      }
    }
    window.addEventListener('keydown', onKey, true)

    const arm = (delay: number): void => {
      clearTimeout(timer)
      if (!stopped) timer = setTimeout(ask, Math.max(1000, Math.min(delay, 6 * 3_600_000)))
    }
    const ask = (): void => {
      const now = performance.now()
      const idleMs = now - lastKey
      if (idleMs < SETTLE_MS) return arm(SETTLE_MS - idleMs)
      // Not while a line of his is up, and not while nobody is looking.
      if (bubbleRef.current || document.visibilityState !== 'visible') return arm(60_000)
      const busy = quiet.current.away || quiet.current.panelOpen || !document.hasFocus()
      const page = pageId && isBlockId(pageId) ? pageId : undefined
      window.api.herman.nudge
        .next({
          idleMs: Math.round(idleMs),
          busy,
          ...(page ? { pageId: page } : {}),
          ...(page && editing && now - editing.last < 5 * 60_000 ? { editingMs: Math.round(editing.last - editing.since) } : {}),
          ...(page && untouched !== undefined ? { untouchedDays: untouched } : {})
        })
        .then(
          (reply) => {
            if (stopped) return
            if (reply.nudge) {
              if (reply.nudge.kind === 'reopened') untouched = undefined
              if (reply.nudge.kind === 'long-session') editing = null
              setBubble(reply.nudge)
            }
            arm(reply.waitMs)
          },
          (error: unknown) => {
            console.error('herman could not be asked', error)
            arm(10 * 60_000)
          }
        )
    }
    arm(FIRST_ASK_MS)
    // Coming back to the window is a quiet moment worth one question.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') arm(SETTLE_MS)
    }
    document.addEventListener('visibilitychange', onVisible)
    // Something he says without being asked just now (a streak of finished tasks).
    const offNudge = window.api.herman.onNudge((nudge) => {
      if (!bubbleRef.current && !quiet.current.away && !quiet.current.panelOpen) setBubble(nudge)
    })
    return () => {
      stopped = true
      clearTimeout(timer)
      offTabs()
      offNudge()
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [nudges])

  // ---- keeping out of the way ----

  useEffect(() => {
    const dock = dockRef.current
    const area = dock?.parentElement
    if (!dock || !area) return
    let pending: ReturnType<typeof setTimeout> | undefined
    const survey = (): void => {
      pending = undefined
      setAway(document.fullscreenElement !== null || document.querySelector(MODAL) !== null)
      const rect = dock.getBoundingClientRect()
      // His place at rest: where he is now, less the step he may have taken.
      const matrix = new DOMMatrixReadOnly(getComputedStyle(dock).transform)
      const home: Box = {
        left: rect.left - matrix.m41,
        top: rect.top - matrix.m42,
        right: rect.right - matrix.m41,
        bottom: rect.bottom - matrix.m42
      }
      const margin = asideRef.current ? CLEAR_PX : NEAR_PX
      const caret = caretBox(area)
      let close = caret !== null && near(home, caret, margin)
      if (!close) {
        for (const element of document.querySelectorAll(FLOATING)) {
          const box = element.getBoundingClientRect()
          if (near(home, box, margin / 2)) {
            close = true
            break
          }
        }
      }
      setAside(close)
    }
    const soon = (): void => {
      pending ??= setTimeout(survey, 90)
    }
    const observer = new MutationObserver(soon)
    observer.observe(document.body, { childList: true })
    document.addEventListener('selectionchange', soon)
    document.addEventListener('fullscreenchange', soon)
    area.addEventListener('scroll', soon, true)
    window.addEventListener('resize', soon)
    soon()
    return () => {
      clearTimeout(pending)
      observer.disconnect()
      document.removeEventListener('selectionchange', soon)
      document.removeEventListener('fullscreenchange', soon)
      area.removeEventListener('scroll', soon, true)
      window.removeEventListener('resize', soon)
    }
    // Toasts and his own bubble change what is near him: look again when they do.
  }, [toasts, bubbleKey, corner, state?.size])

  // While he draws himself in he is fully there; afterwards he fades back to his quiet presence.
  const [arriving, setArriving] = useState(true)
  const present = state?.enabled === true
  useEffect(() => {
    if (!present) return
    setArriving(true)
    const timer = setTimeout(() => setArriving(false), 5200)
    return () => clearTimeout(timer)
  }, [present])

  // ---- being moved ----

  const saveCorner = (next: HermanCorner): void => {
    if (next === corner) return
    setCorner(next)
    window.api.app.setSetting('herman.corner', next).catch((error: unknown) => console.error('his corner could not be saved', error))
  }

  const press = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    press.current = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false }
    dragged.current = false
    // From here on the pointer is his, wherever it goes: a quick flick cannot leave him behind.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* the pointer is already gone: nothing to follow */
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const start = press.current
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved && Math.hypot(dx, dy) < DRAG_START_PX) return
    start.moved = true
    dragged.current = true
    setDrag({ x: dx, y: dy })
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const start = press.current
    press.current = null
    if (!start?.moved) return
    setDrag(null)
    const area = dockRef.current?.parentElement?.getBoundingClientRect()
    if (area && event.type === 'pointerup') saveCorner(nearestCorner(area, event.clientX, event.clientY))
  }

  // ---- being spoken to ----

  const open = (): void => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    if (bubbleRef.current) dismiss()
    if (aiOn) toggleAssistant()
    else if (state) setBubble({ text: state.lines.aiOff, settings: true })
  }

  const openSettings = (): void => {
    dismiss()
    useUi.setState({ settingsSection: 'ai' })
    setSettingsOpen(true)
  }

  const run = (command: HermanCommand): void => {
    dismiss()
    switch (command.type) {
      case 'open-today':
        openToday()
        break
      case 'close-day':
        openCloseDay()
        break
      case 'refine-inbox':
        startRefine('inbox')
        break
      case 'open-page':
        if (isBlockId(command.pageId)) openPage(command.pageId)
        break
      case 'new-meeting':
        void newMeeting({ event: command.event })
        break
      case 'ask':
        if (!aiOn) break
        // Written into the conversation for the user to send or change: never sent from here.
        useHerman.setState({ prepared: command.question })
        if (!useAiGate.getState().panelOpen) toggleAssistant()
        break
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape' && bubbleRef.current) {
      event.preventDefault()
      dismiss()
    } else if (event.key.startsWith('Arrow') && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      saveCorner(cornerAfterKey(corner, event.key))
    }
  }

  if (!state?.enabled) return null

  const pose = poseFor({ mood, attended: attended || (bubble !== null && !fresh), saying: fresh, asleep: state.quiet || !front })
  const classes = ['herman-dock', `is-${corner}`, `is-${state.size}`]
  if (panelOpen || away) classes.push('is-away')
  else if (aside && !bubble && !drag) classes.push('is-aside')
  if (bubble || arriving || mood !== 'idle') classes.push('is-awake')
  if (drag) classes.push('is-dragging')

  return (
    <div ref={dockRef} className={classes.join(' ')} style={drag ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : undefined}>
      <button
        type="button"
        className="herman-button"
        aria-label={`${name}, your assistant`}
        aria-expanded={panelOpen}
        onClick={open}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onPointerEnter={() => setAttended(true)}
        onPointerLeave={() => setAttended(false)}
        onFocus={() => setAttended(true)}
        onBlur={() => setAttended(false)}
      >
        <Herman64 pose={pose} draw />
      </button>
      {/* Announced politely; nothing here ever takes the focus. */}
      <div className="herman-live" aria-live="polite" aria-atomic="true">
        {bubble ? `${name}: ${bubble.text}` : ''}
      </div>
      {bubble && (
        <div
          className="herman-bubble"
          role="group"
          aria-label={`${name} says`}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              dismiss()
            }
          }}
        >
          <p className="herman-bubble-text">{bubble.text}</p>
          <div className="herman-bubble-actions">
            {bubble.action && (
              <button type="button" className="is-primary" onClick={() => bubble.action && run(bubble.action.command)}>
                {bubble.action.label}
              </button>
            )}
            {bubble.choices?.map((choice) => (
              <button
                key={choice.label}
                type="button"
                className={choice.primary ? 'is-primary' : undefined}
                onClick={() => {
                  dismiss()
                  choice.run()
                }}
              >
                {choice.label}
              </button>
            ))}
            {bubble.settings && (
              <button type="button" className="is-primary" onClick={openSettings}>
                Open settings
              </button>
            )}
            {bubble.id ? (
              <>
                <button type="button" onClick={() => dismiss('not-now')}>
                  {state.lines.notNow}
                </button>
                <button type="button" onClick={() => dismiss('fewer')}>
                  {state.lines.fewer}
                </button>
              </>
            ) : bubble.choices?.some((choice) => choice.dismiss) ? null : (
              <button type="button" onClick={() => dismiss()}>
                {bubble.greeting ? 'Hello' : 'Close'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
