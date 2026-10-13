import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { resolveTheme, useUi } from '@/store/ui'
import { Button } from '@/ui/Button'
import { Database, Page, Search, Star } from '@/ui/icons'
import { notifyError } from '@/ui/toast'
import './appearance.css'
import { ConfirmButton, Segmented, TokenRow } from './controls'
import { PRESETS, PRESET_MAP } from './presets'
import type { Preset } from './presets'
import { countOverrides, sanitizeAppearance, sanitizeCustomCss } from './sanitize'
import type { AppearanceData } from './sanitize'
import { GROUPS, TOKENS, TOKEN_MAP, defaultValue } from './schema'
import type { ThemeName, TokenDef, TokenGroup } from './schema'
import {
  MAX_IMPORT_LENGTH,
  applyPreset,
  exportJson,
  importJson,
  resetAll,
  resetGroup,
  setCustomCss,
  useAppearance
} from './store'

const SCOPES: { value: ThemeName; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const groupId = (group: TokenGroup): string => `ap-group-${group.toLowerCase().replace(/[^a-z]+/g, '-')}`

function groupCount(state: AppearanceData, group: TokenGroup, scope: ThemeName): number {
  let count = 0
  for (const token of TOKENS) {
    if (token.group !== group) continue
    if ((token.themed ? state[scope] : state.shared)[token.name] !== undefined) count += 1
  }
  return count
}

const changes = (count: number): string => `${count} changed`

export function AppearancePanel() {
  const userTheme = useUi((state) => state.theme)
  const [scope, setScope] = useState<ThemeName>(() => resolveTheme(useUi.getState().theme))
  const [query, setQuery] = useState('')
  const total = useAppearance(countOverrides)

  // Follow the user's theme when it changes underneath the panel (menu command, OS setting aside).
  useEffect(() => setScope(resolveTheme(userTheme)), [userTheme])

  // Editing a theme previews it; the user's own choice comes back when the panel closes.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = scope
    return () => {
      document.documentElement.dataset.theme = resolveTheme(useUi.getState().theme)
    }
  }, [scope])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return GROUPS.map((group) => ({
      group,
      tokens: TOKENS.filter(
        (token) =>
          token.group === group &&
          (!needle ||
            token.label.toLowerCase().includes(needle) ||
            token.name.includes(needle) ||
            group.toLowerCase().includes(needle))
      )
    })).filter((entry) => entry.tokens.length > 0)
  }, [query])

  const searching = query.trim() !== ''

  return (
    <div className="ap-panel">
      <div className="ap-head">
        <div className="ap-toolbar">
          <label className="ap-search">
            <Search />
            <input
              type="search"
              placeholder="Search styles"
              aria-label="Search styles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="ap-caption">Editing</span>
          <Segmented label="Theme being edited" value={scope} options={SCOPES} onChange={setScope} />
          <div className="ap-toolbar-end">
            {total > 0 && <span className="ap-badge">{changes(total)}</span>}
            {total > 0 && <ConfirmButton label="Reset all" confirmLabel="Reset everything?" onConfirm={resetAll} />}
          </div>
        </div>
        <Preview />
        <nav className="ap-chips" aria-label="Style groups">
          {groups.map(({ group }) => (
            <GroupChip key={group} group={group} scope={scope} />
          ))}
        </nav>
      </div>

      <div className="ap-scroll">
        {!searching && <PresetGallery scope={scope} />}
        {groups.map(({ group, tokens }) => (
          <GroupSection key={group} group={group} tokens={tokens} scope={scope} />
        ))}
        {groups.length === 0 && <div className="ap-empty">No styles match “{query.trim()}”.</div>}
        {!searching && <ThemeFile />}
        {!searching && <CustomCss />}
      </div>
    </div>
  )
}

// ---- preview ----

