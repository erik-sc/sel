import { useEffect, useMemo, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { ruleText, weekdayName } from '@shared/rrule'
import { parseTask, type TaskRecurrence } from '@shared/tasks/parse'
import {
  defaultForm,
  formOf,
  presetOf,
  presetRule,
  REPEAT_PRESETS,
  ruleOf,
  type RepeatEnd,
  type RepeatForm,
  type RepeatPreset
} from '@shared/tasks/repeat'
import { useHome } from '@/home/store'
import { localeDayFirst } from '@/tasks/addTask'
import * as L from './logic'
import { DATE_COPY } from './dateCopy'

const DAY_FIRST = localeDayFirst()
const FREQS: readonly RepeatForm['freq'][] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
/** Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0]

/** A repeat in words, and how it counts: "every Monday", "toda segunda (a partir da conclusão)". */
export function useRecurrenceWords(): (value: TaskRecurrence) => string {
  const locale = useHome((state) => state.locale)
  return (value) => {
    const words = ruleText(value.rule, locale)
    return value.from === 'completion' ? `${words} (${DATE_COPY[locale].fromCompletionNote})` : words
  }
}

/**
 * How a task repeats: presets anchored on its due date (every day, every weekday, every week on
 * its weekday, every month on its date, every year on its day), a Custom form (every N days /
 * weeks / months / years, on which weekdays, until when), whether it counts from the due date or
 * from the completion, and a field that reads a repeat in words as the quick add does
 * ("toda segunda e quarta", "quinzenal"). The rule is always shown in words.
 */
export function RecurrencePicker({
  value,
  due,
  onChange
}: {
  value: TaskRecurrence | null
  /** The task's due date, which the presets are anchored on; today when it has none. */
  due: string | null
  onChange: (next: TaskRecurrence | null) => void
}): JSX.Element {
  const locale = useHome((state) => state.locale)
  const copy = DATE_COPY[locale]
  const words = useRecurrenceWords()
  const anchor = (due && L.dayKey(due)) || L.todayISO()
  const preset = value ? presetOf(value.rule, anchor) : null
  const form = useMemo(() => (value ? formOf(value.rule) : null), [value])
  const [custom, setCustom] = useState(() => !!value && !preset)
  const [text, setText] = useState('')
  const from = value?.from ?? 'due'
  const typed = useMemo(() => (text.trim() ? parseTask(text, { now: new Date(), dayFirst: DAY_FIRST }).recurrence : null), [text])

  const write = (rule: string, counted: 'due' | 'completion' = from): void =>
    onChange({ rule, from: counted, text: ruleText(rule, locale) })

  const anchorParts = useMemo(() => {
    const [year, month, date] = anchor.split('-').map(Number)
    return { weekday: new Date(Date.UTC(year, month - 1, date)).getUTCDay(), date, month }
  }, [anchor])

  const pick = (choice: RepeatPreset | 'none' | 'custom'): void => {
    if (choice === 'none') {
      setCustom(false)
      onChange(null)
    } else if (choice === 'custom') {
      setCustom(true)
      if (!value) write(ruleOf(defaultForm()))
    } else {
      setCustom(false)
      write(presetRule(choice, anchor))
    }
  }

  const edit = (patch: Partial<RepeatForm>): void => write(ruleOf({ ...(form ?? defaultForm()), ...patch }))

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!typed) return
    // "todo!" / "every!" counts from the completion; otherwise it keeps what was chosen.
    write(typed.rule, typed.from === 'completion' ? 'completion' : from)
    setCustom(!presetOf(typed.rule, anchor))
    setText('')
  }

  const choices: { id: RepeatPreset | 'none' | 'custom'; label: string; pressed: boolean }[] = [
    { id: 'none', label: copy.noRepeat, pressed: !value },
    ...REPEAT_PRESETS.map((id) => ({ id, label: copy.preset(id, anchorParts), pressed: !custom && preset === id })),
    { id: 'custom', label: copy.custom, pressed: !!value && (custom || !preset) }
  ]

  return (
    <div className="db-repeat">
      <div className="db-datepicker-field">
        <input
          className="ui-input db-datepicker-text"
          value={text}
          placeholder={copy.repeatPlaceholder}
          aria-label={copy.repeatLabel}
          spellCheck={false}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onFieldKey}
        />
        {text.trim() && (
          <span className={typed ? 'db-datepicker-preview' : 'db-datepicker-preview is-unknown'} aria-live="polite">
            {typed ? `↵ ${words({ ...typed, text: '' })}` : copy.repeatNotUnderstood}
          </span>
        )}
      </div>

      <div className="db-repeat-choices" role="group" aria-label={copy.repeat}>
        {choices.map((choice) => (
          <button key={choice.id} type="button" className="db-repeat-choice" aria-pressed={choice.pressed} onClick={() => pick(choice.id)}>
            {choice.label}
          </button>
        ))}
      </div>

      {value && (custom || !preset) && (
        <CustomForm form={form} copy={copy} locale={locale} onEdit={edit} onReset={() => write(ruleOf(defaultForm()))} />
      )}

      {value && (
        <>
          <div className="db-repeat-row" role="radiogroup" aria-label={copy.fromLabel}>
            <span className="db-repeat-label">{copy.fromLabel}</span>
            <span className="db-repeat-segments">
              {(['due', 'completion'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={from === option}
                  className="db-repeat-segment"
                  onClick={() => from !== option && write(value.rule, option)}
                >
                  {option === 'due' ? copy.fromDue : copy.fromCompletion}
                </button>
              ))}
            </span>
          </div>
          <p className="db-repeat-words" aria-live="polite">
            ↻ {words(value)}
          </p>
        </>
      )}
    </div>
  )
}

