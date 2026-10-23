// Settings → AI: the way back to the persona's introduction (0.8.0 A1) and the persona's memory
// (0.8.0 A3): the switch, every fact kept, each editable in place, deleted one by one or all at
// once. The facts are written by the main process alone; edits go through `ai.memory`. Part of
// the AI section's chunk.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { AI_MEMORY_CAPS, AI_MEMORY_ENABLED_KEY, AI_MEMORY_KEY, cleanMemory, memoryEnabled, type MemoryFact } from '@shared/aiMemory'
import { ConfirmButton, Segmented } from '@/appearance/controls'
import { useHerman } from '@/herman/gate'
import type { HomeLocale } from '@/home/copy'
import { setSettingsOpen } from '@/store/ui'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'
import { openOnboarding } from './gate'
import { memoryCopy, type MemoryCopy } from './memoryCopy'
import { onboardingCopy } from './onboardingCopy'

export function MemorySettings({ enabled, locale }: { enabled: boolean; locale: HomeLocale }): JSX.Element {
  const persona = useHerman((state) => state.persona)
  const copy = useMemo(() => memoryCopy(locale, persona), [locale, persona])
  const intro = useMemo(() => onboardingCopy(locale, persona), [locale, persona])
  return (
    <div lang={locale}>
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{intro.introLabel}</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-help">{intro.introHelp}</span>
            </div>
            <div className="ap-row-control">
              <Button
                disabled={!enabled}
                onClick={() => {
                  setSettingsOpen(false)
                  openOnboarding('settings')
                }}
              >
                {intro.redo}
              </Button>
            </div>
          </div>
        </div>
      </section>
      <MemoryGroup copy={copy} enabled={enabled} />
    </div>
  )
}

function MemoryGroup({ copy, enabled }: { copy: MemoryCopy; enabled: boolean }): JSX.Element {
  const [on, setOn] = useState(true)
  const [facts, setFacts] = useState<MemoryFact[] | null>(null)

  const load = useCallback((): void => {
    Promise.all([window.api.app.getSetting<unknown>(AI_MEMORY_KEY), window.api.app.getSetting<unknown>(AI_MEMORY_ENABLED_KEY)]).then(
      ([stored, switched]) => {
        setFacts(cleanMemory(stored))
        setOn(memoryEnabled(switched))
      },
      (error: unknown) => {
        setFacts([])
        console.error('the memory failed to load', error)
      }
    )
  }, [])

  useEffect(load, [load])

  const turn = (next: boolean): void => {
    setOn(next)
    window.api.app.setSetting(AI_MEMORY_ENABLED_KEY, next ? null : false).catch((error: unknown) => {
      setOn(!next)
      notifyError(copy.failed, error)
    })
  }

  /** One change to what is kept; the list shown is what main kept after it. */
  const change = (op: unknown, done?: string): Promise<boolean> =>
    window.api.ai.memory(op).then(
      (result) => {
        setFacts(result.facts)
        if (result.refused) {
          notifyError(copy.refused[result.refused])
          return false
        }
        if (done) toast(done, { kind: 'success', duration: 1800 })
        return true
      },
      (error: unknown) => {
        notifyError(copy.failed, error)
        return false
      }
    )

  const list = facts ?? []
  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">{copy.title}</h3>
      </div>
      <p className="ap-note claude-intro">{copy.intro}</p>
      <div className="ap-list">
        <div className="ap-row">
          <div className="ap-row-text">
            <span className="ap-row-label">{copy.switchLabel}</span>
            <span className="ap-row-help">{on ? copy.switchOn : copy.switchOff}</span>
          </div>
          <div className="ap-row-control">
            <Segmented
              label={copy.switchLabel}
              value={on ? 'on' : 'off'}
              options={[
                { value: 'on', label: copy.on },
                { value: 'off', label: copy.off }
              ]}
              onChange={(value) => turn(value === 'on')}
            />
          </div>
        </div>
        <div className="ap-row is-stacked">
          <div className="ap-row-text">
            <span className="ap-row-label">{copy.count(list.length, AI_MEMORY_CAPS.facts)}</span>
          </div>
          <div className="ap-row-control memory-control">
            {facts !== null && list.length === 0 ? (
              <span className="ap-row-help">{copy.none}</span>
            ) : (
              <ul className="memory-list">
                {list.map((fact) => (
                  <FactRow
                    key={fact.id}
                    fact={fact}
                    copy={copy}
                    disabled={!enabled}
                    onSave={(text) => change({ op: 'edit', id: fact.id, text }, copy.saved)}
                    onRemove={() => void change({ op: 'remove', ids: [fact.id] })}
                  />
                ))}
              </ul>
            )}
            {list.length > 0 && (
              <div className="memory-bar">
                <ConfirmButton
                  label={copy.removeAll}
                  confirmLabel={copy.removeAllConfirm}
                  onConfirm={() => void change({ op: 'clear' }, copy.removedAll)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="ap-note">{copy.note}</p>
    </section>
  )
}

function FactRow({
  fact,
  copy,
  disabled,
  onSave,
  onRemove
}: {
  fact: MemoryFact
  copy: MemoryCopy
  disabled: boolean
  onSave: (text: string) => Promise<boolean>
  onRemove: () => void
}): JSX.Element {
  const [text, setText] = useState(fact.text)
  useEffect(() => setText(fact.text), [fact.text])
  const commit = (): void => {
    if (text.trim() === fact.text) return
    void onSave(text).then((saved) => {
      if (!saved) setText(fact.text)
    })
  }
  return (
    <li className="memory-item">
      <input
        className="ap-field memory-field"
        value={text}
        maxLength={AI_MEMORY_CAPS.text}
        aria-label={copy.factLabel}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape' && text !== fact.text) {
            event.preventDefault()
            event.stopPropagation()
            setText(fact.text)
          }
        }}
      />
      <Button variant="ghost" aria-label={copy.removeLabel(fact.text)} onClick={onRemove}>
        {copy.remove}
      </Button>
    </li>
  )
}
