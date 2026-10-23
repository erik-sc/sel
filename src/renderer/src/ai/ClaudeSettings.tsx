// Settings → AI → Context and Claude's tools. Part of the AI section's chunk.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { isAiLanguage } from '@shared/ai'
import {
  AI_CONTEXT_CAPS,
  AI_CONTEXT_KEY,
  AI_MCP_SERVERS_KEY,
  allowedToolNames,
  isReadTool,
  MCP_ACCESS,
  mcpChoices,
  type ClaudeServer,
  type ClaudeServerList,
  type McpAccess,
  type McpChoice,
  type McpChoices
} from '@shared/aiContext'
import { Segmented } from '@/appearance/controls'
import { homeLocale, type HomeLocale } from '@/home/copy'
import { pageTitle } from '@/shell/actions'
import { useBlock, useBlockStatus } from '@/store/blocks'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'
import { contextCopy, type ContextCopy } from './contextCopy'
import { setContextPages, useAiGate } from './gate'
import { useHerman } from '@/herman/gate'

/** The language of these settings: the one set for AI answers when it is one of the two, else the system's. */
function useLocale(): HomeLocale {
  const [locale, setLocale] = useState<HomeLocale>(() => homeLocale(null, navigator.language))
  useEffect(() => {
    let alive = true
    window.api.app.getSetting<unknown>('ai.language').then(
      (language) => {
        if (alive) setLocale(homeLocale(isAiLanguage(language) ? language : null, navigator.language))
      },
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [])
  return locale
}

export function ClaudeSettings({ enabled }: { enabled: boolean }): JSX.Element {
  const locale = useLocale()
  const persona = useHerman((state) => state.persona)
  const copy = useMemo(() => contextCopy(locale, persona), [locale, persona])
  return (
    <div lang={locale}>
      <ContextGroup copy={copy} enabled={enabled} />
      <ToolsGroup copy={copy} enabled={enabled} locale={locale} />
    </div>
  )
}

// ---- context ----------------------------------------------------------------------

function ContextGroup({ copy, enabled }: { copy: ContextCopy; enabled: boolean }): JSX.Element {
  const [stored, setStored] = useState('')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const pinned = useAiGate((state) => state.contextPages)

  useEffect(() => {
    let alive = true
    window.api.app.getSetting<unknown>(AI_CONTEXT_KEY).then(
      (value) => {
        if (!alive || typeof value !== 'string') return
        setStored(value)
        setText(value)
      },
      (error: unknown) => console.error('the AI context failed to load', error)
    )
    return () => {
      alive = false
    }
  }, [])

  const save = (): void => {
    const next = text.slice(0, AI_CONTEXT_CAPS.text)
    setSaving(true)
    window.api.app
      .setSetting(AI_CONTEXT_KEY, next.trim() ? next : null)
      .then(
        () => {
          setStored(next)
          toast(copy.saved, { kind: 'success', duration: 2000 })
        },
        (error: unknown) => notifyError(copy.saveFailed, error)
      )
      .finally(() => setSaving(false))
  }

  const unpin = (id: string): void => {
    setContextPages(pinned.filter((entry) => entry !== id)).catch((error: unknown) => notifyError(copy.saveFailed, error))
  }

  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">{copy.contextTitle}</h3>
      </div>
      <p className="ap-note claude-intro">{copy.contextIntro}</p>
      <div className="ap-list">
        <div className="ap-row is-stacked">
          <div className="ap-row-text">
            <span className="ap-row-label">{copy.contextLabel}</span>
            <span className="ap-row-help">{copy.contextHelp}</span>
          </div>
          <div className="ap-row-control claude-context-control">
            <textarea
              className="ap-field claude-context"
              value={text}
              maxLength={AI_CONTEXT_CAPS.text}
              rows={8}
              placeholder={copy.contextPlaceholder}
              aria-label={copy.contextLabel}
              disabled={!enabled}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  save()
                }
              }}
            />
            <div className="claude-context-bar">
              <span className="ap-row-help">{copy.contextCount(text.length, AI_CONTEXT_CAPS.text)}</span>
              <Button disabled={!enabled || saving || text === stored} onClick={save}>
                {copy.save}
              </Button>
            </div>
          </div>
        </div>
        <div className="ap-row is-stacked">
          <div className="ap-row-text">
            <span className="ap-row-label">{copy.pinnedLabel}</span>
            <span className="ap-row-help">{copy.pinnedHelp(AI_CONTEXT_CAPS.pages)}</span>
          </div>
          <div className="ap-row-control claude-pinned">
            {pinned.length === 0 ? (
              <span className="ap-row-help">{copy.pinnedNone}</span>
            ) : (
              <ul className="claude-pinned-list">
                {pinned.map((id) => (
                  <PinnedPage key={id} id={id} copy={copy} onUnpin={() => unpin(id)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <p className="ap-note">{copy.contextNote}</p>
    </section>
  )
}

function PinnedPage({ id, copy, onUnpin }: { id: string; copy: ContextCopy; onUnpin: () => void }): JSX.Element {
  const block = useBlock(id)
  const status = useBlockStatus(id)
  const gone = (!block && status === 'missing') || Boolean(block?.trashedAt)
  return (
    <li className="claude-pinned-item">
      <span className={gone ? 'ap-row-help is-error' : 'claude-pinned-title'}>
        {gone ? copy.missingPage : block ? pageTitle(block) : '…'}
      </span>
      <Button variant="ghost" onClick={onUnpin}>
        {copy.unpin}
      </Button>
    </li>
  )
}

// ---- Claude's tools ----------------------------------------------------------------

function when(at: number, locale: HomeLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

function ToolsGroup({ copy, enabled, locale }: { copy: ContextCopy; enabled: boolean; locale: HomeLocale }): JSX.Element {
  const [list, setList] = useState<ClaudeServerList | null>(null)
  const [choices, setChoices] = useState<McpChoices>({})
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  const load = useCallback((): void => {
    Promise.all([window.api.ai.servers(), window.api.app.getSetting<unknown>(AI_MCP_SERVERS_KEY)]).then(
      ([servers, stored]) => {
        setList(servers)
        setChoices(mcpChoices(stored))
      },
      (error: unknown) => notifyError(copy.loadFailed, error)
    )
  }, [copy.loadFailed])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

  /** Stores the new choices; the old ones come back if they could not be stored. */
  const store = (next: McpChoices): void => {
    const previous = choices
    setChoices(next)
    window.api.app.setSetting(AI_MCP_SERVERS_KEY, Object.keys(next).length ? next : null).catch((error: unknown) => {
      setChoices(previous)
      notifyError(copy.saveFailed, error)
    })
  }

  const choose = (id: string, choice: McpChoice | null): void => {
    const next = { ...choices }
    if (choice) next[id] = choice
    else delete next[id]
    store(next)
  }

  const scan = (): void => {
    setScanning(true)
    window.api.ai
      .scanServers()
      .then(setList, (error: unknown) => notifyError(copy.scanFailed, error))
      .finally(() => setScanning(false))
  }

  const loadTools = (id: string): void => {
    setLoading(id)
    window.api.ai
      .serverTools(id)
      .then(setList, (error: unknown) => notifyError(copy.toolsFailed, error))
      .finally(() => setLoading(null))
  }

  const servers = list?.servers ?? []
  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">{copy.toolsTitle}</h3>
      </div>
      <p className="ap-note claude-intro">{copy.toolsIntro}</p>
      <p className="ap-note claude-warning" role="note">
        {copy.toolsWarning}
      </p>
      <div className="ap-list">
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-help">{copy.scanHelp(list?.connectorsAt ? when(list.connectorsAt, locale) : null)}</span>
            {list?.error && <span className="ap-row-help is-error">{copy.unreadable}</span>}
          </div>
          <div className="ap-row-control">
            <Button disabled={!enabled || scanning} onClick={scan}>
              {scanning ? copy.scanning : copy.scan}
            </Button>
          </div>
        </div>
        {list && servers.length === 0 && (
          <div className="ap-row">
            <span className="ap-row-help">{copy.noServers}</span>
          </div>
        )}
        {servers.map((server) => (
          <ServerRow
            key={server.id}
            server={server}
            choice={choices[server.id] ?? null}
            copy={copy}
            enabled={enabled}
            loading={loading === server.id}
            onChoose={(choice) => choose(server.id, choice)}
            onLoadTools={() => loadTools(server.id)}
          />
        ))}
      </div>
      <p className="ap-note">{copy.toolsNote}</p>
    </section>
  )
}

function ServerRow({
  server,
  choice,
  copy,
  enabled,
  loading,
  onChoose,
  onLoadTools
}: {
  server: ClaudeServer
  choice: McpChoice | null
  copy: ContextCopy
  enabled: boolean
  loading: boolean
  onChoose: (choice: McpChoice | null) => void
  onLoadTools: () => void
}): JSX.Element {
  const on = choice !== null
  const found = server.tools ?? []
  const known = server.tools !== undefined
  const allowed = choice ? allowedToolNames(choice, found) : []
  const label = server.scope === 'claudeai' ? server.name.replace(/^claude\.ai /, '') : server.name
  const where = [copy.scope[server.scope], server.detail, server.project].filter(Boolean).join(' · ')
  const access = MCP_ACCESS.map((value) => ({ value, label: copy.access[value] }))
  const setAccess = (value: McpAccess): void =>
    onChoose(value === 'custom' ? { access: value, tools: allowedToolNames(choice ?? { access: 'read' }, found) } : { access: value })
  const toggleTool = (tool: string, checked: boolean): void => {
    const current = choice?.tools ?? []
    onChoose({ access: 'custom', tools: checked ? [...current, tool] : current.filter((entry) => entry !== tool) })
  }
  return (
    <div className="ap-row is-stacked claude-server">
      <div className="ap-row-text">
        <span className="ap-row-label">{label}</span>
        <span className="ap-row-help">{where}</span>
      </div>
      <div className="ap-row-control">
        <Segmented
          label={label}
          value={on ? 'on' : 'off'}
          options={[
            { value: 'off', label: copy.off },
            { value: 'on', label: copy.on }
          ]}
          onChange={(value) => onChoose(value === 'on' ? { access: 'read' } : null)}
        />
      </div>
      {on && choice && (
        <div className="claude-server-detail">
          <div className="claude-server-access">
            <Segmented label={`${label}: ${copy.toolsTitle}`} value={choice.access} options={access} onChange={setAccess} />
            <Button disabled={!enabled || loading} onClick={onLoadTools}>
              {loading ? copy.loadingTools : copy.loadTools}
            </Button>
          </div>
          <span className="ap-row-help">{copy.accessHelp[choice.access]}</span>
          {choice.access === 'all' && <span className="ap-row-help claude-warning-text">{copy.allWarning}</span>}
          {known ? (
            <span className="ap-row-help">{copy.toolsCount(choice.access === 'all' ? found.length : allowed.length, found.length)}</span>
          ) : (
            choice.access !== 'all' && <span className="ap-row-help is-error">{copy.toolsUnknown}</span>
          )}
          {choice.access !== 'all' && found.length > 0 && (
            <ul className="claude-tools">
              {found.map((tool) => (
                <li key={tool}>
                  <label>
                    <input
                      type="checkbox"
                      checked={allowed.includes(tool)}
                      disabled={!enabled || choice.access === 'read'}
                      onChange={(event) => toggleTool(tool, event.target.checked)}
                    />
                    <code>{tool}</code>
                    {!isReadTool(tool) && <span className="claude-tool-write">{copy.writeTool}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