function Preview() {
  return (
    <div className="ap-preview ap-wall" inert aria-hidden="true">
      <div className="ap-preview-sidebar">
        <div className="ap-preview-row is-active">
          <Page /> Notes
        </div>
        <div className="ap-preview-row is-hover">
          <Database /> Projects
        </div>
        <div className="ap-preview-row is-muted">
          <Star /> Favourites
        </div>
      </div>
      <div className="ap-preview-sheet">
        <div className="ap-preview-title">Weekly plan</div>
        <p className="ap-preview-text">
          Body text with a <a>link</a>, some <code>code</code> and <mark>a selection</mark>.
        </p>
        <p className="ap-preview-secondary">
          Secondary text · <span>tertiary text</span>
        </p>
        <div className="ap-preview-line">
          <span className="ap-preview-tag is-blue">Design</span>
          <span className="ap-preview-tag is-green">Done</span>
          <span className="ap-preview-tag is-orange">Later</span>
          <Button variant="primary" tabIndex={-1}>
            Save
          </Button>
          <Button tabIndex={-1}>Cancel</Button>
        </div>
      </div>
      <div className="ap-preview-card">
        <strong>Reading list</strong>
        <span>3 of 5 pages</span>
        <i />
      </div>
    </div>
  )
}

// ---- presets ----

const THUMB_TOKENS = [
  '--wall-base',
  '--wall-1',
  '--wall-2',
  '--wall-3',
  '--wall-4',
  '--wall-intensity',
  '--glass-bg',
  '--glass-border',
  '--bg',
  '--accent',
  '--text',
  '--text-tertiary',
  '--border'
]

/** Re-scopes the tokens a thumbnail draws with to the preset's own values. */
function thumbStyle(preset: Preset, scope: ThemeName): CSSProperties {
  const style: Record<string, string> = { '--wall-image': 'none' }
  for (const name of THUMB_TOKENS) {
    const token = TOKEN_MAP[name]
    style[name] = (token.themed ? preset[scope] : preset.shared)[name] ?? defaultValue(token, scope)
  }
  return style as CSSProperties
}

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/**
 * The preset the saved overrides amount to today. The saved presetId alone does not say:
 * presets are overrides on the defaults, so settings saved under other defaults (a preset
 * picked before Zen became the default look) no longer add up to the preset they name.
 */
function selectedPreset(state: AppearanceData): string | null {
  if (countOverrides(state) === 0) return PRESETS[0].id
  const preset = state.presetId === null ? undefined : PRESET_MAP[state.presetId]
  if (!preset) return null
  const expected = sanitizeAppearance(preset)
  const same = (['light', 'dark', 'shared'] as const).every((bucket) => sameMap(state[bucket], expected[bucket]))
  return same ? preset.id : null
}

function PresetGallery({ scope }: { scope: ThemeName }) {
  const selected = useAppearance(selectedPreset)
  return (
    <section className="ap-group" aria-label="Presets">
      <div className="ap-group-head">
        <h3 className="ap-group-title">Presets</h3>
      </div>
      <div className="ap-presets">
        {PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className={preset.id === selected ? 'ap-preset is-selected' : 'ap-preset'}
            aria-pressed={preset.id === selected}
            title={preset.description}
            onClick={() => applyPreset(preset.id)}
          >
            <span className="ap-preset-thumb ap-wall" style={thumbStyle(preset, scope)}>
              <span className="ap-preset-side" />
              <span className="ap-preset-sheet">
                <i />
                <i />
                <i />
              </span>
            </span>
            <span className="ap-preset-name">{preset.name}</span>
          </button>
        ))}
      </div>
      <p className="ap-note">Choosing a preset replaces your changes in both themes. Custom CSS is kept.</p>
    </section>
  )
}

// ---- groups ----

function GroupChip({ group, scope }: { group: TokenGroup; scope: ThemeName }) {
  const modified = useAppearance((state) => groupCount(state, group, scope) > 0)
  return (
    <button
      type="button"
      className={modified ? 'ap-chip is-modified' : 'ap-chip'}
      onClick={() => document.getElementById(groupId(group))?.scrollIntoView({ block: 'start' })}
    >
      {group}
    </button>
  )
}

function GroupSection({ group, tokens, scope }: { group: TokenGroup; tokens: TokenDef[]; scope: ThemeName }) {
  const count = useAppearance((state) => groupCount(state, group, scope))
  return (
    <section className="ap-group" id={groupId(group)} aria-label={group}>
      <div className="ap-group-head">
        <h3 className="ap-group-title">{group}</h3>
        {count > 0 && (
          <div className="ap-group-end">
            <span className="ap-badge">{changes(count)}</span>
            <ConfirmButton label="Reset" confirmLabel="Reset group?" onConfirm={() => resetGroup(group, scope)} />
          </div>
        )}
      </div>
      <div className="ap-list">
        {tokens.map((token) => (
          <TokenRow key={token.name} token={token} scope={scope} />
        ))}
      </div>
    </section>
  )
}

