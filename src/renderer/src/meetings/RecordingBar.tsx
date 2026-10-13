// The bar docked at the top of a meeting page: start, the recording itself (time, levels,
// pause, stop), then transcription and what follows it. One component for every state, so
// that the place the user looks at never moves. Loaded on demand (see slot.tsx).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { clockTime, MEETINGS_DEFAULTS, cleanMic, type MeetingAudioInfo, type MeetingSources } from '@shared/meetings'
import { requestPageAi, useAiGate } from '@/ai/gate'
import { openPage } from '@/store/tabs'
import { setSettingsOpen, useUi } from '@/store/ui'
import { Button, IconButton } from '@/ui/Button'
import { Menu, type MenuItem } from '@/ui/Menu'
import { Modal } from '@/ui/Modal'
import { Popover } from '@/ui/Popover'
import { ChevronDown, Mic, MoreHorizontal, Sparkle } from '@/ui/icons'
import { Pause, Play, Stop } from './icons'
import { notifyError, toast } from '@/ui/toast'
import { openMeetingSetup, useMeetings } from './gate'
import { Player, type PlayerHandle } from './Player'
import { abandonRecording, levels, listenForStop, listMicrophones, pauseRecording, resumeRecording, startRecording, stopRecording, useRecorder } from './recorder'
import './meetings.css'

type MicChoice = { id: string; label: string }

const NOTICES: Record<string, string> = {
  'max-duration': 'The recording reached its maximum length and was stopped. Everything was saved.',
  'disk-low': 'The disk is almost full, so the recording was stopped. What was recorded is saved.',
  interrupted: 'The recording was interrupted. What was recorded is saved.',
  failed: 'The recording stopped because of an error. What was recorded is saved.'
}

function errorText(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
  return text || fallback
}

/** A peak (0–1) as the share of a meter it fills: decibels, from −54 dB to full scale. */
function meterShare(peak: number): number {
  if (peak <= 0.002) return 0
  return Math.max(0, Math.min(1, (20 * Math.log10(peak) + 54) / 54))
}

/** Two level meters. The fills are moved with a transform on every frame, outside React. */
function Meters({ system }: { system: boolean }): JSX.Element {
  const micRef = useRef<HTMLSpanElement>(null)
  const systemRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let frame = 0
    const draw = (): void => {
      if (micRef.current) micRef.current.style.transform = `scaleX(${meterShare(levels.mic).toFixed(3)})`
      if (systemRef.current) systemRef.current.style.transform = `scaleX(${meterShare(levels.system).toFixed(3)})`
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div className="mt-meters" aria-hidden="true">
      <div className="mt-meter">
        <span className="mt-meter-label">Microphone</span>
        <span className="mt-meter-track">
          <span ref={micRef} className="mt-meter-fill" />
        </span>
      </div>
      <div className={system ? 'mt-meter' : 'mt-meter is-off'}>
        <span className="mt-meter-label">Computer</span>
        <span className="mt-meter-track">
          <span ref={systemRef} className="mt-meter-fill" />
        </span>
      </div>
    </div>
  )
}

function useSources(): { sources: MeetingSources; mic: MicChoice | null; setMic(mic: MicChoice | null): void; setSystem(on: boolean): void } {
  const [mic, setMicState] = useState<MicChoice | null>(null)
  const [system, setSystemState] = useState<boolean>(MEETINGS_DEFAULTS.defaultSystem)
  useEffect(() => {
    let alive = true
    void Promise.all([window.api.app.getSetting<unknown>('meetings.defaultMic'), window.api.app.getSetting<unknown>('meetings.defaultSystem')]).then(([storedMic, storedSystem]) => {
      if (!alive) return
      setMicState(cleanMic(storedMic) ?? null)
      if (typeof storedSystem === 'boolean') setSystemState(storedSystem)
    })
    return () => {
      alive = false
    }
  }, [])
  const save = (key: string, value: unknown): void => void window.api.app.setSetting(key, value).catch(() => undefined)
  return {
    sources: { micId: mic?.id ?? null, system },
    mic,
    setMic(next) {
      setMicState(next)
      save('meetings.defaultMic', next)
    },
    setSystem(on) {
      setSystemState(on)
      save('meetings.defaultSystem', on)
    }
  }
}

