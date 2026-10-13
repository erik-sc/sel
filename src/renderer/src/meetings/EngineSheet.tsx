// The sheet that sets up transcription: what will be downloaded, from where, how large it is,
// and that this is the only time the feature goes online. Nothing is fetched before the button
// is pressed. Loaded on demand (see slot.tsx).
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { MEETINGS_DEFAULTS, WHISPER_MODEL_LABELS, WHISPER_MODELS, isWhisperModel, type EngineDownload, type EngineStatus, type WhisperModelId } from '@shared/meetings'
import { Button, IconButton } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import { Close } from '@/ui/icons'
import { closeMeetingSetup, useMeetings } from './gate'
import './meetings.css'

/** `487601967` → `488 MB`; a gigabyte or more → `1.5 GB`. Decimal units, as download pages show them. */
export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return '0 MB'
  if (bytes < 100_000) return `${Math.max(1, Math.round(bytes / 1000))} kB`
  const mb = bytes / 1_000_000
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
}

const PHASES: Record<EngineDownload['phase'], string> = {
  program: 'Downloading the program',
  unpacking: 'Unpacking the program',
  model: 'Downloading the speech model',
  verifying: 'Checking the download'
}

function clean(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong.'
}

/** The engine's status, kept current while a download runs. Shared by the sheet and the settings section. */
export function useEngine(): { status: EngineStatus | null; download: EngineDownload | null; message: string | null; set(status: EngineStatus | null): void; say(message: string | null): void; refresh(): void } {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [download, setDownload] = useState<EngineDownload | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const refresh = (): void => {
    window.api.meetings.engine.status().then(
      (next) => {
        setStatus(next)
        setDownload(next.download)
      },
      (error: unknown) => setMessage(clean(error))
    )
  }
  useEffect(() => {
    refresh()
    return window.api.meetings.onProgress((progress) => {
      if (progress.kind === 'download') setDownload({ phase: progress.phase, received: progress.received, total: progress.total })
      else if (progress.kind === 'download-done') {
        setDownload(null)
        setMessage(progress.ok ? null : (progress.message ?? null))
        refresh()
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return {
    status,
    download,
    message: message ?? status?.error ?? null,
    set: (next) => {
      if (next) {
        setStatus(next)
        setMessage(next.error ?? null)
      }
    },
    say: setMessage,
    refresh
  }
}

export function DownloadProgress({ download, onCancel }: { download: EngineDownload; onCancel(): void }): JSX.Element {
  const share = download.total > 0 ? Math.min(1, download.received / download.total) : 0
  return (
    <div className="mt-download" role="status">
      <div className="mt-download-text">
        <span>{PHASES[download.phase]}</span>
        <span className="mt-download-size">{download.phase === 'unpacking' ? '' : `${formatBytes(download.received)} of ${formatBytes(download.total)}`}</span>
      </div>
      <div className="mt-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Download">
        <span className="mt-progress-fill" style={{ transform: `scaleX(${share})` }} />
      </div>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  )
}

export function EngineSheet(): JSX.Element {
  const setup = useMeetings((state) => state.setup)
  const engine = useEngine()
  const [model, setModel] = useState<WhisperModelId>(MEETINGS_DEFAULTS.model)
  const { status, download } = engine

  useEffect(() => {
    if (setup) engine.refresh()
    void window.api.app.getSetting<unknown>('meetings.model').then((value) => {
      if (isWhisperModel(value)) setModel(value)
    })
  }, [setup !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const pending = setup?.pageId ?? null
  const ready = status?.state === 'ready'
  const finish = (): void => {
    closeMeetingSetup()
    // The meeting that was waiting for this is transcribed now.
    if (pending) void window.api.meetings.transcribe(pending).catch((error: unknown) => engine.say(clean(error)))
  }
  const start = (): void => {
    engine.say(null)
    window.api.meetings.engine.download({ model }).then(engine.set, (error: unknown) => engine.say(clean(error)))
  }
  const pick = (which: 'pickProgram' | 'pickModel'): void => {
    window.api.meetings.engine[which]().then(engine.set, (error: unknown) => engine.say(clean(error)))
  }

  const needsProgram = !status?.program
  const total = status ? (needsProgram ? status.offer.programBytes : 0) + status.offer.models[model] : 0

  return (
    <Modal open={setup !== null} onClose={closeMeetingSetup} label="Set up transcription" className="mt-sheet">
      <header className="mt-sheet-head">
        <h2>Set up transcription</h2>
        <IconButton label="Close" tooltip={false} onClick={closeMeetingSetup}>
          <Close />
        </IconButton>
      </header>
      <div className="mt-sheet-body">
        <p className="mt-sheet-lead">
          Meetings are transcribed on this computer by whisper.cpp, an open-source program. Your audio never leaves the computer. sel needs to download the program and a speech model once; this is the only time
          this feature goes online.
        </p>
        {status === null ? (
          <p className="mt-sheet-note">Checking…</p>
        ) : ready ? (
          <p className="mt-sheet-note">
            Transcription is ready: whisper.cpp {status.program?.version}
            {status.model?.id ? `, ${status.model.id} model` : ''}.
          </p>
        ) : status.canDownload ? (
          <>
            <fieldset className="mt-models" disabled={download !== null}>
              <legend className="mt-sheet-label">Speech model</legend>
              {WHISPER_MODELS.map((id) => (
                <label key={id} className="mt-option">
                  <input type="radio" name="mt-model" checked={model === id} onChange={() => setModel(id)} />
                  <span>{WHISPER_MODEL_LABELS[id]}</span>
                  <span className="mt-option-size">{formatBytes(status.offer.models[id])}</span>
                </label>
              ))}
            </fieldset>
            <dl className="mt-facts">
              {needsProgram && (
                <>
                  <dt>Program</dt>
                  <dd>
                    whisper.cpp {status.offer.version}, {formatBytes(status.offer.programBytes)}, from github.com/ggml-org/whisper.cpp
                  </dd>
                </>
              )}
              <dt>Model</dt>
              <dd>{formatBytes(status.offer.models[model])}, from huggingface.co/ggerganov/whisper.cpp</dd>
              <dt>Check</dt>
              <dd>Each file is compared with a checksum built into sel before it is used. A file that differs is deleted.</dd>
            </dl>
          </>
        ) : (
          <p className="mt-sheet-note">
            sel cannot download the program for this system. Install whisper.cpp yourself, then choose its <code className="mt-code">whisper-cli</code> program and a model file (ggml-….bin) here.
          </p>
        )}
        {download && <DownloadProgress download={download} onCancel={() => void window.api.meetings.engine.cancelDownload()} />}
        <p className={engine.message ? 'mt-sheet-error' : 'mt-sheet-error is-empty'} role="alert">
          {engine.message ?? ''}
        </p>
      </div>
      <footer className="mt-sheet-foot">
        {!ready && (
          <>
            <Button variant="ghost" disabled={download !== null} onClick={() => pick('pickProgram')}>
              Choose program…
            </Button>
            <Button variant="ghost" disabled={download !== null} onClick={() => pick('pickModel')}>
              Choose model file…
            </Button>
          </>
        )}
        <span className="mt-sheet-space" />
        {ready ? (
          <Button variant="primary" onClick={finish}>
            {pending ? 'Transcribe the meeting' : 'Done'}
          </Button>
        ) : (
          status?.canDownload && (
            <Button variant="primary" disabled={download !== null} onClick={start}>
              {download ? 'Downloading…' : `Download (${formatBytes(total)})`}
            </Button>
          )
        )}
      </footer>
    </Modal>
  )
}
