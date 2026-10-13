// Settings → Herman → his council: who sits on it, which program answers for each seat and
// with which model, and the other programs that are connected. Part of the Herman settings chunk.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import {
  AGENT_HELP,
  AGENT_KINDS,
  AGENT_LABELS,
  AGENT_MODEL_RE,
  CLAUDE_AGENT,
  COUNCIL_DEFAULTS,
  COUNCIL_KEY,
  COUNCIL_MEMBERS,
  COUNCIL_PEOPLE,
  councilSeats,
  type AgentKind,
  type AiAgentInfo,
  type CouncilMemberId,
  type CouncilSeat,
  type CouncilSeats
} from '@shared/council'
import { Segmented } from '@/appearance/controls'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

/** What the model field suggests for each kind of program. */
const MODEL_HINT: Record<AgentKind | typeof CLAUDE_AGENT, string> = {
  claude: 'Default model',
  codex: 'Default',
  gemini: 'Default',
  ollama: 'e.g. llama3.2',
  stdin: 'Not used'
}

function ModelField({ seat, kind, label, disabled, onChange }: { seat: CouncilSeat; kind: AgentKind | typeof CLAUDE_AGENT; label: string; disabled: boolean; onChange(model: string | null): void }): JSX.Element {
  const [text, setText] = useState(seat.model ?? '')
  useEffect(() => setText(seat.model ?? ''), [seat.model])
  const clean = text.trim()
  const invalid = clean !== '' && !AGENT_MODEL_RE.test(clean)
  const commit = (): void => {
    if (invalid || clean === (seat.model ?? '')) return
    onChange(clean === '' ? null : clean)
  }
  return (
    <input
      className={invalid ? 'ap-field council-model is-invalid' : 'ap-field council-model'}
      type="text"
      spellCheck={false}
      aria-label={label}
      aria-invalid={invalid}
      placeholder={MODEL_HINT[kind]}
      value={text}
      disabled={disabled || kind === 'stdin'}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

export function CouncilSettings({ enabled }: { enabled: boolean }): JSX.Element {
  const [seats, setSeats] = useState<CouncilSeats>(COUNCIL_DEFAULTS)
  const [agents, setAgents] = useState<AiAgentInfo[]>([])
  const [connecting, setConnecting] = useState<AgentKind | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([window.api.app.getSetting<unknown>(COUNCIL_KEY), window.api.ai.agents.list()]).then(
      ([stored, list]) => {
        if (!alive) return
        setSeats(councilSeats(stored))
        setAgents(list)
      },
      (error: unknown) => console.error('council settings failed to load', error)
    )
    return () => {
      alive = false
    }
  }, [])

  /** Shows the change at once, stores all the seats, and puts the old ones back if that failed. */
  const change = (member: CouncilMemberId, patch: Partial<CouncilSeat>): void => {
    const previous = seats
    const next: CouncilSeats = { ...seats, [member]: { ...seats[member], ...patch } }
    setSeats(next)
    window.api.app.setSetting(COUNCIL_KEY, next).catch((error: unknown) => {
      setSeats(previous)
      notifyError('The setting could not be saved.', error)
    })
  }

  const connect = (kind: AgentKind, pick: boolean): void => {
    setConnecting(kind)
    window.api.ai.agents
      .connect(kind, pick)
      .then((agent) => {
        if (!agent) return
        setAgents((list) => (list.some((entry) => entry.id === agent.id) ? list : [...list, agent]))
        toast(`${agent.name} is connected. Give it a seat above.`, { kind: 'success', duration: 2600 })
      })
      .catch((error: unknown) => notifyError('That program could not be connected.', error))
      .finally(() => setConnecting(null))
  }

  const remove = (id: string): void => {
    window.api.ai.agents.remove(id).then(
      (list) => {
        setAgents(list)
        // A seat the program held goes back to Claude, and keeps no model of the other program.
        const next = { ...seats }
        let changed = false
        for (const member of COUNCIL_MEMBERS) {
          if (next[member].agent !== id) continue
          next[member] = { ...next[member], agent: CLAUDE_AGENT, model: null }
          changed = true
        }
        if (!changed) return
        setSeats(next)
        window.api.app.setSetting(COUNCIL_KEY, next).catch((error: unknown) => notifyError('The setting could not be saved.', error))
      },
      (error: unknown) => notifyError('That program could not be removed.', error)
    )
  }

  const kindOf = (seat: CouncilSeat): AgentKind | typeof CLAUDE_AGENT => (seat.agent === CLAUDE_AGENT ? CLAUDE_AGENT : (agents.find((agent) => agent.id === seat.agent)?.kind ?? CLAUDE_AGENT))

  return (
    <>
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">His council</h3>
        </div>
        <div className="ap-list">
          {COUNCIL_MEMBERS.map((member) => {
            const seat = seats[member]
            const { name, role, about } = COUNCIL_PEOPLE[member]
            const known = seat.agent === CLAUDE_AGENT || agents.some((agent) => agent.id === seat.agent)
            return (
              <div className="ap-row council-row" key={member}>
                <div className="ap-row-text">
                  <span className="ap-row-label">
                    {name}, {role}
                  </span>
                  <span className="ap-row-help">{about}</span>
                </div>
                <div className="ap-row-control">
                  <select
                    className="ap-field ai-select council-agent"
                    aria-label={`Who answers for ${name}`}
                    value={known ? seat.agent : ''}
                    disabled={!enabled || !seat.enabled}
                    onChange={(event) => change(member, { agent: event.target.value, model: null })}
                  >
                    {!known && <option value="">No longer connected</option>}
                    <option value={CLAUDE_AGENT}>Claude</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                        {agent.available ? '' : ' (not found)'}
                      </option>
                    ))}
                  </select>
                  <ModelField seat={seat} kind={kindOf(seat)} label={`Model for ${name}`} disabled={!enabled || !seat.enabled} onChange={(model) => change(member, { model })} />
                  <Segmented label={name} value={seat.enabled ? 'on' : 'off'} options={ON_OFF} onChange={(value) => change(member, { enabled: value === 'on' })} />
                </div>
              </div>
            )
          })}
        </div>
        <p className="ap-note">
          Press Council in the conversation and Herman asks the seats that are on before he answers; each replies from one point of view, and their answers show above his. Each
          seat is one more request, to the program and model chosen for it. An empty model leaves the choice to the program; for Claude, a name such as opus, sonnet or haiku.
        </p>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Other programs</h3>
        </div>
        <div className="ap-list">
          {agents.map((agent) => (
            <div className="ap-row" key={agent.id}>
              <div className="ap-row-text">
                <span className="ap-row-label">{agent.name}</span>
                <span className="ap-row-help council-path" title={agent.path}>
                  {agent.available ? agent.path : `Not found any more: ${agent.path}`}
                </span>
              </div>
              <div className="ap-row-control">
                <Button onClick={() => remove(agent.id)}>Remove</Button>
              </div>
            </div>
          ))}
          {AGENT_KINDS.map((kind) => (
            <div className="ap-row" key={kind}>
              <div className="ap-row-text">
                <span className="ap-row-label">{AGENT_LABELS[kind]}</span>
                <span className="ap-row-help">{AGENT_HELP[kind]}</span>
              </div>
              <div className="ap-row-control">
                {kind !== 'stdin' && (
                  <Button disabled={connecting !== null} onClick={() => connect(kind, false)}>
                    Connect
                  </Button>
                )}
                <Button disabled={connecting !== null} onClick={() => connect(kind, true)}>
                  Choose file…
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p className="ap-note">
          A connected program can answer for a seat of the council. sel starts it on this computer in an empty folder, gives it the question and the same notes Herman is given, and
          reads what it prints. It signs in as you set it up yourself: sel stores no key for it and passes none along. Unlike Claude as sel starts it, these programs decide for
          themselves what they may do; Codex is asked for its read-only sandbox.
        </p>
      </section>
    </>
  )
}
