import { useCallback, useEffect, useId, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Button, IconButton } from '@/ui/Button'
import { Popover } from '@/ui/Popover'
import { Undo } from '@/ui/icons'
import { formatColor, parseColor, toHex } from './color'
import type { Rgba } from './color'
import { formatNumeric, isNumericKind, parseNumeric } from './sanitize'
import { TOKENS, defaultValue } from './schema'
import type { ThemeName, TokenDef } from './schema'
import { resetToken, setToken, useAppearance } from './store'

/** Returns true when the value was accepted and applied. */
type Commit = (value: string) => boolean

// ---- shared pieces ----

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="ap-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'is-selected' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A button that asks for a second click before acting. */
export function ConfirmButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <Button
      variant={armed ? 'danger' : 'ghost'}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) onConfirm()
        setArmed(!armed)
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  )
}

/**
 * Text being typed into a field that only commits valid input. Invalid text stays in the field,
 * marked, while the applied value keeps its last valid state; leaving the field restores it.
 */
function useDraft(value: string, commit: Commit, same: (text: string, value: string) => boolean = sameText) {
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    // The applied value changed (this field, a reset, a preset, another window).
    setSeen(value)
    if (!same(text, value)) {
      setText(value)
      setInvalid(false)
    }
  }
  return {
    value: text,
    'aria-invalid': invalid || undefined,
    invalidClass: invalid ? ' is-invalid' : '',
    onChange: (event: ChangeEvent<HTMLInputElement>): void => {
      const next = event.target.value
      setText(next)
      setInvalid(!commit(next))
    },
    onBlur: (): void => {
      if (invalid || !same(text, value)) setText(value)
      setInvalid(false)
    }
  }
}

function sameText(text: string, value: string): boolean {
  return text.trim() === value
}

function TextField({
  value,
  commit,
  label,
  className = '',
  list,
  same,
  onFocus
}: {
  value: string
  commit: Commit
  label: string
  className?: string
  list?: string
  same?: (text: string, value: string) => boolean
  onFocus?: () => void
}) {
  const { invalidClass, ...draft } = useDraft(value, commit, same)
  return (
    <input
      type="text"
      className={`ap-field${className ? ` ${className}` : ''}${invalidClass}`}
      aria-label={label}
      spellCheck={false}
      autoComplete="off"
      list={list}
      onFocus={onFocus}
      {...draft}
    />
  )
}

// ---- colour ----

let canvas: CanvasRenderingContext2D | null = null

/** Lets the browser resolve colours the parser does not know (names, oklch(), color-mix()…). */
function resolveCssColor(value: string): Rgba | null {
  try {
    canvas ??= document.createElement('canvas').getContext('2d')
    if (!canvas) return null
    canvas.fillStyle = '#000001'
    canvas.fillStyle = value
    const resolved = String(canvas.fillStyle)
    return resolved === '#000001' ? null : parseColor(resolved)
  } catch {
    return null
  }
}

function ColorPicker({ value, commit }: { value: string; commit: Commit }) {
  const rgba = parseColor(value) ?? resolveCssColor(value)
  if (!rgba) return <div className="ap-caption">This colour can only be edited as text.</div>
  const hex = toHex(rgba)
  const percent = Math.round(rgba.a * 100)
  return (
    <>
      <label className="ap-picker-line">
        <span>Colour</span>
        <input
          type="color"
          className="ap-picker-native"
          value={hex}
          onChange={(event) => {
            const next = parseColor(event.target.value)
            if (next) commit(formatColor({ ...next, a: rgba.a }))
          }}
        />
        <TextField
          label="Hex"
          value={hex}
          same={(text, current) => {
            const typed = parseColor(text.trim().startsWith('#') ? text : `#${text.trim()}`)
            return !!typed && toHex(typed) === current
          }}
          commit={(text) => {
            const trimmed = text.trim().replace(/^#?/, '#')
            const next = parseColor(trimmed)
            if (!next) return false
            // 4 and 8 digit hex carry their own alpha; otherwise the current alpha is kept.
            const ownAlpha = trimmed.length === 5 || trimmed.length === 9
            return commit(formatColor(ownAlpha ? next : { ...next, a: rgba.a }))
          }}
        />
      </label>
      <label className="ap-picker-line">
        <span>Opacity</span>
        <input
          type="range"
          className="ap-slider"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(event) => commit(formatColor({ ...rgba, a: Number(event.target.value) / 100 }))}
        />
        <span className="ap-picker-alpha">{percent}%</span>
      </label>
    </>
  )
}