// ---- export / import ----

/** How long the exported file's blob: url stays alive for the download to start. */
const REVOKE_DELAY = 10_000

function ThemeFile() {
  const input = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  const download = (): void => {
    try {
      // A blob: url of our own making; nothing leaves the machine.
      const url = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'selida-theme.json'
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY)
    } catch (error) {
      notifyError('The theme could not be exported.', error)
    }
  }

  const read = (file: File | undefined): void => {
    if (!file) return
    // Checked before reading, so that a huge file is never pulled into memory.
    if (file.size > MAX_IMPORT_LENGTH) {
      setMessage({ text: 'The file is too large to be a theme.', error: true })
      return
    }
    file
      .text()
      .then((text) => {
        const result = importJson(text)
        setMessage(
          result.ok
            ? { text: `Imported ${file.name}.`, error: false }
            : { text: result.error ?? 'The theme could not be imported.', error: true }
        )
      })
      .catch(() => setMessage({ text: 'The file could not be read.', error: true }))
  }

  return (
    <section className="ap-group" aria-label="Theme file">
      <div className="ap-group-head">
        <h3 className="ap-group-title">Theme file</h3>
      </div>
      <div className="ap-list">
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">Share or back up this look</span>
            <span className={message?.error ? 'ap-row-help is-error' : 'ap-row-help'} role="status">
              {message?.text ?? 'A theme file holds your changes for both themes and your custom CSS.'}
            </span>
          </div>
          <div className="ap-row-control ap-actions">
            <Button onClick={download}>Export theme…</Button>
            <Button onClick={() => input.current?.click()}>Import theme…</Button>
            <input
              ref={input}
              type="file"
              accept="application/json,.json"
              className="ap-hidden-input"
              tabIndex={-1}
              onChange={(event) => {
                read(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

// ---- custom css ----

const CSS_DELAY = 400

function CustomCss() {
  const saved = useAppearance((state) => state.customCss)
  const [text, setText] = useState(saved)
  const [seen, setSeen] = useState(saved)
  const pending = useRef(false)
  // What the text in the field becomes when it is applied.
  const applied = useMemo(() => sanitizeCustomCss(text), [text])
  if (seen !== saved) {
    setSeen(saved)
    // Changed elsewhere (import, another window): show it. When it is just the applied form
    // of what is in the field, the field is left alone, so that nothing is rewritten under
    // the cursor while a rule is half typed.
    if (!pending.current && applied !== saved) setText(saved)
  }
  // A textarea holds plain newlines only, so any difference is something the policy removed.
  const filtered = applied !== text

  useEffect(() => {
    if (!pending.current) return
    const timer = setTimeout(() => {
      pending.current = false
      setCustomCss(text)
    }, CSS_DELAY)
    return () => clearTimeout(timer)
  }, [text])

  // Do not lose the last keystrokes when the panel closes before the delay runs out.
  const latest = useRef(text)
  latest.current = text
  useEffect(
    () => () => {
      if (pending.current) setCustomCss(latest.current)
    },
    []
  )

  return (
    <section className="ap-group" aria-label="Custom CSS">
      <div className="ap-group-head">
        <h3 className="ap-group-title">Custom CSS</h3>
      </div>
      <textarea
        className="ap-css"
        aria-label="Custom CSS"
        spellCheck={false}
        placeholder=".sidebar { letter-spacing: 0; }"
        value={text}
        onChange={(event) => {
          pending.current = true
          setText(event.target.value)
        }}
      />
      <p className={filtered ? 'ap-note is-error' : 'ap-note'} role="status">
        {filtered
          ? 'Some of this is not applied: @import, and url() pointing anywhere but an image stored in the app, are removed.'
          : 'Applied after everything else, so it can override any style. @import and remote url() are not allowed.'}
      </p>
    </section>
  )
}
