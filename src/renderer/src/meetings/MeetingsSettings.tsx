// Settings → Meetings: the transcription engine, what is kept of a recording and for how long.
// Loaded on demand with the settings window's section.
import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import {
  DELETE_AFTER_DAYS,
  MEETING_LANGUAGES,
  MEETING_LANGUAGE_LABELS,
  MEETINGS_DEFAULTS,
  WHISPER_MODEL_LABELS,
  WHISPER_MODELS,
  isMeetingLanguage,
  isWhisperModel,
  type MeetingLanguage,
  type WhisperModelId
} from '@shared/meetings'
import { ConfirmButton, Segmented } from '@/appearance/controls'
import { Button } from '@/ui/Button'
import { notifyError } from '@/ui/toast'
import { DownloadProgress, formatBytes, useEngine } from './EngineSheet'
import { openMeetingSetup } from './gate'
import './meetings.css'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

const DAYS_LABELS: Record<number, string> = { 0: 'Never', 7: 'After 7 days', 30: 'After 30 days', 90: 'After 90 days' }

interface Values {
  model: WhisperModelId
  language: MeetingLanguage
  keepOriginal: boolean
  deleteAfterDays: number
  defaultSystem: boolean
  consentReminder: boolean
}

const DEFAULTS: Values = { ...MEETINGS_DEFAULTS }

function Row({ label, help, error, children }: { label: string; help?: string; error?: boolean; children?: ReactNode }): JSX.Element {
  return (
    <div className="ap-row">
      <div className="ap-row-text">
        <span className="ap-row-label">{label}</span>
        {help && <span className={error ? 'ap-row-help is-error' : 'ap-row-help'}>{help}</span>}
      </div>
      {children && <div className="ap-row-control mt-controls">{children}</div>}
    </div>
  )
}