function SourcePicker({ state, systemAudio }: { state: ReturnType<typeof useSources>; systemAudio: boolean }): JSX.Element {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [mics, setMics] = useState<MicChoice[] | null>(null)
  const [finding, setFinding] = useState(false)
  const find = (): void => {
    setFinding(true)
    listMicrophones()
      .then(setMics)
      .catch((error: unknown) => notifyError('The microphones could not be listed.', error))
      .finally(() => setFinding(false))
  }
  const known = mics ?? (state.mic ? [state.mic] : [])
  const summary = `${state.mic?.label || 'Default microphone'}${state.sources.system && systemAudio ? ' + computer audio' : ''}`
  return (
    <>
      <button ref={anchor} type="button" className="mt-sources" aria-haspopup="dialog" aria-expanded={open} title="Choose what is recorded" onClick={() => setOpen((value) => !value)}>
        <span className="mt-sources-text">{summary}</span>
        <ChevronDown size={12} />
      </button>
      <Popover open={open} anchor={anchor.current} placement="bottom-start" onClose={() => setOpen(false)}>
        <div className="mt-picker" role="group" aria-label="What is recorded">
          <div className="mt-picker-title">Microphone</div>
          <label className="mt-option">
            <input type="radio" name="mt-mic" checked={state.mic === null} onChange={() => state.setMic(null)} />
            <span>Default microphone</span>
          </label>
          {known.map((mic) => (
            <label key={mic.id} className="mt-option">
              <input type="radio" name="mt-mic" checked={state.mic?.id === mic.id} onChange={() => state.setMic(mic)} />
              <span>{mic.label}</span>
            </label>
          ))}
          {mics === null && (
            <Button variant="ghost" className="mt-picker-find" disabled={finding} onClick={find}>
              {finding ? 'Looking…' : 'Show all microphones'}
            </Button>
          )}
          <div className="mt-picker-title">Computer audio</div>
          <label className={systemAudio ? 'mt-option' : 'mt-option is-disabled'}>
            <input type="checkbox" checked={state.sources.system && systemAudio} disabled={!systemAudio} onChange={(event) => state.setSystem(event.target.checked)} />
            <span>Record what the computer plays</span>
          </label>
          <p className="mt-picker-note">
            {systemAudio ? 'The other people in a call. It is kept apart from your microphone, so the transcript can tell you from them.' : 'Computer audio is not available on this system. Only the microphone is recorded.'}
          </p>
        </div>
      </Popover>
    </>
  )
}

function Consent({ onStart, onClose }: { onStart(remember: boolean): void; onClose(): void }): JSX.Element {
  const [skip, setSkip] = useState(false)
  return (
    <Modal open onClose={onClose} label="Before you record" className="mt-dialog">
      <h2 className="mt-dialog-title">Before you record</h2>
      <p className="mt-dialog-text">Make sure everyone in the meeting knows it is being recorded.</p>
      <p className="mt-dialog-text is-quiet">The audio stays on this computer. It is transcribed here and is never uploaded or synced.</p>
      <label className="mt-option">
        <input type="checkbox" checked={skip} onChange={(event) => setSkip(event.target.checked)} />
        <span>Don’t show again</span>
      </label>
      <div className="mt-dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" autoFocus onClick={() => onStart(skip)}>
          Start recording
        </Button>
      </div>
    </Modal>
  )
}

