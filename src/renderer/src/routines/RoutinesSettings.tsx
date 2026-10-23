// Settings → AI → Routines and Usage: each routine on or off with its time, the daily limit, "Run
// now", and how much AI was used today and in the last seven days. Part of the settings chunk.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { usageTotal, type UsageSummary, type UsageTotals } from '@shared/aiUsage'
import {
  cleanRoutineTime,
  ROUTINE_DEFAULTS,
  ROUTINE_HOURS,
  ROUTINE_IDS,
  ROUTINE_LIMIT,
  ROUTINES_COPY,
  type RoutineId,
  type RoutinesCopy,
  type RoutinesSettings
} from '@shared/routines'
import { Segmented } from '@/appearance/controls'
import { useHome } from '@/home/store'
import { Button } from '@/ui/Button'
import { notifyError } from '@/ui/toast'
import { runRoutine } from './client'
import { loadRoutineSettings, saveRoutineSettings } from './settings'

/** The times a routine may be set for, every quarter of an hour within the allowed hours, as `HH:mm` (24 h). */
const TIMES: string[] = []
for (let minutes = ROUTINE_HOURS.from; minutes <= ROUTINE_HOURS.to; minutes += 15)
  TIMES.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`)

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** "3 requests · 1m 20s · $0.12": the cost only when the program reported one. */
export function usageLine(totals: UsageTotals, copy: Pick<RoutinesCopy, 'requests'>): string {
  const parts = [copy.requests(totals.requests), duration(totals.ms)]
  if (totals.costed > 0) parts.push(`US$ ${totals.costUsd.toFixed(totals.costUsd < 1 ? 3 : 2)}`)
  return parts.join(' · ')
}

function UsageList({ title, byOrigin, copy }: { title: string; byOrigin: Record<string, UsageTotals>; copy: RoutinesCopy }): JSX.Element {
  const origins = Object.entries(byOrigin).sort((a, b) => b[1].requests - a[1].requests)
  const total = usageTotal(byOrigin)
  return (
    <div className="ap-row">
      <div className="ap-row-text">
        <span className="ap-row-label">{title}</span>
        {origins.length ? (
          <>
            <span className="ap-row-help">{usageLine(total, copy)}</span>
            <ul className="routines-usage">
              {origins.map(([origin, totals]) => (
                <li key={origin}>
                  <span className="routines-usage-origin">{copy.origin(origin)}</span> {usageLine(totals, copy)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <span className="ap-row-help">{copy.nothing}</span>
        )}
      </div>
    </div>
  )
}

export function RoutinesSettings({ enabled }: { enabled: boolean }): JSX.Element {
  const locale = useHome((state) => state.locale)
  const copy = ROUTINES_COPY[locale === 'pt-BR' ? 'pt-BR' : 'en']
  const [settings, setSettings] = useState<RoutinesSettings>(ROUTINE_DEFAULTS)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [limit, setLimit] = useState(String(ROUTINE_DEFAULTS.limit))

  useEffect(() => {
    let alive = true
    loadRoutineSettings()
      .then((stored) => {
        if (!alive) return
        setSettings(stored)
        setLimit(String(stored.limit))
      })
      .catch((error: unknown) => console.error('the routines could not be read', error))
    window.api.routines
      .usage()
      .then((summary) => alive && setUsage(summary))
      .catch((error: unknown) => console.error('the usage could not be read', error))
    return () => {
      alive = false
    }
  }, [])

  const save = (next: RoutinesSettings): void => {
    const previous = settings
    setSettings(next)
    saveRoutineSettings(next).catch((error: unknown) => {
      setSettings(previous)
      notifyError(copy.failed, error)
    })
  }

  const setRoutine = (id: RoutineId, change: Partial<RoutinesSettings['routines'][RoutineId]>): void =>
    save({ ...settings, routines: { ...settings.routines, [id]: { ...settings.routines[id], ...change } } })

  const commitLimit = (): void => {
    const parsed = Number.parseInt(limit, 10)
    const next = Number.isFinite(parsed) ? Math.min(ROUTINE_LIMIT.max, Math.max(ROUTINE_LIMIT.min, parsed)) : settings.limit
    setLimit(String(next))
    if (next !== settings.limit) save({ ...settings, limit: next })
  }

  const onOff = [
    { value: 'on' as const, label: copy.on },
    { value: 'off' as const, label: copy.off }
  ]

  return (
    <>
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{copy.title}</h3>
        </div>
        <p className="ap-note">{copy.intro}</p>
        <div className="ap-list">
          {ROUTINE_IDS.map((id) => {
            const routine = settings.routines[id]
            return (
              <div className="ap-row" key={id}>
                <div className="ap-row-text">
                  <span className="ap-row-label">{copy.names[id]}</span>
                  <span className="ap-row-help">{copy.helps[id]}</span>
                </div>
                <div className="ap-row-control routines-control">
                  {id === 'weekly' && (
                    <select
                      className="ap-field routines-day"
                      aria-label={`${copy.names[id]}: day`}
                      value={settings.weeklyDay}
                      disabled={!enabled}
                      onChange={(event) => save({ ...settings, weeklyDay: event.target.value === '0' ? 0 : 5 })}
                    >
                      <option value={5}>{copy.friday}</option>
                      <option value={0}>{copy.sunday}</option>
                    </select>
                  )}
                  <span className="ap-unit">{copy.at}</span>
                  <select
                    className="ap-field routines-time"
                    aria-label={`${copy.names[id]}: time`}
                    value={routine.time}
                    disabled={!enabled}
                    onChange={(event) => {
                      const time = cleanRoutineTime(event.target.value)
                      if (time) setRoutine(id, { time })
                    }}
                  >
                    {(TIMES.includes(routine.time) ? TIMES : [...TIMES, routine.time].sort()).map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                  <Segmented
                    label={copy.names[id]}
                    value={routine.on ? 'on' : 'off'}
                    options={onOff}
                    onChange={(value) => setRoutine(id, { on: value === 'on' })}
                  />
                  <Button variant="ghost" disabled={!enabled} onClick={() => void runRoutine(id)}>
                    {copy.runNow}
                  </Button>
                </div>
              </div>
            )
          })}
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{copy.limitLabel}</span>
              <span className="ap-row-help">{copy.limitHelp}</span>
            </div>
            <div className="ap-row-control">
              <input
                className="ap-field is-number"
                inputMode="numeric"
                aria-label={copy.limitLabel}
                value={limit}
                disabled={!enabled}
                onChange={(event) => setLimit(event.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                onBlur={commitLimit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitLimit()
                  }
                }}
              />
              <span className="ap-unit">{copy.perDay}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{copy.usageTitle}</h3>
        </div>
        <p className="ap-note">{copy.usageHelp}</p>
        {usage && (
          <div className="ap-list">
            <UsageList title={copy.today} byOrigin={usage.today} copy={copy} />
            <UsageList title={copy.week} byOrigin={usage.week} copy={copy} />
          </div>
        )}
        {usage && <p className="ap-note">{copy.routinesToday(usage.routinesToday, usage.routineLimit)}</p>}
      </section>
    </>
  )
}