function ColorControl({ token, value, commit }: ControlProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <TextField label={`${token.label} value`} value={value} commit={commit} />
      <button
        type="button"
        className="ap-swatch"
        aria-label={`Pick ${token.label.toLowerCase()}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <span style={{ background: value }} />
      </button>
      <Popover anchor={anchor} open={!!anchor} onClose={() => setAnchor(null)} placement="bottom-end" className="ap-picker">
        <ColorPicker value={value} commit={commit} />
      </Popover>
    </>
  )
}

// ---- numbers ----

function NumberControl({ token, value, commit }: ControlProps) {
  const min = token.min ?? 0
  const max = token.max ?? 100
  const n = parseNumeric(token, value) ?? parseNumeric(token, token.light) ?? min
  const commitNumber = (x: number): boolean => commit(formatNumeric(token, x))
  return (
    <>
      <input
        type="range"
        className="ap-slider"
        aria-label={token.label}
        min={min}
        max={max}
        step={token.step ?? 1}
        value={Math.min(max, Math.max(min, n))}
        onChange={(event) => commitNumber(Number(event.target.value))}
      />
      <TextField
        label={`${token.label} value`}
        className="is-number"
        value={String(n)}
        same={(text, current) => text.trim() !== '' && Number(text) === Number(current)}
        commit={(text) => {
          const x = Number(text)
          if (text.trim() === '' || !Number.isFinite(x) || x < min || x > max) return false
          return commitNumber(x)
        }}
      />
      <span className="ap-unit">{token.unit ?? ''}</span>
    </>
  )
}

// ---- fonts ----

const FONT_SUGGESTIONS = [
  ...TOKENS.filter((token) => token.kind === 'font').map((token) => token.light),
  'system-ui, sans-serif',
  "Inter, 'Segoe UI', system-ui, sans-serif",
  "'Segoe UI', system-ui, sans-serif",
  "'Helvetica Neue', Helvetica, Arial, sans-serif",
  'ui-rounded, system-ui, sans-serif',
  "Georgia, 'Times New Roman', serif",
  "'Iowan Old Style', 'Palatino Linotype', Palatino, serif",
  "'Cascadia Code', Consolas, monospace",
  "'JetBrains Mono', ui-monospace, monospace",
  'ui-monospace, Menlo, Consolas, monospace'
]

const MAX_LOCAL_FONTS = 400
let localFonts: Promise<string[]> | null = null

/** Installed font families, when the platform exposes them and the user allows it. */
function loadLocalFonts(): Promise<string[]> {
  localFonts ??= (async () => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (typeof query !== 'function') return []
    try {
      const fonts = await query.call(window)
      const families = new Set<string>()
      for (const font of fonts) {
        if (typeof font.family === 'string' && /^[^'"\\;{}()<>]{1,80}$/.test(font.family)) families.add(font.family)
      }
      return [...families].sort((a, b) => a.localeCompare(b)).slice(0, MAX_LOCAL_FONTS)
    } catch {
      return []
    }
  })()
  return localFonts
}

function fallbackFor(token: TokenDef): string {
  if (token.name.includes('mono')) return 'monospace'
  if (token.name.includes('serif')) return 'serif'
  return 'sans-serif'
}

function FontControl({ token, value, commit }: ControlProps) {
  const listId = useId()
  const [families, setFamilies] = useState<string[]>([])
  const load = useCallback(() => {
    let live = true
    void loadLocalFonts().then((found) => {
      if (live) setFamilies(found)
    })
    return () => {
      live = false
    }
  }, [])
  const fallback = fallbackFor(token)
  return (
    <>
      <TextField label={token.label} className="is-wide" value={value} commit={commit} list={listId} onFocus={load} />
      <datalist id={listId}>
        {FONT_SUGGESTIONS.map((stack) => (
          <option key={stack} value={stack} />
        ))}
        {families.map((family) => (
          <option key={`local:${family}`} value={`'${family}', ${fallback}`} />
        ))}
      </datalist>
    </>
  )
}

// ---- image ----

function ImageControl({ token, value, commit }: ControlProps) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const hasImage = value !== 'none'
  const choose = (): void => {
    setState('busy')
    window.api.files
      .pickImage()
      .then((url) => setState(!url || commit(`url("${url}")`) ? 'idle' : 'failed'))
      .catch((error) => {
        console.error('could not pick image', error)
        setState('failed')
      })
  }
  return (
    <>
      {state === 'failed' && <span className="ap-row-help is-error">That image could not be used.</span>}
      {hasImage && <span className="ap-thumb" style={{ backgroundImage: value }} aria-hidden="true" />}
      <Button disabled={state === 'busy'} onClick={choose} aria-label={`Choose ${token.label.toLowerCase()}`}>
        Choose image…
      </Button>
      {hasImage && <Button onClick={() => commit('none')}>Remove</Button>}
    </>
  )
}

// ---- row ----

interface ControlProps {
  token: TokenDef
  value: string
  commit: Commit
}

function controlFor(props: ControlProps): ReactNode {
  const { token } = props
  if (token.kind === 'color') return <ColorControl {...props} />
  if (isNumericKind(token)) return <NumberControl {...props} />
  if (token.kind === 'font') return <FontControl {...props} />
  if (token.kind === 'image') return <ImageControl {...props} />
  // shadow, easing, text: free text, checked with CSS.supports before it is applied
  return <TextField label={props.token.label} className="is-wide" value={props.value} commit={props.commit} />
}

const STACKED: ReadonlySet<TokenDef['kind']> = new Set(['font', 'shadow', 'easing', 'text'])

export function TokenRow({ token, scope }: { token: TokenDef; scope: ThemeName }) {
  const override = useAppearance((state) => (token.themed ? state[scope][token.name] : state.shared[token.name]))
  const value = override ?? defaultValue(token, scope)
  const commit = useCallback<Commit>((next) => setToken(token.name, next, scope), [token.name, scope])
  const modified = override !== undefined
  const classes = ['ap-row']
  if (modified) classes.push('is-modified')
  if (STACKED.has(token.kind)) classes.push('is-stacked')
  return (
    <div className={classes.join(' ')}>
      <div className="ap-row-text">
        <span className="ap-row-label">{token.label}</span>
        <span className="ap-row-name">{token.name}</span>
        {token.description && <span className="ap-row-help">{token.description}</span>}
      </div>
      {STACKED.has(token.kind) && <ResetButton token={token} scope={scope} modified={modified} />}
      <div className="ap-row-control">{controlFor({ token, value, commit })}</div>
      {!STACKED.has(token.kind) && <ResetButton token={token} scope={scope} modified={modified} />}
    </div>
  )
}

function ResetButton({ token, scope, modified }: { token: TokenDef; scope: ThemeName; modified: boolean }) {
  return (
    <IconButton
      label="Reset to default"
      size="small"
      className={modified ? 'ap-reset' : 'ap-reset is-hidden'}
      disabled={!modified}
      onClick={() => resetToken(token.name, scope)}
    >
      <Undo />
    </IconButton>
  )
}