function Speakers({ info, onSave, onClose }: { info: MeetingAudioInfo; onSave(mic: string, system: string): void; onClose(): void }): JSX.Element {
  const [mic, setMic] = useState(info.speakers.mic)
  const [system, setSystem] = useState(info.speakers.system)
  const valid = mic.trim() && system.trim() && mic.trim() !== system.trim()
  return (
    <Modal open onClose={onClose} label="Rename speakers" className="mt-dialog">
      <h2 className="mt-dialog-title">Rename speakers</h2>
      <label className="mt-field">
        <span>Microphone</span>
        <input className="mt-input" value={mic} maxLength={40} onChange={(event) => setMic(event.target.value)} />
      </label>
      <label className="mt-field">
        <span>Computer audio</span>
        <input className="mt-input" value={system} maxLength={40} onChange={(event) => setSystem(event.target.value)} />
      </label>
      <div className="mt-dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!valid} onClick={() => onSave(mic.trim(), system.trim())}>
          Rename
        </Button>
      </div>
    </Modal>
  )
}

const EMPTY: MeetingAudioInfo = { state: 'none', seconds: 0, tracks: [], bytes: 0, transcriptPageId: null, speakers: { mic: 'Me', system: 'Others' } }

export function RecordingBar({ meetingId, role }: { meetingId: string; role: 'meeting' | 'transcript' }): JSX.Element {
  const status = useMeetings((state) => state.status)
  const session = useRecorder((state) => (state.session?.pageId === meetingId ? state.session : null))
  const busyElsewhere = useRecorder((state) => state.session !== null && state.session.pageId !== meetingId)
  const aiOn = useAiGate((state) => state.enabled)
  const [info, setInfo] = useState<MeetingAudioInfo>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [consent, setConsent] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const player = useRef<PlayerHandle>(null)
  const sources = useSources()

  const refresh = useCallback(() => {
    window.api.meetings.audio.info(meetingId).then(
      (next) => {
        setInfo(next)
        setLoaded(true)
      },
      (error: unknown) => console.error('meeting info failed', error)
    )
  }, [meetingId])

  const recording = status?.recording ?? null
  const transcribing = status?.transcribing?.pageId === meetingId ? status.transcribing : null
  const interrupted = status?.interrupted.find((entry) => entry.pageId === meetingId) ?? null
  // Whatever changes in the main process (a stop, a transcript) changes what this bar offers.
  useEffect(refresh, [refresh, recording?.pageId, transcribing === null, interrupted === null, session === null])
  useEffect(listenForStop, [])

  // A recording the app itself ended: say why, once, where the user is looking.
  const notice = status?.notice?.pageId === meetingId ? status.notice.reason : null
  useEffect(() => {
    if (notice) setNote(NOTICES[notice] ?? null)
  }, [notice])

  const [percent, setPercent] = useState(0)
  useEffect(() => {
    setPercent(transcribing?.percent ?? 0)
    if (!transcribing) return
    return window.api.meetings.onProgress((progress) => {
      if (progress.kind === 'transcribe' && progress.pageId === meetingId) setPercent(progress.percent)
    })
  }, [meetingId, transcribing === null]) // eslint-disable-line react-hooks/exhaustive-deps

  // A time in the transcript (`12:34`, written as code) moves the player there. The editor draws a
  // code mark as a span that carries its marks in `data-m`; read-only views draw a <code>.
  useEffect(() => {
    if (!info.tracks.length) return
    const onClick = (event: MouseEvent): void => {
      const code = event.target instanceof Element ? event.target.closest(`.pe-root [data-m*='"c"'], .pe-root code`) : null
      const match = code ? /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(code.textContent?.trim() ?? '') : null
      if (!match) return
      player.current?.seek(Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), true)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [info.tracks.length])

  const transcribe = useCallback(async (): Promise<void> => {
    try {
      const engine = await window.api.meetings.engine.status()
      if (engine.state !== 'ready') return openMeetingSetup(meetingId)
      await window.api.meetings.transcribe(meetingId)
    } catch (error) {
      setNote(errorText(error, 'Transcription could not be started.'))
    }
  }, [meetingId])

  const begin = (): void => {
    setNote(null)
    startRecording(meetingId, sources.sources).catch((error: unknown) => setNote(errorText(error, 'The recording could not be started.')))
  }
  const start = (): void => {
    void window.api.app.getSetting<unknown>('meetings.consentReminder').then(
      (value) => (value === false ? begin() : setConsent(true)),
      () => setConsent(true)
    )
  }
  const stop = (): void => {
    stopRecording()
      .then((result) => {
        refresh()
        // Straight on to the transcript, when the engine is there; the bar says what is missing otherwise.
        if (result && result.state === 'recorded') void transcribe()
      })
      .catch((error: unknown) => {
        abandonRecording()
        setNote(errorText(error, 'The recording could not be saved.'))
        refresh()
      })
  }
  const act = (work: Promise<unknown>, failure: string): void => {
    work.then(refresh, (error: unknown) => setNote(errorText(error, failure)))
  }

  const menu: MenuItem[] = [
    { id: 'speakers', label: 'Rename speakers…', disabled: info.state === 'none', onSelect: () => setRenaming(true) },
    { id: 'again', label: 'Transcribe again', disabled: info.state !== 'ready' && info.state !== 'failed', onSelect: () => void transcribe() },
    {
      id: 'delete',
      label: 'Delete audio',
      danger: true,
      disabled: info.tracks.length === 0,
      onSelect: () => {
        act(window.api.meetings.audio.delete(meetingId), 'The audio could not be deleted.')
        toast('The audio was deleted. The transcript stays.')
      }
    }
  ]

  const live = session !== null
  const recordingHere = recording?.pageId === meetingId
  let body: JSX.Element
  if (live && (session.state === 'recording' || session.state === 'paused' || session.state === 'stopping')) {
    const paused = session.state === 'paused'
    body = (
      <>
        <div className={paused ? 'mt-state is-paused' : 'mt-state is-recording'} role="status">
          <span className="mt-dot" aria-hidden="true" />
          <span className="mt-state-text">{session.state === 'stopping' ? 'Saving…' : paused ? 'Paused' : 'Recording'}</span>
          <span className="mt-clock" aria-label="Recorded so far">
            {clockTime(session.elapsedMs / 1000)}
          </span>
        </div>
        <Meters system={session.system} />
        <div className="mt-actions">
          <Button icon={paused ? <Play /> : <Pause />} disabled={session.state === 'stopping'} onClick={paused ? resumeRecording : pauseRecording}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="primary" icon={<Stop />} disabled={session.state === 'stopping'} onClick={stop}>
            Stop
          </Button>
        </div>
      </>
    )
  } else if (live) {
    body = (
      <div className="mt-state" role="status">
        <span className="mt-state-text">Starting…</span>
      </div>
    )
  } else if (recordingHere) {
    body = (
      <div className="mt-state is-recording" role="status">
        <span className="mt-dot" aria-hidden="true" />
        <span className="mt-state-text">This meeting is being recorded in another window.</span>
      </div>
    )
  } else if (interrupted) {
    body = (
      <>
        <div className="mt-state" role="status">
          <span className="mt-state-text">A recording of this meeting was interrupted ({clockTime(interrupted.seconds)} saved).</span>
        </div>
        <div className="mt-actions">
          <Button variant="primary" onClick={() => act(window.api.meetings.recording.recover(meetingId), 'The recording could not be recovered.')}>
            Recover
          </Button>
          <Button onClick={() => act(window.api.meetings.recording.discard(meetingId), 'The recording could not be discarded.')}>Discard</Button>
        </div>
      </>
    )
  } else if (transcribing) {
    body = (
      <>
        <div className="mt-state" role="status">
          <span className="mt-state-text">Transcribing on this computer…</span>
          <span className="mt-clock">{percent}%</span>
        </div>
        <div className="mt-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Transcription">
          <span className="mt-progress-fill" style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
        <div className="mt-actions">
          <Button onClick={() => act(window.api.meetings.cancelTranscribe(meetingId), 'Transcription could not be cancelled.')}>Cancel</Button>
        </div>
      </>
    )
  } else if (info.state === 'none') {
    const blocked = recording !== null || busyElsewhere
    body =
      role === 'transcript' ? (
        <div className="mt-state">
          <span className="mt-state-text is-quiet">The audio of this meeting is not kept.</span>
        </div>
      ) : (
        <>
          <div className="mt-actions is-start">
            <Button variant="primary" icon={<Mic />} disabled={!loaded || blocked} onClick={start}>
              Start recording
            </Button>
            <SourcePicker state={sources} systemAudio={status?.systemAudio !== false} />
          </div>
          {blocked && recording && (
            <button type="button" className="mt-link" onClick={() => openPage(recording.pageId)}>
              Another meeting is being recorded
            </button>
          )}
        </>
      )
  } else {
    const minutes = Math.max(1, Math.round(info.seconds / 60))
    body = (
      <>
        {info.tracks.length > 0 ? (
          <Player ref={player} tracks={info.tracks} seconds={info.seconds} speakers={info.speakers} />
        ) : (
          <div className="mt-state">
            <span className="mt-state-text is-quiet">
              {minutes} min · {info.state === 'ready' ? 'audio deleted, transcript kept' : 'recorded'}
            </span>
          </div>
        )}
        <div className="mt-actions">
          {info.state === 'ready' && role === 'meeting' && (
            <Button
              variant="primary"
              icon={<Sparkle />}
              disabled={!aiOn}
              title={aiOn ? undefined : 'AI is turned off. Turn it on in Settings, under AI, to write up notes.'}
              onClick={() => requestPageAi(meetingId, 'consolidate')}
            >
              Write up notes
            </Button>
          )}
          {info.state === 'ready' && role === 'meeting' && info.transcriptPageId && <Button onClick={() => info.transcriptPageId && openPage(info.transcriptPageId)}>Transcript</Button>}
          {role === 'transcript' && <Button onClick={() => openPage(meetingId)}>Back to the meeting</Button>}
          {(info.state === 'recorded' || info.state === 'failed') && (
            <Button variant="primary" onClick={() => void transcribe()}>
              {info.state === 'failed' ? 'Try again' : 'Transcribe'}
            </Button>
          )}
          <IconButton ref={moreRef} label="More" active={menuOpen} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            <MoreHorizontal />
          </IconButton>
          <Popover open={menuOpen} anchor={moreRef.current} placement="bottom-end" onClose={() => setMenuOpen(false)}>
            <Menu items={menu} onClose={() => setMenuOpen(false)} autoFocus />
          </Popover>
        </div>
      </>
    )
  }

  const hint =
    note ??
    (info.state === 'failed' && !transcribing ? (info.error ?? 'Transcription failed.') : null) ??
    (live && session.systemNote ? session.systemNote : null) ??
    (live && recording?.silent ? 'Nothing has been heard for ten minutes. Stop the recording if the meeting is over.' : null) ??
    (info.state === 'ready' && role === 'meeting' && !aiOn ? 'Turn on AI in Settings to have the notes written up from the transcript.' : null)

  return (
    <div className={`mt-bar${live && session.state === 'recording' ? ' is-live' : ''}`} role="region" aria-label="Meeting recording" contentEditable={false}>
      <div className="mt-row">{body}</div>
      {hint && (
        <p className="mt-hint" role="status">
          {hint}
          {info.state === 'ready' && !aiOn && !note && (
            <>
              {' '}
              <button
                type="button"
                className="mt-link is-inline"
                onClick={() => {
                  useUi.setState({ settingsSection: 'ai' })
                  setSettingsOpen(true)
                }}
              >
                Open settings
              </button>
            </>
          )}
        </p>
      )}
      {consent && (
        <Consent
          onClose={() => setConsent(false)}
          onStart={(skip) => {
            setConsent(false)
            if (skip) void window.api.app.setSetting('meetings.consentReminder', false).catch(() => undefined)
            begin()
          }}
        />
      )}
      {renaming && (
        <Speakers
          info={info}
          onClose={() => setRenaming(false)}
          onSave={(mic, system) => {
            setRenaming(false)
            act(window.api.meetings.setSpeakers(meetingId, { mic, system }), 'The speakers could not be renamed.')
          }}
        />
      )}
    </div>
  )
}
