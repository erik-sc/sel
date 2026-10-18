// A compact player for the audio of a meeting: the two streams play together, each can be
// muted, a time clicked in the transcript moves both, and where it is goes to `onTime` (which
// marks the paragraph being heard). Part of the recording bar's chunk.
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { JSX, Ref } from 'react'
import { clockTime, type MeetingStream, type MeetingTrack } from '@shared/meetings'
import { IconButton } from '@/ui/Button'
import { Pause, Play } from './icons'

export interface PlayerHandle {
  seek(seconds: number, play?: boolean): void
}

const RATES = [1, 1.5, 2] as const
/** Streams further apart than this (seconds) are brought back together. */
const DRIFT_S = 0.25

export function Player({
  tracks,
  seconds,
  speakers,
  onTime: report,
  ref
}: {
  tracks: MeetingTrack[]
  seconds: number
  speakers: Record<MeetingStream, string>
  onTime?(seconds: number): void
  ref?: Ref<PlayerHandle>
}): JSX.Element {
  const elements = useRef(new Map<MeetingStream, HTMLAudioElement>())
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [rate, setRate] = useState<(typeof RATES)[number]>(1)
  const [muted, setMuted] = useState<Record<MeetingStream, boolean>>({ mic: false, system: false })
  const [failed, setFailed] = useState(false)
  const all = (): HTMLAudioElement[] => [...elements.current.values()]
  const lead = (): HTMLAudioElement | undefined => all()[0]
  // The length written when the recording stopped; a file that does not say its own falls back to it.
  const length = (): number => {
    const own = lead()?.duration
    return own !== undefined && Number.isFinite(own) && own > 0 ? own : seconds
  }

  const seek = (to: number, play = false): void => {
    const target = Math.max(0, Math.min(length(), to))
    for (const element of all()) element.currentTime = target
    setTime(target)
    if (play) void Promise.all(all().map((element) => element.play())).catch(() => setFailed(true))
  }
  useImperativeHandle(ref, () => ({ seek }))

  useEffect(() => {
    for (const element of all()) element.playbackRate = rate
  }, [rate, tracks])

  // Leaving the page stops the sound.
  useEffect(() => {
    const map = elements.current
    return () => {
      for (const element of map.values()) element.pause()
    }
  }, [])

  const toggle = (): void => {
    if (playing) for (const element of all()) element.pause()
    else {
      if (time >= length() - 0.05) seek(0)
      void Promise.all(all().map((element) => element.play())).catch(() => setFailed(true))
    }
  }

  const onTime = (): void => {
    const main = lead()
    if (!main) return
    setTime(main.currentTime)
    report?.(main.currentTime)
    for (const other of all().slice(1)) if (Math.abs(other.currentTime - main.currentTime) > DRIFT_S) other.currentTime = main.currentTime
  }

  return (
    <div className="mt-player" role="group" aria-label="Recording">
      {tracks.map((track, index) => (
        <audio
          key={track.stream}
          ref={(element) => {
            if (element) elements.current.set(track.stream, element)
            else elements.current.delete(track.stream)
          }}
          src={track.url}
          preload="metadata"
          muted={muted[track.stream]}
          onPlay={index === 0 ? () => setPlaying(true) : undefined}
          onPause={index === 0 ? () => setPlaying(false) : undefined}
          onEnded={index === 0 ? () => setPlaying(false) : undefined}
          onTimeUpdate={index === 0 ? onTime : undefined}
          onError={() => setFailed(true)}
        />
      ))}
      <IconButton label={playing ? 'Pause' : 'Play'} onClick={toggle}>
        {playing ? <Pause /> : <Play />}
      </IconButton>
      <input
        className="mt-scrub"
        type="range"
        min={0}
        max={Math.max(1, Math.round(length()))}
        step={1}
        value={Math.round(time)}
        aria-label="Position"
        aria-valuetext={`${clockTime(time)} of ${clockTime(length())}`}
        onChange={(event) => seek(Number(event.target.value))}
      />
      <span className="mt-time">{failed ? 'Cannot play' : `${clockTime(time)} / ${clockTime(length())}`}</span>
      <button type="button" className="mt-chip" aria-label={`Speed ${rate}×`} onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])}>
        {rate}×
      </button>
      {tracks.length > 1 &&
        tracks.map((track) => (
          <button
            key={track.stream}
            type="button"
            className={muted[track.stream] ? 'mt-chip is-off' : 'mt-chip'}
            aria-pressed={!muted[track.stream]}
            title={muted[track.stream] ? `Unmute ${speakers[track.stream]}` : `Mute ${speakers[track.stream]}`}
            onClick={() => setMuted((current) => ({ ...current, [track.stream]: !current[track.stream] }))}
          >
            {speakers[track.stream]}
          </button>
        ))}
    </div>
  )
}
