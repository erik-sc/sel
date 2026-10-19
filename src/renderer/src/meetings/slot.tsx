// Where the meetings feature shows up in the shell and in a page. These mount points are small
// and always loaded; what they render is fetched when a meeting page is first shown.
import { Suspense, lazy, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Block } from '@shared/types'
import { useBlock } from '@/store/blocks'
import { openPage } from '@/store/tabs'
import { meetingRole, useMeetings } from './gate'

// A clock of its own (not the one in shared/meetings.ts): importing a value from there would
// pull that whole module into the start-up bundle for the sake of one line.
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const two = (n: number): string => String(n).padStart(2, '0')
  const rest = `${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`
  return total >= 3600 ? `${Math.floor(total / 3600)}:${rest}` : rest
}

const RecordingBar = lazy(() => import('./RecordingBar').then((module) => ({ default: module.RecordingBar })))
const EngineSheet = lazy(() => import('./EngineSheet').then((module) => ({ default: module.EngineSheet })))

/** The recording bar, on a meeting page and on its transcript; nothing on any other page. */
export function MeetingSlot({ page }: { page: Block }): JSX.Element | null {
  const databaseId = useMeetings((state) => state.status?.databaseId ?? null)
  const parent = useBlock(page.parentId)
  const found = meetingRole(page, parent, databaseId)
  if (!found) return null
  return (
    <div className="pe-content mt-slot">
      <Suspense fallback={<div className="mt-bar is-loading" aria-hidden="true" />}>
        <RecordingBar key={found.meetingId} meetingId={found.meetingId} role={found.role} />
      </Suspense>
    </div>
  )
}

/** The sheet that explains and runs the one-time download of the transcription engine. */
export function MeetingSetup(): JSX.Element | null {
  const open = useMeetings((state) => state.setup !== null)
  const [wanted, setWanted] = useState(open)
  useEffect(() => {
    if (open) setWanted(true)
  }, [open])
  if (!open && !wanted) return null
  return (
    <Suspense fallback={null}>
      <EngineSheet />
    </Suspense>
  )
}

/**
 * The quiet sign, in the top bar, that a meeting is being recorded: a steady dot and the time.
 * Shown in every window, on every page; a click goes back to the meeting.
 */
export function RecordingIndicator(): JSX.Element | null {
  const recording = useMeetings((state) => state.status?.recording ?? null)
  const at = useMeetings((state) => state.at)
  const [now, setNow] = useState(() => Date.now())
  const running = recording?.state === 'recording'
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, at])
  if (!recording) return null
  const elapsed = recording.elapsedMs + (running ? Math.max(0, now - at) : 0)
  return (
    <button
      type="button"
      className={running ? 'recording-indicator' : 'recording-indicator is-paused'}
      title="Go to the meeting being recorded"
      onClick={() => openPage(recording.pageId)}
    >
      <span className="recording-indicator-dot" aria-hidden="true" />
      <span>{running ? 'Recording' : 'Paused'}</span>
      <span className="recording-indicator-time">{clock(elapsed)}</span>
    </button>
  )
}
