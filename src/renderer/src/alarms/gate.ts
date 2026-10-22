// The small part of the alarms that is always loaded: it listens for what the main process's
// clock has to say (a briefing at one of its times, a task's reminder, an event about to start)
// and hands it to Herman, or to a notice when he is off. What the user can do about it (open,
// snooze, record a meeting) is decided here, so that the bubble and the notice offer the same.
// The chime and the voice are a chunk of their own (./play.ts).
import { create } from 'zustand'
import type { AnnouncedEvent, Announcement } from '@shared/alarms'
import { openToday } from '@/briefing/route'
import { useHerman } from '@/herman/gate'
import { newMeeting } from '@/meetings/gate'
import { isBlockId, openPage } from '@/store/tabs'
import { startRefine } from '@/tasks/gate'
import { toast } from '@/ui/toast'
import { alarmsCopy } from './copy'

interface AlarmsGate {
  /** What is being said, until it is put away. Herman's bubble shows it. */
  current: Announcement | null
}

export const useAlarms = create<AlarmsGate>(() => ({ current: null }))

/** What came while something else was being said: each is said in turn. */
const waiting: Announcement[] = []

let started = false

export function initAlarms(): void {
  if (started) return
  started = true
  window.api.alarms.onAnnounce((announcement) => receive(announcement))
  // A window opened because none was open when something was due takes it once it is up.
  window.api.alarms.pending().then(
    (announcement) => {
      if (announcement) receive(announcement)
    },
    (error: unknown) => console.error('the alarms could not be asked', error)
  )
}

function receive(announcement: Announcement): void {
  const { current } = useAlarms.getState()
  if (current?.id === announcement.id || waiting.some((item) => item.id === announcement.id)) return
  // Taken: no other window needs to say it. When main cannot be told, a window opened later
  // may say it again: written down, so that a repeat has an explanation.
  void window.api.alarms
    .heard(announcement.id)
    .catch((error: unknown) => console.error('[alarms] could not say the announcement was taken', error))
  if (current && useHerman.getState().on) waiting.push(announcement)
  else void present(announcement)
}

async function present(announcement: Announcement): Promise<void> {
  useAlarms.setState({ current: announcement })
  // Without Herman there is no bubble: a notice says it instead, with the same buttons.
  if (!useHerman.getState().on) {
    const actions = announcementActions(announcement)
      .filter((action) => !action.dismiss)
      .map((action) => ({ label: action.label, run: () => action.run() }))
    toast(announcement.text, { duration: announcement.kind === 'event' ? 0 : 30_000, actions })
  }
  try {
    const { play } = await import('./play')
    await play(announcement)
  } catch (error) {
    console.error('the announcement could not be played', error)
  }
}

/** The bubble was put away: he stops speaking, and what waited is said. */
export function putAway(id: string): void {
  if (useAlarms.getState().current?.id !== id) return
  useAlarms.setState({ current: null })
  void import('./play').then(({ hush }) => hush())
  const next = waiting.shift()
  if (next) void present(next)
}

/** One thing to do about an announcement. */
export interface AnnouncementAction {
  label: string
  primary?: boolean
  /** Only puts the announcement away ("Not now"): the bubble shows no Close beside it. */
  dismiss?: boolean
  run(): void
}

function meetingInput(event: AnnouncedEvent) {
  return {
    event: {
      title: event.title,
      start: event.start,
      end: event.end,
      ...(event.uid ? { uid: event.uid } : {}),
      ...(event.location ? { location: event.location } : {}),
      ...(event.description ? { description: event.description } : {})
    }
  }
}

function snooze(announcement: Announcement): void {
  window.api.alarms.snooze(announcement.id).then(
    () => {
      const at = new Intl.DateTimeFormat(announcement.locale, { hour: 'numeric', minute: '2-digit' }).format(Date.now() + 10 * 60_000)
      toast(alarmsCopy(announcement.locale).snoozedUntil(at))
    },
    (error: unknown) => console.error('the announcement could not be snoozed', error)
  )
}

/** What the bubble (or the notice) offers for an announcement, the main action first. */
export function announcementActions(announcement: Announcement): AnnouncementAction[] {
  const copy = alarmsCopy(announcement.locale)
  const actions: AnnouncementAction[] = []
  const { event } = announcement
  if (announcement.kind === 'briefing') actions.push({ label: copy.openToday, primary: true, run: openToday })
  if (announcement.kind === 'refine') actions.push({ label: copy.refine, primary: true, run: () => startRefine('refine') })
  if (announcement.kind === 'reminder' && announcement.pageId && isBlockId(announcement.pageId)) {
    const pageId = announcement.pageId
    actions.push({ label: copy.openTask, primary: true, run: () => openPage(pageId) })
  }
  if (event?.ask) {
    actions.push({ label: copy.record, primary: true, run: () => void newMeeting(meetingInput(event), { record: true }) })
    actions.push({ label: copy.justNotes, run: () => void newMeeting(meetingInput(event)) })
  }
  if (announcement.snooze) actions.push({ label: copy.snooze, run: () => snooze(announcement) })
  if (event?.ask) actions.push({ label: copy.notNow, dismiss: true, run: () => undefined })
  return actions
}
