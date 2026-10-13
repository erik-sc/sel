import { join } from 'node:path'
import { app, dialog, type BrowserWindow, type WebContents } from 'electron'
import { AI_CHANNELS, type AiDone, type AiError, type AiErrorCode, type AiRequest, type AiStatus } from '../../shared/ai'
import {
  AGENT_LABELS,
  AGENT_LIMITS,
  CLAUDE_AGENT,
  COUNCIL_KEY,
  COUNCIL_MEMBERS,
  councilSeats,
  isAgentKind,
  type AiAgentInfo,
  type CouncilEvent,
  type CouncilMemberId,
  type CouncilSeat
} from '../../shared/council'
import type { Repository } from '../db/repository'
import { AGENT_PROGRAMS, AGENTS_KEY, agentArgs, agentInfo, locateAgent, newAgent, readAgents } from './agents'
import { buildWorkspace } from './context'
import { COUNCIL_OPINION_CHARS, type CouncilOpinion } from './council'
import type { Failure } from './errors'
import { selectPassages } from './herman'
import { inspectCli, type CliLocation } from './locate'
import { loadMeeting, prepareMeeting, type MeetingSource } from './meeting'
import { buildPrompt, type BriefingPromptData, type PromptContext } from './prompts'
import { aiRequest, loadContext } from './request'
import { AiService, type PromptBuilder, type RunTarget } from './service'

/**
 * The AI service as the app uses it: wired to the repository, the profile directory and the
 * windows. Loaded the first time a window asks for anything AI (see ipc.ts), not at start-up.
 */

/** Text deltas are gathered for this long before they cross to the renderer. */
const DELTA_FLUSH_MS = 40

/**
 * A stand-in for the program, for development and automated checks of the UI. Only an
 * unpackaged build reads it: a shipped app never takes the program to run from the environment.
 */
export function devCliOverride(raw: string | undefined, isPackaged: boolean): string | null {
  return !isPackaged && raw ? raw : null
}

/** Why a seat of the council gave no answer, in words that fit any program. */
const SEAT_FAILURES: Record<AiErrorCode, string> = {
  'not-installed': 'The program could not be started.',
  'not-logged-in': 'The program is not signed in.',
  'rate-limited': 'The program is busy, or over its limit.',
  timeout: 'It took too long.',
  cancelled: 'Stopped.',
  failed: 'It could not answer.'
}

function seatFailure(failure: Failure): string {
  return failure.detail ? `${SEAT_FAILURES[failure.code]} ${failure.detail}` : SEAT_FAILURES[failure.code]
}

export class AiBridge {
  readonly service: AiService
  /** Windows whose requests are cancelled when they go away. */
  private readonly watched = new WeakSet<WebContents>()

  constructor(
    private readonly repo: Repository,
    /** Today's agenda and open tasks as stored: they go along with every question. */
    private readonly day?: () => Promise<BriefingPromptData | null>
  ) {
    const override = devCliOverride(process.env['SEL_AI_CLI'], app.isPackaged)
    const script = override && /\.(m|c)?js$/i.test(override) ? override : null
    this.service = new AiService({
      // Empty and dedicated: with its tools off the program reads nothing, and there is nothing here to read.
      sandboxDir: join(app.getPath('userData'), 'ai-sandbox'),
      getSetting: (key) => (key === 'ai.cliPath' && override && !script ? override : repo.getSetting(key)),
      devScript: script,
      loadContext: (request) => this.context(request)
    })
  }

