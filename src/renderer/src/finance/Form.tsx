// A small form of the Finance and household screens: its fields, one button, and what it holds
// goes to one of the blocks' tools. It empties itself when the tool took it.
import { useId, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import { Button } from '@/ui/Button'
import { argsOf, Field, type FieldSpec, runTool } from './kit'

export function ToolForm({
  tool,
  fields,
  submit,
  failed,
  done,
  initial = {},
  extra = {},
  keep = [],
  onDone
}: {
  tool: string
  fields: readonly FieldSpec[]
  submit: string
  failed: string
  done?: string
  /** What the fields start with, and go back to. */
  initial?: Record<string, string>
  /** Arguments the form sends without showing. */
  extra?: Record<string, unknown>
  /** Fields that keep what they hold after sending (the date, who paid). */
  keep?: readonly string[]
  onDone?: () => void
}): JSX.Element {
  const id = useId()
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [busy, setBusy] = useState(false)
  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    const ok = await runTool(tool, { ...argsOf(fields, values), ...extra }, failed, done)
    setBusy(false)
    if (!ok) return
    setValues({ ...initial, ...Object.fromEntries(keep.map((name) => [name, values[name] ?? ''])) })
    onDone?.()
  }
  return (
    <form className="fin-form" onSubmit={(event) => void send(event)}>
      <div className="fin-form-fields">
        {fields.map((field) => (
          <Field
            key={field.name}
            id={`${id}-${field.name}`}
            spec={field}
            value={values[field.name] ?? ''}
            onChange={(value) => setValues((before) => ({ ...before, [field.name]: value }))}
          />
        ))}
      </div>
      <Button type="submit" variant="primary" disabled={busy}>
        {submit}
      </Button>
    </form>
  )
}