export function MeetingsSection(): JSX.Element {
  const engine = useEngine()
  const [values, setValues] = useState<Values>(DEFAULTS)
  const [storage, setStorage] = useState<{ bytes: number; meetings: number; engineBytes: number } | null>(null)
  const { status, download } = engine

  const loadStorage = (): void => void window.api.meetings.storage().then(setStorage, () => undefined)
  useEffect(() => {
    const get = <T,>(key: string): Promise<T | null> => window.api.app.getSetting<T>(key).catch(() => null)
    void Promise.all([get('meetings.model'), get('meetings.language'), get('meetings.keepOriginal'), get('meetings.deleteAfterDays'), get('meetings.defaultSystem'), get('meetings.consentReminder')]).then(
      ([model, language, keep, days, system, consent]) =>
        setValues({
          model: isWhisperModel(model) ? model : DEFAULTS.model,
          language: isMeetingLanguage(language) ? language : DEFAULTS.language,
          keepOriginal: keep === true,
          deleteAfterDays: (DELETE_AFTER_DAYS as readonly unknown[]).includes(days) ? (days as number) : 0,
          defaultSystem: system !== false,
          consentReminder: consent !== false
        })
    )
    loadStorage()
  }, [])

  const save = <K extends keyof Values>(key: K, value: Values[K]): void => {
    setValues((current) => ({ ...current, [key]: value }))
    window.api.app
      .setSetting(`meetings.${key}`, value)
      .then(() => {
        if (key === 'model') engine.refresh()
      })
      .catch((error: unknown) => notifyError('The setting could not be saved.', error))
  }
  const pick = (which: 'pickProgram' | 'pickModel'): void => void window.api.meetings.engine[which]().then(engine.set, (error: unknown) => notifyError('The file could not be chosen.', error))
  const remove = (): void =>
    void window.api.meetings.engine.remove().then(
      (next) => {
        engine.set(next)
        loadStorage()
      },
      (error: unknown) => notifyError('The engine could not be removed.', error)
    )

  const ready = status?.state === 'ready'
  const installed = !!status?.program || !!status?.model
  const engineHelp = !status
    ? 'Checking…'
    : ready
      ? `whisper.cpp ${status.program?.version ?? ''}${status.program?.managed ? '' : ' (chosen by you)'}, ${status.model?.id ? `${status.model.id} model` : 'a model you chose'}${status.model ? `, ${formatBytes(status.model.bytes)}` : ''}.`
      : status.state === 'missing-model'
        ? 'The program is here, but there is no speech model yet.'
        : status.canDownload
          ? 'Not installed. Meetings can be recorded; they are transcribed once this is set up.'
          : 'sel cannot download the program for this system. Choose one you installed.'
  const wantedMissing = ready && status.model?.managed && status.model.id !== values.model

  return (
    <div className="settings2-scroll">
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Transcription</h3>
        </div>
        <div className="ap-list">
          <Row label="Engine" help={engine.message ?? engineHelp} error={!!engine.message}>
            {status?.canDownload && !ready ? (
              <Button variant="primary" disabled={download !== null} onClick={() => openMeetingSetup(null)}>
                Download…
              </Button>
            ) : null}
            <Button disabled={download !== null} onClick={() => pick('pickProgram')}>
              Choose program…
            </Button>
            <Button disabled={download !== null} onClick={() => pick('pickModel')}>
              Choose model…
            </Button>
            {installed ? <ConfirmButton label="Remove" confirmLabel="Remove the program and models" onConfirm={remove} /> : null}
          </Row>
          {status?.program ? <Row label="Program" help={status.program.path} /> : null}
          {status?.model ? <Row label="Model file" help={status.model.path} /> : null}
          <Row label="Model" help={wantedMissing ? 'This model is not downloaded yet. Until it is, the one that is here is used.' : 'Larger models are more accurate and slower. All of them understand many languages.'}>
            <select className="ap-field mt-select" value={values.model} aria-label="Model" onChange={(event) => save('model', event.target.value as WhisperModelId)}>
              {WHISPER_MODELS.map((id) => (
                <option key={id} value={id}>
                  {WHISPER_MODEL_LABELS[id]}
                  {status ? ` (${formatBytes(status.offer.models[id])})` : ''}
                </option>
              ))}
            </select>
            {wantedMissing && status.canDownload ? (
              <Button disabled={download !== null} onClick={() => openMeetingSetup(null)}>
                Download…
              </Button>
            ) : null}
          </Row>
          <Row label="Language" help="The language spoken in your meetings. Detecting it works well when a meeting is in one language.">
            <select className="ap-field mt-select" value={values.language} aria-label="Language" onChange={(event) => save('language', event.target.value as MeetingLanguage)}>
              {MEETING_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {MEETING_LANGUAGE_LABELS[language]}
                </option>
              ))}
            </select>
          </Row>
        </div>
        {download && <DownloadProgress download={download} onCancel={() => void window.api.meetings.engine.cancelDownload()} />}
        <p className="ap-note">Transcription runs on this computer with whisper.cpp. Audio is never uploaded. The download of the program and a model is the only time this feature goes online.</p>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Recording</h3>
        </div>
        <div className="ap-list">
          <Row label="Computer audio" help="Record what the computer plays, next to your microphone, when a recording starts.">
            <Segmented label="Computer audio" value={values.defaultSystem ? 'on' : 'off'} options={ON_OFF} onChange={(value) => save('defaultSystem', value === 'on')} />
          </Row>
          <Row label="Reminder before recording" help="“Make sure everyone in the meeting knows it is being recorded.”">
            <Segmented label="Reminder before recording" value={values.consentReminder ? 'on' : 'off'} options={ON_OFF} onChange={(value) => save('consentReminder', value === 'on')} />
          </Row>
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Storage</h3>
        </div>
        <div className="ap-list">
          <Row label="Keep original audio" help="The uncompressed recording (about 115 MB an hour for each input). Off keeps only the compact copy once a meeting is transcribed.">
            <Segmented label="Keep original audio" value={values.keepOriginal ? 'on' : 'off'} options={ON_OFF} onChange={(value) => save('keepOriginal', value === 'on')} />
          </Row>
          <Row label="Delete audio" help="Transcripts and notes are pages and are never deleted by this.">
            <select className="ap-field mt-select" value={values.deleteAfterDays} aria-label="Delete audio" onChange={(event) => save('deleteAfterDays', Number(event.target.value))}>
              {DELETE_AFTER_DAYS.map((days) => (
                <option key={days} value={days}>
                  {DAYS_LABELS[days]}
                </option>
              ))}
            </select>
          </Row>
          <Row
            label="Recordings"
            help={
              storage
                ? `${formatBytes(storage.bytes)} in ${storage.meetings} ${storage.meetings === 1 ? 'meeting' : 'meetings'}${storage.engineBytes > 0 ? `; the program and models take ${formatBytes(storage.engineBytes)}` : ''}.`
                : 'Measuring…'
            }
          >
            <Button onClick={() => void window.api.meetings.openFolder().catch((error: unknown) => notifyError('The folder could not be opened.', error))}>Open recordings folder</Button>
          </Row>
        </div>
        <p className="ap-note">Recordings stay in this folder on this computer. They are not part of sync.</p>
      </section>
    </div>
  )
}