  /**
   * Everything a request is answered from, read here from what is stored; the window sent ids.
   * A question (`ask`) gets more than its page: the day as the briefing has it, where the page
   * sits, what else the workspace holds and the pages that seem related (see ./context.ts).
   */
  private async context(request: AiRequest): Promise<PromptContext> {
    const repo = this.repo
    // The Markdown converter is shared with export/import and loaded on first use.
    const markdown = await import('../markdown')
    const base: PromptContext = request.today
      ? {}
      : loadContext(
          {
            get: (id) => repo.get(id),
            pageToMarkdown: (id) => markdown.pageToMarkdown(repo, id),
            blocksToMarkdown: (blocks) => markdown.blocksToMarkdown(repo, blocks)
          },
          request
        )
    if (request.action !== 'ask') return base
    let day: BriefingPromptData | null = null
    try {
      day = (await this.day?.()) ?? null
    } catch (err) {
      console.error('[ai] the day could not be read', err)
    }
    const workspace = buildWorkspace(
      {
        get: (id) => repo.get(id),
        ancestors: (id) => repo.ancestors(id),
        listRoot: () => repo.listRoot(),
        listChildren: (id) => repo.listChildren(id),
        listRecent: (limit) => repo.listRecent(limit),
        listDatabases: () => repo.listDatabases(),
        search: (text, limit) => repo.search(text, limit),
        pageToMarkdown: (id) => markdown.pageToMarkdown(repo, id)
      },
      request
    )
    return { ...base, ...(day ? { day } : {}), ...workspace }
  }

  status(refresh: unknown): Promise<AiStatus> {
    return this.service.status(refresh === true)
  }

  /** Validates a request and starts it for `sender`; the outcome is sent to that window only. */
  run(rawRequest: unknown, sender: WebContents): { id: string } {
    const request = aiRequest(rawRequest)
    // "Write up notes" on a meeting page: the transcript is read here, not sent by the window.
    if (request.action === 'consolidate' && !request.transcript?.trim() && request.pageId) return this.startMeeting(request, request.pageId, sender)
    if (request.action === 'ask' && request.council) return this.startCouncil(request, sender)
    return this.start(request, sender)
  }

  // ---- council ------------------------------------------------------------

  /** The seats that are taken, in the order of the council. */
  private seats(): { member: CouncilMemberId; seat: CouncilSeat }[] {
    const seats = councilSeats(this.repo.getSetting(COUNCIL_KEY))
    return COUNCIL_MEMBERS.filter((member) => seats[member].enabled).map((member) => ({ member, seat: seats[member] }))
  }

  /** Who answers for a seat: Claude Code with the seat's model, or a connected program, checked again now. */
  private target(seat: CouncilSeat): RunTarget {
    if (seat.agent === CLAUDE_AGENT) return { model: seat.model }
    const agent = readAgents(this.repo.getSetting(AGENTS_KEY)).find((entry) => entry.id === seat.agent)
    if (!agent) throw new Error('The program chosen for this seat is no longer connected.')
    const found = inspectCli(agent.path)
    if (!found.ok) throw new Error(`${agent.name} is no longer where it was.`)
    return { program: { cli: found.cli, args: agentArgs(agent.kind, seat.model), envAllow: AGENT_PROGRAMS[agent.kind].envAllow } }
  }

  /**
   * A question put to the council first. Each seat that is taken answers it from its own point
   * of view, as a request of its own through the same service and at the same time as the
   * others; Herman then answers with what they said in front of him. The window is told how
   * each member fares. A member that fails is left out; stopping the request stops them all.
   */
  private startCouncil(request: AiRequest, sender: WebContents): { id: string } {
    const seats = this.seats()
    if (!seats.length) return this.start(request, sender)
    const inner = new Set<string>()
    const outer = { id: '' }
    let over = false
    const tell = (event: Omit<CouncilEvent, 'id'>): void => {
      if (!over && !sender.isDestroyed()) sender.send(AI_CHANNELS.council, { id: outer.id, ...event } satisfies CouncilEvent)
    }
    const consult = (member: CouncilMemberId, seat: CouncilSeat, prompt: string): Promise<CouncilOpinion | null> =>
      new Promise((resolve) => {
        let target: RunTarget
        try {
          target = this.target(seat)
        } catch (err) {
          tell({ member, status: 'failed', text: err instanceof Error && err.message ? err.message.slice(0, 160) : 'This seat could not be asked.' })
          return resolve(null)
        }
        tell({ member, status: 'thinking' })
        const id = this.service.runPrompt(
          () => prompt,
          {
            delta: () => undefined,
            done: (result) => {
              inner.delete(id)
              const text = result.text.trim().slice(0, COUNCIL_OPINION_CHARS)
              tell(text ? { member, status: 'done', text } : { member, status: 'failed', text: 'It said nothing.' })
              resolve(text ? { member, text } : null)
            },
            error: (failure) => {
              inner.delete(id)
              tell({ member, status: 'failed', text: seatFailure(failure) })
              resolve(null)
            }
          },
          sender.id,
          target
        )
        inner.add(id)
      })
    const build: PromptBuilder = async (language, voice) => {
      const context = await this.context(request)
      const asked = await Promise.all(seats.map(({ member, seat }) => consult(member, seat, buildPrompt(request, context, { defaultLanguage: language, member }))))
      const council = asked.filter((opinion): opinion is CouncilOpinion => opinion !== null)
      const passageIds = voice ? selectPassages(`${request.instruction ?? ''}\n${request.selectionText ?? ''}`).map((quote) => quote.id) : []
      return buildPrompt(request, context, { defaultLanguage: language, council, ...(voice ? { voice, passageIds } : {}) })
    }
    const started = this.start(request, sender, build, () => {
      over = true
      for (const id of [...inner]) this.service.cancel(id)
    })
    outer.id = started.id
    return started
  }

