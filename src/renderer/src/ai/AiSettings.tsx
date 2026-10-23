// Settings → AI. Part of the settings window's chunk.
import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import {
  AI_DEFAULTS,
  AI_LANGUAGES,
  AI_LANGUAGE_LABELS,
  AI_MODEL_RE,
  AI_TIMEOUT_LIMITS,
  isAiLanguage,
  type AiLanguage,
  type AiStatus
} from '@shared/ai'
import { Segmented } from '@/appearance/controls'
import { Button } from '@/ui/Button'
import { notifyError } from '@/ui/toast'
import { refreshAiStatus, setAiEnabled, useAiGate } from './gate'
import { ClaudeSettings } from './ClaudeSettings'
import { HistorySettings } from './HistorySettings'
import { RoutinesSettings } from '@/routines/RoutinesSettings'
import '@/routines/routines.css'
import { INSTALL_COMMAND, unavailableText } from './labels'
import './ai.css'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

interface Values {
  model: string
  language: AiLanguage | 'auto'
  timeoutSec: number
  /** Whether a program was chosen by hand (`ai.cliPath`). */
  chosen: boolean
}

function save(key: string, value: unknown): Promise<void> {
  return window.api.app.setSetting(key, value)
}

export function AiSection(): JSX.Element {
  const enabled = useAiGate((state) => state.enabled)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [values, setValues] = useState<Values>({ model: '', language: 'auto', timeoutSec: AI_DEFAULTS.timeoutSec, chosen: false })
  const [model, setModel] = useState('')
  const [timeout, setTimeoutText] = useState(String(AI_DEFAULTS.timeoutSec))
  const modelInvalid = model.trim() !== '' && !AI_MODEL_RE.test(model.trim())

  const check = useCallback((refresh: boolean): void => {
    setChecking(true)
    refreshAiStatus(refresh)
      .then(setStatus)
      .catch((error: unknown) => notifyError('Could not check for Claude Code.', error))
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all((['ai.model', 'ai.language', 'ai.timeoutSec', 'ai.cliPath'] as const).map((key) => window.api.app.getSetting<unknown>(key)))
      .then(([storedModel, language, seconds, path]) => {
        if (!alive) return
        const next: Values = {
          model: typeof storedModel === 'string' ? storedModel : '',
          language: isAiLanguage(language) ? language : 'auto',
          timeoutSec: typeof seconds === 'number' ? seconds : AI_DEFAULTS.timeoutSec,
          chosen: typeof path === 'string' && path !== ''
        }
        setValues(next)
        setModel(next.model)
        setTimeoutText(String(next.timeoutSec))
      })
      .catch((error: unknown) => console.error('ai settings failed to load', error))
    check(false)
    return () => {
      alive = false
    }
  }, [check])

  const failed = (error: unknown): void => notifyError('The setting could not be saved.', error)

  const toggle = (on: boolean): void => {
    setAiEnabled(on)
    save('ai.enabled', on).then(
      () => check(true),
      (error: unknown) => {
        setAiEnabled(!on)
        failed(error)
      }
    )
  }

  const commitModel = (): void => {
    const next = model.trim()
    if (next === values.model) return
    if (next && !AI_MODEL_RE.test(next)) return
    save('ai.model', next || null).then(() => setValues((current) => ({ ...current, model: next })), failed)
  }

  const commitTimeout = (): void => {
    const parsed = Number.parseInt(timeout, 10)
    if (!Number.isFinite(parsed)) {
      setTimeoutText(String(values.timeoutSec))
      return
    }
    const next = Math.min(AI_TIMEOUT_LIMITS.max, Math.max(AI_TIMEOUT_LIMITS.min, parsed))
    setTimeoutText(String(next))
    if (next !== values.timeoutSec)
      save('ai.timeoutSec', next).then(() => setValues((current) => ({ ...current, timeoutSec: next })), failed)
  }

  const setLanguage = (language: AiLanguage | 'auto'): void => {
    const previous = values.language
    setValues((current) => ({ ...current, language }))
    save('ai.language', language === 'auto' ? null : language).catch((error: unknown) => {
      setValues((current) => ({ ...current, language: previous }))
      failed(error)
    })
  }

  const choose = (): void => {
    window.api.ai.pickCli().then(
      (next) => {
        if (!next) return
        setStatus(next)
        useAiGate.setState({ status: next })
        if (next.available) setValues((current) => ({ ...current, chosen: true }))
      },
      (error: unknown) => notifyError('Could not choose the program.', error)
    )
  }

  const reset = (): void => {
    save('ai.cliPath', null).then(() => {
      setValues((current) => ({ ...current, chosen: false }))
      check(true)
    }, failed)
  }

  const found = status?.available
  const programHelp = !enabled
    ? 'Turned off.'
    : checking && !status
      ? 'Looking for Claude Code…'
      : found
        ? `Version ${status.version ?? 'unknown'}${values.chosen ? ', chosen by you' : ', found automatically'}`
        : unavailableText(status)

  return (
    <div className="settings2-scroll">
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">AI</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">AI features</span>
              <span className="ap-row-help">Summaries, writing help and the assistant. When off, nothing AI appears anywhere in sel.</span>
            </div>
            <div className="ap-row-control">
              <Segmented label="AI features" value={enabled ? 'on' : 'off'} options={ON_OFF} onChange={(value) => toggle(value === 'on')} />
            </div>
          </div>
        </div>
        <p className="ap-note">
          sel uses the Claude Code app on this computer, signed in with your own Claude account. No key is stored in sel, and nothing is
          sent by sel itself.
        </p>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Claude Code</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Program</span>
              <span className={found || !enabled || (checking && !status) ? 'ap-row-help' : 'ap-row-help is-error'}>{programHelp}</span>
              {found && status.path && <span className="ap-row-name ai-path">{status.path}</span>}
            </div>
            <div className="ap-row-control">
              {values.chosen && (
                <Button variant="ghost" disabled={!enabled} onClick={reset}>
                  Reset
                </Button>
              )}
              <Button disabled={!enabled} onClick={choose}>
                Choose…
              </Button>
              <Button disabled={!enabled || checking} onClick={() => check(true)}>
                {checking ? 'Checking…' : 'Check again'}
              </Button>
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Model</span>
              <span className={modelInvalid ? 'ap-row-help is-error' : 'ap-row-help'}>
                {modelInvalid
                  ? 'Letters, digits, dots and dashes only.'
                  : 'A model name or alias, such as opus or sonnet. Empty uses the default of Claude Code.'}
              </span>
            </div>
            <div className="ap-row-control">
              <input
                className={modelInvalid ? 'ap-field is-invalid' : 'ap-field'}
                value={model}
                maxLength={64}
                spellCheck={false}
                placeholder="default"
                aria-label="Model"
                aria-invalid={modelInvalid}
                disabled={!enabled}
                onChange={(event) => setModel(event.target.value)}
                onBlur={commitModel}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitModel()
                  }
                }}
              />
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Language</span>
              <span className="ap-row-help">For summaries, answers and new text. Rewrites keep the language of the text.</span>
            </div>
            <div className="ap-row-control">
              <select
                className="ap-field ai-select"
                value={values.language}
                aria-label="Language"
                disabled={!enabled}
                onChange={(event) => setLanguage(event.target.value as AiLanguage | 'auto')}
              >
                <option value="auto">Same as the content</option>
                {AI_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {AI_LANGUAGE_LABELS[language]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Give up after</span>
              <span className="ap-row-help">A request that takes longer is stopped.</span>
            </div>
            <div className="ap-row-control">
              <input
                className="ap-field is-number"
                inputMode="numeric"
                aria-label="Give up after, in seconds"
                value={timeout}
                disabled={!enabled}
                onChange={(event) => setTimeoutText(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                onBlur={commitTimeout}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitTimeout()
                  }
                }}
              />
              <span className="ap-unit">s</span>
            </div>
          </div>
        </div>
        {enabled && status && !found && status.reason !== 'disabled' && (
          <p className="ap-note">
            To install it, run <code className="ai-code">{INSTALL_COMMAND}</code> in a terminal, then run{' '}
            <code className="ai-code">claude</code> once to sign in.
          </p>
        )}
      </section>

      <ClaudeSettings enabled={enabled} />
      <RoutinesSettings enabled={enabled} />
      <HistorySettings />
    </div>
  )
}
