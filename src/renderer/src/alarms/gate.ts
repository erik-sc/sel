// The small part of the alarms that is always loaded: it listens for what the main process's
// clock has to say (a briefing at one of its times, a task's reminder) and hands it to Herman.
// The chime and the voice are a chunk of their own (./play.ts).
import { create } from 'zustand'
import type { Announcement } from '@shared/alarms'
import { useHerman } from '@/herman/gate'
import { toast } from '@/ui/toast'

interface AlarmsGate {
  /** What is being said, until it is put away. Herman's bubble shows it. */
  current: Announcement | null
}

export const useAlarms = create<AlarmsGate>(() => ({ current: null }))

let started = false

export function initAlarms(): void {
  if (started) return
  started = true
  window.api.alarms.onAnnounce((announcement) => void present(announcement))
  // A window opened because none was open when something was due takes it once it is up.
  window.api.alarms.pending().then(
    (announcement) => {
      if (announcement) void present(announcement)
    },
    (error: unknown) => console.error('the alarms could not be asked', error)
  )
}

async function present(announcement: Announcement): Promise<void> {
  if (useAlarms.getState().current?.id === announcement.id) return
  useAlarms.setState({ current: announcement })
  void window.api.alarms.heard(announcement.id).catch(() => undefined)
  // Without Herman there is no bubble: a notice says it instead.
  if (!useHerman.getState().on) toast(announcement.text, { duration: 30_000 })
  try {
    const { play } = await import('./play')
    await play(announcement)
  } catch (error) {
    console.error('the announcement could not be played', error)
  }
}

/** The bubble was put away: he stops speaking. */
export function putAway(id: string): void {
  if (useAlarms.getState().current?.id !== id) return
  useAlarms.setState({ current: null })
  void import('./play').then(({ hush }) => hush())
}