  // ---- other programs -----------------------------------------------------

  agents(): AiAgentInfo[] {
    return readAgents(this.repo.getSetting(AGENTS_KEY)).map((agent) => agentInfo(agent))
  }

  /**
   * Connects another program. Its path enters the settings in one of two ways only: it was
   * found where programs are installed, or the user picked the file in the native dialog. It is
   * kept only if it is a regular file this platform can start. Null when the dialog was cancelled.
   */
  async connectAgent(kind: unknown, pick: unknown, win: BrowserWindow | null): Promise<AiAgentInfo | null> {
    if (!isAgentKind(kind)) throw new Error('Unknown kind of program')
    const agents = readAgents(this.repo.getSetting(AGENTS_KEY))
    if (agents.length >= AGENT_LIMITS.agents) throw new Error('Too many programs are connected. Remove one first.')
    let cli: CliLocation | null = null
    if (pick !== true) {
      const found = locateAgent(kind)
      if (found.ok) cli = found.cli
    }
    if (!cli) {
      const windows = process.platform === 'win32'
      const options: Electron.OpenDialogOptions = {
        title: `Choose the program for ${AGENT_LABELS[kind]}`,
        buttonLabel: 'Choose',
        properties: ['openFile'],
        filters: windows ? [{ name: 'Programs', extensions: ['exe', 'cmd', 'bat', 'ps1'] }, { name: 'All files', extensions: ['*'] }] : undefined
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      const file = result.filePaths[0]
      if (result.canceled || !file) return null
      const found = inspectCli(file)
      if (!found.ok) throw new Error('That file is not a program this computer can start.')
      cli = found.cli
    }
    const path = cli.path
    const same = agents.find((agent) => agent.kind === kind && agent.path === path)
    if (same) return agentInfo(same)
    const agent = newAgent(kind, path, agents)
    this.repo.setSetting(AGENTS_KEY, [...agents, agent])
    return agentInfo(agent)
  }

  removeAgent(id: unknown): AiAgentInfo[] {
    if (typeof id !== 'string' || id.length > 64) throw new Error('Invalid program id')
    const agents = readAgents(this.repo.getSetting(AGENTS_KEY))
    const kept = agents.filter((agent) => agent.id !== id)
    if (kept.length !== agents.length) this.repo.setSetting(AGENTS_KEY, kept)
    return kept.map((agent) => agentInfo(agent))
  }

  /**
   * Meeting notes from what is stored of a meeting. A transcript too long for one prompt is
   * first condensed part by part, by requests of their own that run one after the other
   * through the same service; stopping the request (or closing its window) stops those too.
   */
  private startMeeting(request: AiRequest, pageId: string, sender: WebContents): { id: string } {
    const abort = new AbortController()
    const inner = new Set<string>()
    const condense = (prompt: string): Promise<string> =>
      new Promise((resolve, reject) => {
        const id = this.service.runPrompt(
          () => prompt,
          {
            delta: () => undefined,
            done: (result) => {
              inner.delete(id)
              resolve(result.text)
            },
            error: (failure) => {
              inner.delete(id)
              reject(new Error(failure.message))
            }
          },
          sender.id
        )
        inner.add(id)
      })
    const build: PromptBuilder = async (language) => {
      const markdown = await import('../markdown')
      const source: MeetingSource = { get: (id) => this.repo.get(id), children: (id) => this.repo.children(id), blocksToMarkdown: (blocks) => markdown.blocksToMarkdown(this.repo, blocks) }
      const meeting = loadMeeting(source, pageId)
      if (!meeting) throw new Error('This meeting has no transcript yet.')
      return buildPrompt(request, { meeting: await prepareMeeting(meeting, language, condense, abort.signal) }, { defaultLanguage: language })
    }
    return this.start(request, sender, build, () => {
      abort.abort()
      for (const id of [...inner]) this.service.cancel(id)
    })
  }

  /** Starts a prompt built in this process (the briefing) for `sender`, streamed like any request. */
  runPrompt(build: PromptBuilder, sender: WebContents): { id: string } {
    return this.start({ action: 'custom' }, sender, build)
  }

  private start(request: AiRequest, sender: WebContents, build?: PromptBuilder, onEnd?: () => void): { id: string } {
    if (!this.watched.has(sender)) {
      this.watched.add(sender)
      const owner = sender.id
      const stop = (): void => this.service.cancelOwner(owner)
      sender.once('destroyed', stop)
      // A reload or a crash throws the page's requests away just as closing the window does.
      sender.on('render-process-gone', stop)
      sender.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) stop()
      })
    }
    const send = (channel: string, payload: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, payload)
    }
    let pending = ''
    let timer: NodeJS.Timeout | null = null
    let id = ''
    const flush = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      if (pending) send(AI_CHANNELS.delta, { id, text: pending })
      pending = ''
    }
    id = this.service.run(
      request,
      {
        delta: (text) => {
          pending += text
          if (!timer) timer = setTimeout(flush, DELTA_FLUSH_MS)
        },
        done: (result) => {
          onEnd?.()
          flush()
          send(AI_CHANNELS.done, { id, ...result } satisfies AiDone)
        },
        error: (failure) => {
          onEnd?.()
          flush()
          send(AI_CHANNELS.error, { id, ...failure } satisfies AiError)
        }
      },
      sender.id,
      build
    )
    return { id }
  }

  cancel(id: unknown, sender: WebContents): boolean {
    if (typeof id !== 'string' || id.length > 64) throw new Error('Invalid request id')
    return this.service.cancel(id, sender.id)
  }

  /**
   * The only way a path to run enters the settings: the user picks a file in the native dialog,
   * and it is kept only if it is a regular file this platform can start. Returns the new status,
   * or null when the dialog was cancelled.
   */
  async pickCli(win: BrowserWindow | null): Promise<AiStatus | null> {
    const windows = process.platform === 'win32'
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the claude program',
      buttonLabel: 'Choose',
      properties: ['openFile'],
      filters: windows ? [{ name: 'Programs', extensions: ['exe', 'cmd', 'bat', 'ps1'] }, { name: 'All files', extensions: ['*'] }] : undefined
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const file = result.filePaths[0]
    if (result.canceled || !file) return null
    const found = inspectCli(file)
    if (!found.ok) return { available: false, reason: 'not-executable' }
    const previous = this.repo.getSetting('ai.cliPath')
    this.repo.setSetting('ai.cliPath', found.cli.path)
    const status = await this.service.status(true)
    if (!status.available && status.reason !== 'disabled') {
      // It is a program, but not this one: the choice is not kept.
      this.repo.setSetting('ai.cliPath', typeof previous === 'string' ? previous : null)
      this.service.invalidate()
    }
    return status
  }

  dispose(): void {
    this.service.dispose()
  }
}
