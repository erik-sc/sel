// The small part of the meetings feature that is always loaded: what the main process says is
// going on (is anything being recorded, which database holds the meetings) and the one action
// every entry point shares. Everything with a face is in chunks of their own.
import { create } from 'zustand'
import type { Block } from '@shared/types'
import type { MeetingCreateInput, MeetingsStatus } from '@shared/meetings'
import { refreshBlocks } from '../store/blocks'
import { openPage } from '../store/tabs'
import { refreshTree } from '../store/tree'
import { notifyError, toast } from '../ui/toast'

interface MeetingsGate {
  status: MeetingsStatus | null
  /** When `status` arrived, for clocks that tick between two of them. */
  at: number
  /** The engine setup sheet: closed, or open (with the meeting to transcribe once it is ready). */
  setup: { pageId: string | null } | null
  /** A meeting page whose recording bar starts recording once it is up ("Record" on an event's alarm). */
  autoStart: string | null
}

export const useMeetings = create<MeetingsGate>(() => ({ status: null, at: 0, setup: null, autoStart: null }))

function take(status: MeetingsStatus): void {
  useMeetings.setState({ status, at: Date.now() })
}

let started = false

/** Start-up: one question and one subscription. The main process loads nothing of the feature for it until something was recorded. */
export function initMeetings(): void {
  if (started) return
  started = true
  window.api.meetings.onStatus(take)
  void window.api.meetings.status().then(
    (status) => {
      take(status)
      // The app ended in the middle of a recording last time: what was recorded is on disk. Say so once.
      const lost = status.interrupted[0]
      if (lost)
        toast(`The recording of “${lost.title}” was interrupted. What was recorded is saved.`, {
          duration: 0,
          action: { label: 'Open', run: () => openPage(lost.pageId) }
        })
    },
    (error: unknown) => console.error('meetings status failed', error)
  )
}

/**
 * Creates a meeting page (and the Meetings database the first time) and opens it; for an event
 * whose page was already made, opens that one. With `record`, its bar starts recording (the
 * consent dialog first, unless the user turned it off).
 */
export async function newMeeting(input: MeetingCreateInput = {}, options: { record?: boolean } = {}): Promise<void> {
  try {
    const { pageId } = await window.api.meetings.create(input)
    const status = await window.api.meetings.status()
    take(status)
    if (options.record) useMeetings.setState({ autoStart: pageId })
    await refreshBlocks(status.databaseId ? [pageId, status.databaseId] : [pageId]).catch(() => undefined)
    await refreshTree().catch(() => undefined)
    openPage(pageId)
  } catch (error) {
    notifyError('Could not create the meeting.', error)
  }
}

/** What a page is to this feature: a meeting, the transcript of one, or neither. */
export function meetingRole(
  page: Block | undefined,
  parent: Block | undefined,
  databaseId: string | null | undefined
): { role: 'meeting' | 'transcript'; meetingId: string } | null {
  if (!page || !databaseId || page.type !== 'page') return null
  if (page.parentId === databaseId) return { role: 'meeting', meetingId: page.id }
  if (parent && parent.type === 'page' && parent.parentId === databaseId) return { role: 'transcript', meetingId: parent.id }
  return null
}

export function openMeetingSetup(pageId: string | null = null): void {
  useMeetings.setState({ setup: { pageId } })
}

export function closeMeetingSetup(): void {
  useMeetings.setState({ setup: null })
}