/** A whole number typed in a small field; written when it is one, put back on leaving when it is not. */
function NumberField({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <input
      className="ui-input db-repeat-number"
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={min}
      max={max}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
        const n = Number(event.target.value)
        if (event.target.value !== '' && Number.isInteger(n) && n >= min && n <= max && n !== value) onChange(n)
      }}
      onBlur={() => setDraft(String(value))}
    />
  )
}

function CustomForm({
  form,
  copy,
  locale,
  onEdit,
  onReset
}: {
  form: RepeatForm | null
  copy: (typeof DATE_COPY)['en']
  locale: 'en' | 'pt-BR'
  onEdit: (patch: Partial<RepeatForm>) => void
  onReset: () => void
}): JSX.Element {
  // A rule the form cannot show (an imported "first Monday of the month") stays as it is until replaced.
  if (!form) {
    return (
      <div className="db-repeat-custom">
        <button type="button" className="db-mini-button is-text" onClick={onReset}>
          {copy.custom}…
        </button>
      </div>
    )
  }
  const setEnd = (end: RepeatEnd): void => onEdit({ end })
  return (
    <div className="db-repeat-custom">
      <div className="db-repeat-row">
        <span className="db-repeat-label">{copy.every}</span>
        <NumberField label={copy.every} value={form.interval} min={1} max={999} onChange={(interval) => onEdit({ interval })} />
        <select
          className="ui-input db-repeat-select"
          aria-label={copy.every}
          value={form.freq}
          onChange={(event) => onEdit({ freq: event.target.value as RepeatForm['freq'], weekdays: [], monthDay: null, month: null })}
        >
          {FREQS.map((freq) => (
            <option key={freq} value={freq}>
              {copy.unit(freq, form.interval)}
            </option>
          ))}
        </select>
      </div>
      {form.freq === 'WEEKLY' && (
        <div className="db-repeat-row" role="group" aria-label={copy.onDays}>
          <span className="db-repeat-label">{copy.onDays}</span>
          <span className="db-repeat-days">
            {WEEK.map((day) => {
              const on = form.weekdays.includes(day)
              const name = weekdayName(day, locale)
              return (
                <button
                  key={day}
                  type="button"
                  className="db-repeat-day"
                  aria-pressed={on}
                  aria-label={name}
                  title={name}
                  onClick={() => onEdit({ weekdays: on ? form.weekdays.filter((d) => d !== day) : [...form.weekdays, day] })}
                >
                  {name.slice(0, locale === 'en' ? 2 : 3)}
                </button>
              )
            })}
          </span>
        </div>
      )}
      {form.freq === 'MONTHLY' && (
        <div className="db-repeat-row">
          <span className="db-repeat-label">{copy.onDay}</span>
          <select
            className="ui-input db-repeat-select"
            aria-label={copy.onDay}
            value={form.monthDay ?? ''}
            onChange={(event) => onEdit({ monthDay: event.target.value === '' ? null : Number(event.target.value) })}
          >
            <option value="">—</option>
            {Array.from({ length: 31 }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {index + 1}
              </option>
            ))}
            <option value={-1}>{copy.lastDay}</option>
          </select>
        </div>
      )}
      <div className="db-repeat-row is-top" role="radiogroup" aria-label={copy.ends}>
        <span className="db-repeat-label">{copy.ends}</span>
        <span className="db-repeat-ends">
          <label className="db-check-row">
            <input type="radio" checked={form.end.kind === 'never'} onChange={() => setEnd({ kind: 'never' })} />
            <span>{copy.never}</span>
          </label>
          <label className="db-check-row">
            <input
              type="radio"
              checked={form.end.kind === 'until'}
              onChange={() => setEnd({ kind: 'until', date: L.addDays(L.todayISO(), 30) })}
            />
            <span>{copy.until}</span>
            {form.end.kind === 'until' && (
              <input
                type="date"
                className="ui-input db-repeat-date"
                aria-label={copy.until}
                value={form.end.date}
                onChange={(event) => L.normalizeDay(event.target.value) && setEnd({ kind: 'until', date: event.target.value })}
              />
            )}
          </label>
          <label className="db-check-row">
            <input type="radio" checked={form.end.kind === 'count'} onChange={() => setEnd({ kind: 'count', count: 5 })} />
            <span>{copy.after}</span>
            {form.end.kind === 'count' && (
              <>
                <NumberField
                  label={copy.after}
                  value={form.end.count}
                  min={1}
                  max={999}
                  onChange={(count) => setEnd({ kind: 'count', count })}
                />
                <span>{copy.times(form.end.count)}</span>
              </>
            )}
          </label>
        </span>
      </div>
    </div>
  )
}
