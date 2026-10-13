import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import { AGENT_ID_RE, AGENT_LABELS, AGENT_LIMITS, AGENT_MODEL_RE, isAgentKind, type AgentKind, type AiAgent, type AiAgentInfo } from '../../shared/council'
import { inspectCli, locateCli, type LocateOptions, type LocateResult } from './locate'

/**
 * Other programs that can answer for a seat of Herman's council: how each is found and how it
 * is started. The rules of command.ts hold here as well: nothing the user wrote is ever an
 * argument (the prompt goes in on stdin), and the only values that vary are the program's own
 * path, validated by locate.ts, and a model name of a strict pattern.
 *
 * What these programs do once started is theirs to decide: unlike Claude Code as this app
 * starts it, they are not all told to run without tools. They start in the same empty
 * directory, and where one offers a read-only mode it is asked for.
 */

/** Where the connected programs are stored. Only this process writes it: a renderer cannot put a path there. */
export const AGENTS_KEY = 'ai.agents'

interface AgentProgram {
  /** The file name searched for on PATH; null when the program can only be chosen by hand. */
  name: string | null
  /** Variables it reads to find its own configuration, passed on besides the usual ones. Never credentials. */
  envAllow: readonly string[]
  /** Whether a seat must name a model for it. */
  needsModel: boolean
}

export const AGENT_PROGRAMS: Record<AgentKind, AgentProgram> = {
  codex: { name: 'codex', envAllow: ['CODEX_HOME'], needsModel: false },
  gemini: { name: 'gemini', envAllow: ['GEMINI_CLI_HOME'], needsModel: false },
  ollama: { name: 'ollama', envAllow: ['OLLAMA_HOST', 'OLLAMA_MODELS'], needsModel: true },
  stdin: { name: null, envAllow: [], needsModel: false }
}

/**
 * The arguments one run of a program gets. The prompt is never among them.
 *  - codex: `codex exec … -` reads the prompt from stdin and prints the final message; it is
 *    confined to a read-only sandbox and told not to look for a repository.
 *  - gemini: with nothing but a model, it reads the prompt from stdin and prints the answer.
 *  - ollama: `ollama run <model>` reads the prompt from stdin.
 *  - stdin: no arguments at all.
 */
export function agentArgs(kind: AgentKind, model: string | null | undefined): string[] {
  const named = typeof model === 'string' && AGENT_MODEL_RE.test(model) ? model : null
  if (AGENT_PROGRAMS[kind].needsModel && !named) throw new Error(`${AGENT_LABELS[kind]} needs a model name for this seat.`)
  switch (kind) {
    case 'codex':
      return ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', ...(named ? ['--model', named] : []), '-']
    case 'gemini':
      return named ? ['--model', named] : []
    case 'ollama':
      return ['run', named as string, '--nowordwrap']
    case 'stdin':
      return []
  }
}

/** Looks for a program of this kind where programs are installed. Nothing is run. */
export function locateAgent(kind: AgentKind, options: LocateOptions = {}): LocateResult {
  const name = AGENT_PROGRAMS[kind].name
  return name ? locateCli({ ...options, explicit: null, devScript: null, name }) : { ok: false, reason: 'not-found' }
}

/** The connected programs as stored. Anything that is not exactly an agent is dropped. */
export function readAgents(stored: unknown): AiAgent[] {
  if (!Array.isArray(stored)) return []
  const out: AiAgent[] = []
  const seen = new Set<string>()
  for (const item of stored) {
    if (out.length >= AGENT_LIMITS.agents) break
    if (item === null || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const { id, kind, path, name } = raw
    if (typeof id !== 'string' || !AGENT_ID_RE.test(id) || seen.has(id) || !isAgentKind(kind) || typeof path !== 'string' || !path) continue
    seen.add(id)
    out.push({ id, kind, path, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, AGENT_LIMITS.name) : AGENT_LABELS[kind] })
  }
  return out
}

/** An agent as the settings show it: with whether its file can still be started. */
export function agentInfo(agent: AiAgent, platform: NodeJS.Platform = process.platform): AiAgentInfo {
  return { ...agent, available: inspectCli(agent.path, platform).ok }
}

/** A new entry for a checked file. A program chosen by hand goes by its file name. */
export function newAgent(kind: AgentKind, path: string, existing: readonly AiAgent[]): AiAgent {
  let id = ''
  do id = `${kind}-${randomBytes(3).toString('hex')}`
  while (existing.some((agent) => agent.id === id))
  // eslint-disable-next-line no-control-regex
  const file = basename(path).replace(/\.(exe|cmd|bat|ps1)$/i, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return { id, kind, path, name: (kind === 'stdin' && file ? file : AGENT_LABELS[kind]).slice(0, AGENT_LIMITS.name) }
}
