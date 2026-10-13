/**
 * Herman's council, and the other programs that can sit on it. The council is a handful of
 * fixed personas (their words are constants of the main process, see main/ai/council.ts) that
 * Herman may ask before he answers. Each seat names who answers for it: the Claude Code program
 * the rest of the app uses, or another program the user connected, and which model.
 *
 * What a renderer may choose is here: which seats are taken, by which connected program, with
 * which model name. It never supplies a persona's words, a path or an argument.
 */

export const COUNCIL_MEMBERS = ['skeptic', 'strategist', 'builder', 'editor', 'keeper'] as const
export type CouncilMemberId = (typeof COUNCIL_MEMBERS)[number]

export const COUNCIL_PEOPLE: Record<CouncilMemberId, { name: string; role: string; about: string }> = {
  skeptic: { name: 'Cato', role: 'the Skeptic', about: 'Looks for the weak point: what is assumed, and what could go wrong.' },
  strategist: { name: 'Sun', role: 'the Strategist', about: 'Takes the long view: what matters most, and what to give up for it.' },
  builder: { name: 'Ada', role: 'the Builder', about: 'Turns it into steps: the smallest thing that can be done next.' },
  editor: { name: 'Iris', role: 'the Editor', about: 'Minds the words: what is said, what is meant, what to cut.' },
  keeper: { name: 'Mira', role: 'the Keeper', about: 'Minds the person: energy, rest and the people involved.' }
}

// ---- agents -------------------------------------------------------------------

/** The seat is answered by the Claude Code program the app already drives. */
export const CLAUDE_AGENT = 'claude'

/** Other programs that can be connected. `stdin` is any program that reads a prompt on stdin and prints its answer. */
export const AGENT_KINDS = ['codex', 'gemini', 'ollama', 'stdin'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

export const AGENT_LABELS: Record<AgentKind, string> = {
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  ollama: 'Ollama',
  stdin: 'Another program'
}

export const AGENT_HELP: Record<AgentKind, string> = {
  codex: 'Runs "codex exec" in a read-only sandbox, signed in as you set it up.',
  gemini: 'Runs "gemini" with the prompt on its input, signed in as you set it up.',
  ollama: 'Runs "ollama run <model>" on this computer. Each seat needs a model name.',
  stdin: 'Any program that reads the prompt from its input and prints the answer.'
}

/** A connected program, as stored (`ai.agents`, written by the main process only). */
export interface AiAgent {
  id: string
  kind: AgentKind
  /** The file to start: chosen in the native file dialog or found on PATH, never typed. */
  path: string
  name: string
}

export interface AiAgentInfo extends AiAgent {
  /** False when the file is gone or can no longer be started. */
  available: boolean
}

export const AGENT_LIMITS = { agents: 12, name: 60 } as const
export const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
/**
 * A model name as these programs take it (`gpt-5.5`, `gemini-3-pro`, `llama3.2:3b`,
 * `hf.co/org/model`): it travels as one argument and holds nothing a shell reads as syntax.
 */
export const AGENT_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value)
}

// ---- seats --------------------------------------------------------------------

export interface CouncilSeat {
  enabled: boolean
  /** `claude`, or the id of a connected program. */
  agent: string
  /** The model for this seat; null leaves it to the program. */
  model: string | null
}

export type CouncilSeats = Record<CouncilMemberId, CouncilSeat>

const seat = (enabled: boolean): CouncilSeat => ({ enabled, agent: CLAUDE_AGENT, model: null })

export const COUNCIL_DEFAULTS: CouncilSeats = {
  skeptic: seat(true),
  strategist: seat(true),
  builder: seat(true),
  editor: seat(false),
  keeper: seat(false)
}

/** The setting the seats are stored in. */
export const COUNCIL_KEY = 'herman.council'

function cleanSeat(value: unknown): CouncilSeat | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => key !== 'enabled' && key !== 'agent' && key !== 'model')) return undefined
  if (typeof raw['enabled'] !== 'boolean') return undefined
  const agent = raw['agent']
  if (typeof agent !== 'string' || (agent !== CLAUDE_AGENT && !AGENT_ID_RE.test(agent))) return undefined
  const model = raw['model'] ?? null
  if (model !== null && (typeof model !== 'string' || !AGENT_MODEL_RE.test(model))) return undefined
  return { enabled: raw['enabled'], agent, model }
}

/** The seats a renderer may store: exactly one per member, each typed; undefined otherwise. */
export function cleanCouncil(value: unknown): CouncilSeats | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => !(COUNCIL_MEMBERS as readonly string[]).includes(key))) return undefined
  const out = {} as CouncilSeats
  for (const member of COUNCIL_MEMBERS) {
    const clean = cleanSeat(raw[member])
    if (!clean) return undefined
    out[member] = clean
  }
  return out
}

/** The stored seats, or the defaults when nothing valid is stored. */
export function councilSeats(stored: unknown): CouncilSeats {
  return cleanCouncil(stored) ?? COUNCIL_DEFAULTS
}

/** What a window is told while the council is being asked: one event per member and change. */
export interface CouncilEvent {
  /** The id of the request the council is consulted for. */
  id: string
  member: CouncilMemberId
  status: 'thinking' | 'done' | 'failed'
  /** `done`: what the member said. `failed`: one safe line about why. */
  text?: string
}
