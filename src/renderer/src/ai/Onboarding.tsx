// The persona's introduction (0.8.0 A1): a short sheet in five steps, said by the persona itself
// beside its figure. (1) Claude Code and the model, (2) Herman or Hermine and the outfit, with the
// figure changing as you choose, (3) a few questions that draft the context, shown and editable
// before it is saved after what is already there, (4) pages to pin, the ones you come back to,
// never a private one, (5) the user's own tools, read only. Every step can be skipped, and the
// whole of it: skipped, nothing changes. No AI is called in here.
// Opened by itself once (gate.ts `maybeOnboard`), and again from Settings → AI or the palette.
import { useEffect, useId, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { AI_MODEL_RE } from '@shared/ai'
import {
  AI_CONTEXT_CAPS,
  AI_CONTEXT_KEY,
  AI_MCP_SERVERS_KEY,
  mcpChoices,
  type ClaudeServer,
  type ClaudeServerList,
  type McpChoices
} from '@shared/aiContext'
import { PERSONA_NAMES, type PersonaId } from '@shared/herman'
import { TASKS_DATABASE_ID } from '@shared/tasks'
import type { Block } from '@shared/types'
import { Segmented } from '@/appearance/controls'
import { useHome } from '@/home/store'
import { useHerman } from '@/herman/gate'
import { Herman64 } from '@/herman/Herman64'
import { everydaySkins, PERSONA_OPTIONS, saveHermanSetting, SkinChoice, WARDROBES } from '@/herman/wardrobe'
import { pageTitle } from '@/shell/actions'
import { fetchBlocks, getBlock, useBlock } from '@/store/blocks'
import { ROUTINE_IDS, type RoutineId } from '@shared/routines'
import { enableRoutines, loadRoutineSettings } from '@/routines/settings'
import { useUi } from '@/store/ui'
import { Button, IconButton } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import { Close } from '@/ui/icons'
import { notifyError, toast } from '@/ui/toast'
import { closeOnboarding, refreshAiStatus, toggleContextPage, useAiGate } from './gate'
import { INSTALL_COMMAND } from './labels'
import { ONBOARDING_COPY, ONBOARDING_STEPS, onboardingCopy, type OnboardingCopy } from './onboardingCopy'
import {
  composeContext,
  EMPTY_ANSWERS,
  mergeContext,
  rankPages,
  suggestedProjects,
  type AnswerLanguage,
  type AnswerLength,
  type AnswerTone,
  type ContextAnswers
} from './onboardingDraft'
import { aiPrivacyNow, loadAncestors } from './privacy'
import '@/appearance/appearance.css'
import './ai.css'

const OTHER: Record<PersonaId, PersonaId> = { herman: 'hermine', hermine: 'herman' }
const MODELS = ['opus', 'sonnet', 'haiku'] as const

export function Onboarding(): JSX.Element {
  const locale = useHome((state) => state.locale)
  const persona = useHerman((state) => state.persona)
  const copy = useMemo(() => onboardingCopy(locale, persona), [locale, persona])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<ContextAnswers>(EMPTY_ANSWERS)
  /** The draft as the user changed it; null while it follows the answers. */
  const [edited, setEdited] = useState<string | null>(null)
  /** The context already written (Settings → AI → Context); null until read. */
  const [existing, setExisting] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const titleId = useId()
  const step = ONBOARDING_STEPS[index]
  const last = index === ONBOARDING_STEPS.length - 1

  useEffect(() => {
    let alive = true
    window.api.app.getSetting<unknown>(AI_CONTEXT_KEY).then(
      (value) => {
        if (alive) setExisting(typeof value === 'string' ? value : '')
      },
      (error: unknown) => {
        console.error('the AI context failed to load', error)
        if (alive) setExisting('')
      }
    )
    return () => {
      alive = false
    }
  }, [])

  const draft = edited ?? composeContext(answers, locale)
  const merged = mergeContext(existing ?? '', draft)

  const next = (): void => {
    if (last) {
      closeOnboarding()
      toast(copy.done, { kind: 'success', duration: 3200 })
    } else setIndex(index + 1)
  }

  /** The third step's main button: the context is saved after what was there, then on. */
  const saveContext = (): void => {
    if (existing === null || !merged.fits) return
    if (!merged.changed) {
      if (draft.trim()) toast(copy.contextSame, { duration: 2400 })
      next()
      return
    }
    setSaving(true)
    window.api.app
      .setSetting(AI_CONTEXT_KEY, merged.text)
      .then(
        () => {
          setExisting(merged.text)
          setEdited(null)
          setAnswers(EMPTY_ANSWERS)
          toast(copy.contextSaved, { kind: 'success', duration: 2000 })
          next()
        },
        (error: unknown) => notifyError(copy.saveFailed, error)
      )
      .finally(() => setSaving(false))
  }

  // Said by the persona; the line naming the other one is taken as written, its names as they are.
  const speech = step === 'persona' ? ONBOARDING_COPY[locale].say.persona(PERSONA_NAMES[OTHER[persona]]) : copy.say[step]
  const aboutReady = step === 'about' && draft.trim() !== '' && existing !== null

  return (
    <Modal open onClose={closeOnboarding} labelledBy={titleId} className="ai-setup ai-onboarding">
      <header className="ai-setup-head">
        <h2 id={titleId}>{copy.title}</h2>
        <IconButton label={copy.skipAll} tooltip={false} onClick={closeOnboarding}>
          <Close />
        </IconButton>
      </header>
      <ol className="ai-onboarding-steps" aria-label={copy.stepOf(index + 1, ONBOARDING_STEPS.length)}>
        {ONBOARDING_STEPS.map((name, at) => (
          <li
            key={name}
            className={at === index ? 'is-current' : at < index ? 'is-past' : undefined}
            aria-current={at === index ? 'step' : undefined}
          >
            {copy.stepNames[name]}
          </li>
        ))}
      </ol>
      <div className="ai-onboarding-body" lang={locale}>
        <div className="ai-onboarding-persona">
          <Herman64 pose={step === 'claude' ? 'listening' : 'resting'} className="ai-onboarding-figure" />
          <p className="ai-onboarding-speech" aria-live="polite">
            {speech}
          </p>
        </div>
        <section className="ai-onboarding-step" aria-label={copy.stepNames[step]}>
          {step === 'claude' && <ClaudeStep copy={copy} />}
          {step === 'persona' && <PersonaStep copy={copy} />}
          {step === 'about' && (
            <AboutStep
              copy={copy}
              answers={answers}
              onAnswers={(change) => {
                setAnswers((current) => ({ ...current, ...change }))
                setEdited(null)
              }}
              draft={draft}
              onDraft={setEdited}
              existing={existing ?? ''}
              fits={merged.fits}
            />
          )}
          {step === 'pages' && <PagesStep copy={copy} />}
          {step === 'tools' && <ToolsStep copy={copy} />}
        </section>
      </div>
      <footer className="ai-setup-foot ai-onboarding-foot">
        <span className="ai-onboarding-count">{copy.stepOf(index + 1, ONBOARDING_STEPS.length)}</span>
        {index > 0 && <Button onClick={() => setIndex(index - 1)}>{copy.back}</Button>}
        {!last && (
          <Button variant="ghost" onClick={next}>
            {copy.skipStep}
          </Button>
        )}
        {aboutReady ? (
          <Button variant="primary" disabled={saving || !merged.fits} onClick={saveContext}>
            {copy.saveContext}
          </Button>
        ) : (
          <Button variant="primary" onClick={next}>
            {last ? copy.finish : copy.next}
          </Button>
        )}
      </footer>
    </Modal>
  )
}

// ---- 1. Claude Code ----------------------------------------------------------------

function ClaudeStep({ copy }: { copy: OnboardingCopy }): JSX.Element {
  const status = useAiGate((state) => state.status)
  const [busy, setBusy] = useState(true)
  const [model, setModel] = useState<string | null>(null)

  const check = (): void => {
    setBusy(true)
    refreshAiStatus(true)
      .catch((error: unknown) => notifyError(copy.checkFailed, error))
      .finally(() => setBusy(false))
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the step shows
  useEffect(() => {
    check()
    let alive = true
    window.api.app.getSetting<unknown>('ai.model').then(
      (value) => {
        if (alive) setModel(typeof value === 'string' && AI_MODEL_RE.test(value) ? value : '')
      },
      () => {
        if (alive) setModel('')
      }
    )
    return () => {
      alive = false
    }
  }, [])

  const pick = (): void => {
    window.api.ai.pickCli().then(
      (next) => {
        if (next) useAiGate.setState({ status: next })
      },
      (error: unknown) => notifyError(copy.checkFailed, error)
    )
  }

  const chooseModel = (value: string): void => {
    const previous = model
    setModel(value)
    window.api.app.setSetting('ai.model', value || null).catch((error: unknown) => {
      setModel(previous)
      notifyError(copy.saveFailed, error)
    })
  }

  const found = status?.available === true
  const models = model && !(MODELS as readonly string[]).includes(model) ? [...MODELS, model] : [...MODELS]
  return (
    <div className="ai-onboarding-fields">
      <p className={found || busy ? 'ai-onboarding-status' : 'ai-onboarding-status is-error'} role="status">
        {busy && !found ? copy.checking : found ? copy.ready(status.version ?? '') : copy.notFound}
      </p>
      {!busy && !found && (
        <>
          <p className="ai-step-help">{copy.install}</p>
          <div className="ai-command">
            <code>{INSTALL_COMMAND}</code>
          </div>
          <p className="ai-step-help">{copy.signIn}</p>
          <div className="ai-onboarding-row">
            <Button onClick={pick}>{copy.choose}</Button>
            <Button onClick={check}>{copy.checkAgain}</Button>
          </div>
        </>
      )}
      <label className="ai-onboarding-field">
        <span className="ai-onboarding-label">{copy.model}</span>
        <select
          className="ap-field ai-select"
          value={model ?? ''}
          disabled={model === null}
          onChange={(event) => chooseModel(event.target.value)}
        >
          <option value="">{copy.modelDefault}</option>
          {models.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="ai-step-help">{copy.modelHelp}</span>
      </label>
    </div>
  )
}

// ---- 2. Persona and outfit -----------------------------------------------------------

function PersonaStep({ copy }: { copy: OnboardingCopy }): JSX.Element {
  const persona = useHerman((state) => state.persona)
  const worn = useHerman((state) => (state.persona === 'hermine' ? state.hermineSkin : state.skin))
  const failed = (error: unknown): void => notifyError(copy.saveFailed, error)
  const wear = (skin: string): void => {
    const saved = persona === 'hermine' ? saveHermanSetting('hermineSkin', skin as never) : saveHermanSetting('skin', skin as never)
    saved.catch(failed)
  }
  return (
    <div className="ai-onboarding-fields">
      <div className="ai-onboarding-field">
        <span className="ai-onboarding-label">{copy.persona}</span>
        <Segmented
          label={copy.persona}
          value={persona}
          options={PERSONA_OPTIONS}
          onChange={(value) => saveHermanSetting('persona', value).catch(failed)}
        />
      </div>
      <div className="ai-onboarding-field">
        <span className="ai-onboarding-label">{copy.outfit}</span>
        <div className="herman-skins ai-onboarding-skins" role="group" aria-label={copy.outfit}>
          {everydaySkins(persona).map((skin) => (
            <SkinChoice
              key={`${persona}:${skin}`}
              persona={persona}
              skin={skin}
              label={WARDROBES[persona].labels[skin] ?? skin}
              chosen={worn === skin}
              onChoose={() => wear(skin)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- 3. About you: the context --------------------------------------------------------

function Choice<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T | null
  options: Record<T | 'any', string>
  onChange: (value: T | null) => void
}): JSX.Element {
  const list = Object.entries(options).map(([key, text]) => ({ value: key as T | 'any', label: text as string }))
  return (
    <div className="ai-onboarding-field is-inline">
      <span className="ai-onboarding-label">{label}</span>
      <Segmented label={label} value={value ?? 'any'} options={list} onChange={(next) => onChange(next === 'any' ? null : (next as T))} />
    </div>
  )
}

function AboutStep({
  copy,
  answers,
  onAnswers,
  draft,
  onDraft,
  existing,
  fits
}: {
  copy: OnboardingCopy
  answers: ContextAnswers
  onAnswers: (change: Partial<ContextAnswers>) => void
  draft: string
  onDraft: (text: string) => void
  existing: string
  fits: boolean
}): JSX.Element {
  const tasks = useBlock(TASKS_DATABASE_ID)
  const projects = suggestedProjects(tasks)
  const ids = { who: useId(), work: useId(), other: useId(), draft: useId(), help: useId() }
  const toggleProject = (name: string, on: boolean): void =>
    onAnswers({ projects: on ? [...answers.projects, name] : answers.projects.filter((entry) => entry !== name) })
  return (
    <div className="ai-onboarding-fields">
      <div className="ai-onboarding-field">
        <label className="ai-onboarding-label" htmlFor={ids.who}>
          {copy.who}
        </label>
        <input
          id={ids.who}
          className="ap-field"
          value={answers.who}
          maxLength={300}
          placeholder={copy.whoHint}
          onChange={(event) => onAnswers({ who: event.target.value })}
        />
      </div>
      <div className="ai-onboarding-field">
        <label className="ai-onboarding-label" htmlFor={ids.work}>
          {copy.work}
        </label>
        <input
          id={ids.work}
          className="ap-field"
          value={answers.work}
          maxLength={600}
          placeholder={copy.workHint}
          onChange={(event) => onAnswers({ work: event.target.value })}
        />
      </div>
      <fieldset className="ai-onboarding-field ai-onboarding-projects">
        <legend className="ai-onboarding-label">{copy.projects}</legend>
        <span className="ai-step-help">{projects.length ? copy.projectsHelp : copy.projectsNone}</span>
        {projects.length > 0 && (
          <div className="ai-onboarding-chips">
            {projects.map((name) => (
              <label key={name} className="ai-onboarding-chip">
                <input
                  type="checkbox"
                  checked={answers.projects.includes(name)}
                  onChange={(event) => toggleProject(name, event.target.checked)}
                />
                <span>{name}</span>
              </label>
            ))}
          </div>
        )}
        <label className="ai-step-help" htmlFor={ids.other}>
          {copy.otherProjects}
        </label>
        <input
          id={ids.other}
          className="ap-field"
          value={answers.otherProjects}
          maxLength={600}
          placeholder={copy.otherProjectsHint}
          onChange={(event) => onAnswers({ otherProjects: event.target.value })}
        />
      </fieldset>
      <Choice<Exclude<AnswerLength, null>>
        label={copy.length}
        value={answers.length}
        options={copy.lengths}
        onChange={(length) => onAnswers({ length })}
      />
      <Choice<Exclude<AnswerLanguage, null>>
        label={copy.language}
        value={answers.language}
        options={copy.languages}
        onChange={(language) => onAnswers({ language })}
      />
      <Choice<Exclude<AnswerTone, null>>
        label={copy.tone}
        value={answers.tone}
        options={copy.tones}
        onChange={(tone) => onAnswers({ tone })}
      />
      <div className="ai-onboarding-field">
        <label className="ai-onboarding-label" htmlFor={ids.draft}>
          {copy.draft}
        </label>
        <textarea
          id={ids.draft}
          className="ap-field ai-onboarding-draft"
          rows={5}
          value={draft}
          maxLength={AI_CONTEXT_CAPS.text}
          placeholder={copy.draftEmpty}
          aria-describedby={ids.help}
          onChange={(event) => onDraft(event.target.value)}
        />
        <span id={ids.help} className={fits ? 'ai-step-help' : 'ai-step-help is-error'}>
          {!fits ? copy.tooLong(AI_CONTEXT_CAPS.text) : existing.trim() ? copy.draftAfter(existing.trim().length) : copy.draftNew}
        </span>
      </div>
    </div>
  )
}

// ---- 4. Pages to pin --------------------------------------------------------------------

const SUGGEST_DAYS = 90
const isPinnable = (block: Block | undefined): boolean =>
  !!block && block.trashedAt === null && (block.type === 'page' || block.type === 'database')

/** The pages to offer: the pinned ones first, then those you come back to and edit most; never a private one. */
async function suggestPages(pinned: readonly string[]): Promise<string[]> {
  const [summary, recent] = await Promise.all([
    window.api.activity.summary({ from: Date.now() - SUGGEST_DAYS * 86_400_000 }).catch(() => null),
    fetchBlocks(() => window.api.pages.listRecent(20)).catch(() => [] as Block[])
  ])
  const returning = summary?.returning ?? []
  const wanted = [...new Set([...pinned, ...returning.map((entry) => entry.pageId)])].filter((id) => !getBlock(id))
  if (wanted.length) await fetchBlocks(() => window.api.blocks.getMany(wanted)).catch(() => [])
  const candidates = [...new Set([...returning.map((entry) => entry.pageId), ...recent.map((block) => block.id)])]
  // A mark on a page above one shows only once those are loaded.
  await Promise.all(candidates.map((id) => loadAncestors(id)))
  const others = rankPages(
    returning,
    recent.map((block) => block.id),
    (id) => pinned.includes(id) || !isPinnable(getBlock(id)) || aiPrivacyNow(id) !== null
  )
  return [...pinned.filter((id) => isPinnable(getBlock(id))), ...others]
}

function PagesStep({ copy }: { copy: OnboardingCopy }): JSX.Element {
  const pinned = useAiGate((state) => state.contextPages)
  const [ids, setIds] = useState<string[] | null>(null)

  // The list is made once; pinning changes only the ticks.
  useEffect(() => {
    let alive = true
    suggestPages(useAiGate.getState().contextPages).then(
      (found) => {
        if (alive) setIds(found)
      },
      (error: unknown) => {
        console.error('ai: pages to suggest could not be read', error)
        if (alive) setIds([])
      }
    )
    return () => {
      alive = false
    }
  }, [])

  const toggle = (id: string): void => {
    toggleContextPage(id).then(
      (result) => {
        if (result === 'full') toast(copy.pinFull(AI_CONTEXT_CAPS.pages))
        else if (result === 'private') toast(copy.pinPrivate)
      },
      (error: unknown) => notifyError(copy.pinFailed, error)
    )
  }

  return (
    <div className="ai-onboarding-fields">
      <span className="ai-onboarding-label">{copy.suggested}</span>
      <span className="ai-step-help">{copy.suggestedHelp(AI_CONTEXT_CAPS.pages)}</span>
      {ids === null ? (
        <span className="ai-step-help">{copy.loading}</span>
      ) : ids.length === 0 ? (
        <span className="ai-step-help">{copy.noSuggestions}</span>
      ) : (
        <ul className="ai-onboarding-list">
          {ids.map((id) => (
            <PageChoice key={id} id={id} pinned={pinned.includes(id)} onToggle={() => toggle(id)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PageChoice({ id, pinned, onToggle }: { id: string; pinned: boolean; onToggle: () => void }): JSX.Element | null {
  const block = useBlock(id)
  if (!block) return null
  return (
    <li>
      <label className="ai-onboarding-check">
        <input type="checkbox" checked={pinned} onChange={onToggle} />
        <span>{pageTitle(block)}</span>
      </label>
    </li>
  )
}

// ---- 5. The user's own tools --------------------------------------------------------------

function serverName(server: ClaudeServer): string {
  return server.scope === 'claudeai' ? server.name.replace(/^claude\.ai /, '') : server.name
}

function ToolsStep({ copy }: { copy: OnboardingCopy }): JSX.Element {
  const [list, setList] = useState<ClaudeServerList | null>(null)
  const [choices, setChoices] = useState<McpChoices>({})
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([window.api.ai.servers(), window.api.app.getSetting<unknown>(AI_MCP_SERVERS_KEY)]).then(
      ([servers, stored]) => {
        if (!alive) return
        setList(servers)
        setChoices(mcpChoices(stored))
      },
      (error: unknown) => {
        if (alive) setList({ servers: [], connectorsAt: null })
        notifyError(copy.serversFailed, error)
      }
    )
    return () => {
      alive = false
    }
  }, [copy.serversFailed])

  /** On: read only (a server already on keeps how much it may do). Off: off. */
  const toggle = (id: string, on: boolean): void => {
    const previous = choices
    const next = { ...choices }
    if (on) next[id] = choices[id] ?? { access: 'read' }
    else delete next[id]
    setChoices(next)
    window.api.app.setSetting(AI_MCP_SERVERS_KEY, Object.keys(next).length ? next : null).catch((error: unknown) => {
      setChoices(previous)
      notifyError(copy.serversFailed, error)
    })
  }

  const scan = (): void => {
    setScanning(true)
    window.api.ai
      .scanServers()
      .then(setList, (error: unknown) => notifyError(copy.scanFailed, error))
      .finally(() => setScanning(false))
  }

  const openSettings = (): void => {
    closeOnboarding()
    useUi.setState({ settingsOpen: true, settingsSection: 'ai' })
  }

  const servers = list?.servers ?? []
  return (
    <div className="ai-onboarding-fields">
      <span className="ai-step-help">{copy.serversHelp}</span>
      {list === null ? (
        <span className="ai-step-help">{copy.loading}</span>
      ) : servers.length === 0 ? (
        <span className="ai-step-help">{copy.noServers}</span>
      ) : (
        <ul className="ai-onboarding-list">
          {servers.map((server) => (
            <li key={server.id}>
              <label className="ai-onboarding-check">
                <input
                  type="checkbox"
                  checked={choices[server.id] !== undefined}
                  onChange={(event) => toggle(server.id, event.target.checked)}
                />
                <span>{serverName(server)}</span>
                <span className="ai-step-help">{choices[server.id]?.access === 'read' ? copy.readOnly : server.detail}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="ai-onboarding-row">
        <Button disabled={scanning} onClick={scan}>
          {scanning ? copy.scanning : copy.scan}
        </Button>
        <Button variant="ghost" onClick={openSettings}>
          {copy.openSettings}
        </Button>
      </div>
      <RoutinesChoice copy={copy} />
    </div>
  )
}

/** The routines (0.8.0 C1), each off until ticked here; Settings → AI → Routines has the rest. */
function RoutinesChoice({ copy }: { copy: OnboardingCopy }): JSX.Element {
  const [on, setOn] = useState<Partial<Record<RoutineId, boolean>> | null>(null)
  useEffect(() => {
    let alive = true
    loadRoutineSettings().then(
      (settings) => {
        if (alive) setOn(Object.fromEntries(ROUTINE_IDS.map((id) => [id, settings.routines[id].on])))
      },
      () => {
        if (alive) setOn({})
      }
    )
    return () => {
      alive = false
    }
  }, [])
  const toggle = (id: RoutineId, value: boolean): void => {
    setOn((current) => ({ ...current, [id]: value }))
    enableRoutines([id], value).catch((error: unknown) => notifyError(copy.routinesTitle, error))
  }
  return (
    <fieldset className="ai-onboarding-routines">
      <legend>{copy.routinesTitle}</legend>
      <span className="ai-step-help">{copy.routinesHelp}</span>
      <ul className="ai-onboarding-list">
        {ROUTINE_IDS.map((id) => (
          <li key={id}>
            <label className="ai-onboarding-check">
              <input
                type="checkbox"
                disabled={on === null}
                checked={on?.[id] === true}
                onChange={(event) => toggle(id, event.target.checked)}
              />
              <span>{copy.routineNames[id]}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}
