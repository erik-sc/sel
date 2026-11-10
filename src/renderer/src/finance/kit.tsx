// What the Finance and household screens share: how a month is loaded and kept current, how an
// amount is written, the month's arrows, a meter and a small form field. Loaded with the screens,
// never at start-up.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { HomeLocale } from '@/home/copy'
import { notifyError, toast } from '@/ui/toast'

const pad = (n: number): string => String(n).padStart(2, '0')

export function thisMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

export function shiftMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad((index % 12) + 1)}`
}

const tag = (locale: HomeLocale): string => (locale === 'pt-BR' ? 'pt-BR' : 'en-GB')

/** "novembro de 2026", "November 2026". */
export function monthName(month: string, locale: HomeLocale): string {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString(tag(locale), {
    month: 'long',
    year: 'numeric'
  })
}

/** "10/11" or "10 Nov". */
export function dayName(day: string, locale: HomeLocale): string {
  const date = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
  return date.toLocaleDateString(tag(locale), { day: '2-digit', month: locale === 'pt-BR' ? '2-digit' : 'short' })
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** "R$ 1.234,56": the blocks keep reais, whatever language the window speaks. */
export const money = (amount: number): string => BRL.format(amount).replace(/ /gu, ' ')

/**
 * A month from the main process, kept current: asked again when the month changes, and (a moment
 * after) whenever anything in the workspace changes, here or in another window or app. What was
 * shown stays until the new answer comes.
 */
export function useMonthData<T>(
  load: (month: string) => Promise<T>,
  month: string
): { data: T | null; failed: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const latest = useRef(0)
  const reload = useCallback(() => {
    const turn = ++latest.current
    load(month)
      .then((answer) => {
        if (turn !== latest.current) return
        setData(answer ?? null)
        setFailed(false)
      })
      .catch((error: unknown) => {
        if (turn !== latest.current) return
        console.error('[finance] the month could not be read', error)
        setFailed(true)
      })
  }, [load, month])
  useEffect(() => {
    reload()
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(reload, 150)
    })
    return () => {
      if (timer) clearTimeout(timer)
      if (typeof off === 'function') off()
      latest.current++
    }
  }, [reload])
  return { data, failed, reload }
}

/** Runs one of the blocks' tools. True when it worked; a failure is said in a toast, in the tool's own words. */
export async function runTool(tool: string, args: Record<string, unknown>, failed: string, done?: string): Promise<boolean> {
  try {
    await window.api.finance.run(tool, args)
    if (done) toast(done, { kind: 'success' })
    return true
  } catch (error) {
    notifyError(failed, error)
    return false
  }
}

/** What a form holds, without the fields left empty. */
export function filled(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && value !== undefined && value !== null))
}

export function MonthNav({
  month,
  locale,
  onChange,
  labels
}: {
  month: string
  locale: HomeLocale
  onChange: (month: string) => void
  labels: { previous: string; next: string; current: string }
}): JSX.Element {
  const now = thisMonth()
  return (
    <div className="fin-month" role="group" aria-label={monthName(month, locale)}>
      <button type="button" className="fin-month-step" aria-label={labels.previous} onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </button>
      <span className="fin-month-name" aria-live="polite">
        {monthName(month, locale)}
      </span>
      <button type="button" className="fin-month-step" aria-label={labels.next} onClick={() => onChange(shiftMonth(month, 1))}>
        ›
      </button>
      {month !== now && (
        <button type="button" className="fin-month-now" onClick={() => onChange(now)}>
          {labels.current}
        </button>
      )}
    </div>
  )
}

/** A line of ink for how much of something was used: over the limit it says so in words, not in red alone. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }): JSX.Element {
  const part = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <span className={value > max && max > 0 ? 'fin-meter is-over' : 'fin-meter'} role="img" aria-label={label}>
      <span className="fin-meter-fill" style={{ width: `${Math.round(part * 100)}%` }} />
    </span>
  )
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="fin-section">
      <div className="fin-section-head">
        <h2 className="fin-label">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export interface FieldSpec {
  name: string
  label: string
  /** `amount` and `text` are typed; `day` and `percent` are whole numbers; `choice` picks one of `options`. */
  kind: 'text' | 'amount' | 'day' | 'percent' | 'date' | 'choice'
  options?: readonly { value: string; label: string }[]
  /** Names to offer while typing. */
  suggestions?: readonly string[]
  required?: boolean
  placeholder?: string
}

/** One labelled field of a form. */
export function Field({
  spec,
  value,
  onChange,
  id
}: {
  spec: FieldSpec
  value: string
  onChange: (value: string) => void
  id: string
}): JSX.Element {
  const listId = spec.suggestions?.length ? `${id}-list` : undefined
  return (
    <label className="fin-field" htmlFor={id}>
      <span className="fin-field-label">{spec.label}</span>
      {spec.kind === 'choice' ? (
        <select id={id} className="ui-input" value={value} onChange={(event) => onChange(event.target.value)}>
          {(spec.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={spec.kind === 'amount' ? 'ui-input fin-amount' : 'ui-input'}
          type={spec.kind === 'date' ? 'date' : spec.kind === 'day' || spec.kind === 'percent' ? 'number' : 'text'}
          inputMode={spec.kind === 'amount' ? 'decimal' : undefined}
          min={spec.kind === 'day' ? 1 : spec.kind === 'percent' ? 0 : undefined}
          max={spec.kind === 'day' ? 31 : spec.kind === 'percent' ? 100 : undefined}
          required={spec.required}
          placeholder={spec.placeholder ?? (spec.kind === 'amount' ? '0,00' : undefined)}
          list={listId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {listId && (
        <datalist id={listId}>
          {(spec.suggestions ?? []).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
    </label>
  )
}

/** What a form's fields hold as a tool's arguments: days and percentages as numbers, the rest as typed. */
export function argsOf(fields: readonly FieldSpec[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const value = (values[field.name] ?? '').trim()
    if (!value) continue
    out[field.name] = field.kind === 'day' || field.kind === 'percent' ? Number(value) : value
  }
  return out
}
