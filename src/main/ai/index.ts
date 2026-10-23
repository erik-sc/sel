import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, dialog, type BrowserWindow, type WebContents } from 'electron'
import { AI_CHANNELS, type AiDone, type AiError, type AiRequest, type AiStatus } from '../../shared/ai'
import { privacyChecker } from '../../shared/aiPrivate'
import { AI_MCP_CATALOG_KEY, AI_MCP_SERVERS_KEY, isMcpServerId, mcpChoices, type ClaudeServerList } from '../../shared/aiContext'
import type { Repository } from '../db/repository'
import {
  claudeConfigFile,
  listServers,
  parseMcpList,
  planExternal,
  readCatalog,
  readLocalServers,
  toolsOfServer,
  type ExternalPlan,
  type LocalServer,
  type McpCatalog
} from './claudeMcp'
import { buildArgs } from './command'
import { buildWorkspace } from './context'
import { inspectCli } from './locate'
import { loadMeeting, prepareMeeting, type MeetingSource } from './meeting'
import { buildPrompt, type BriefingPromptData, type PromptContext } from './prompts'
import { aiRequest, loadContext, withoutPrivatePage } from './request'
import { AiService, type PromptBuilder, type RunTarget } from './service'
import { loadStanding } from './standing'
import { ToolHost, toolScript } from './toolhost'
import { repositorySource, type ToolSource } from './tools'

/**
 * The AI service as the app uses it: wired to the repository, the profile directory and the
 * windows. Loaded the first time a window asks for anything AI (see ipc.ts), not at start-up.
 */

/** Text deltas are gathered for this long before they cross to the renderer. */
const DELTA_FLUSH_MS = 40

/** Turns Herman may take to look around the workspace through the tools before he answers. */
const HERMAN_TURNS = 10

/** How long `claude mcp list` may take: it checks every server it knows, and a slow one takes half a minute. */
const SCAN_TIMEOUT_MS = 120_000
/** How long a start may take to list a server's tools. */
const TOOLS_TIMEOUT_MS = 90_000

/**
 * A stand-in for the program, for development and automated checks of the UI. Only an
 * unpackaged build reads it: a shipped app never takes the program to run from the environment.
 */
export function devCliOverride(raw: string | undefined, isPackaged: boolean): string | null {
  return !isPackaged && raw ? raw : null
}

export class AiBridge {
  readonly service: AiService
  /** Windows whose requests are cancelled when they go away. */
  private readonly watched = new WeakSet<WebContents>()
  /** The workspace tools Herman may read through (see ./toolhost.ts). */
  private readonly tools: ToolHost
  /** The Markdown converter, loaded before the first tool is granted: the tools read pages through it. */
  private markdown: typeof import('../markdown') | null = null
  /** Questions asked on a page private from the AI, sent on without it: their WORKSPACE says there is one. */
  private readonly privateAsks = new WeakSet<AiRequest>()

  constructor(
    private readonly repo: Repository,
    /** Today's agenda and open tasks as stored: they go along with every question. */
    private readonly day?: () => Promise<BriefingPromptData | null>
  ) {
    const override = devCliOverride(process.env['SEL_AI_CLI'], app.isPackaged)
    const script = override && /\.(m|c)?js$/i.test(override) ? override : null
    const sandboxDir = join(app.getPath('userData'), 'ai-sandbox')
    this.tools = new ToolHost({
      source: () => this.toolSource(),
      dir: sandboxDir,
      execPath: process.execPath,
      script: toolScript(__dirname)
    })
    this.service = new AiService({
      // Empty and dedicated: the program's file tools are off, and there is nothing here to read but the configuration of its one MCP server.
      sandboxDir,
      tools: {
        grant: async (listener, extra) => {
          this.markdown ??= await import('../markdown')
          return this.tools.grant(listener, extra)
        }
      },
      getSetting: (key) => (key === 'ai.cliPath' && override && !script ? override : repo.getSetting(key)),
      devScript: script,
      loadContext: (request) => this.context(request),
      external: () => this.externalPlan()
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
    // Every reader below leaves out what is private from the AI (shared/aiPrivate.ts), each with a checker of its own.
    const pageToMarkdown = (id: string, hidden?: (id: string) => boolean): { title: string; markdown: string } =>
      markdown.pageToMarkdown(repo, id, hidden ? { hidden } : {})
    const loaded: PromptContext = request.today
      ? {}
      : loadContext(
          {
            get: (id) => repo.get(id),
            pageToMarkdown,
            blocksToMarkdown: (blocks, hidden) => markdown.blocksToMarkdown(repo, blocks, hidden ? { hidden } : {})
          },
          request
        )
    // Settings → AI → Context goes along with every request: the written context and the pinned pages.
    const standing = loadStanding({
      getSetting: (key) => repo.getSetting(key),
      get: (id) => repo.get(id),
      pageToMarkdown
    })
    const base: PromptContext = standing ? { ...loaded, standing } : loaded
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
        // What the assistant is shown by itself leaves archived pages out; it finds them when it searches.
        listDatabases: () => repo.listDatabases({ archived: false }),
        search: (text, limit) => repo.search(text, limit),
        pageToMarkdown
      },
      request,
      new Date(),
      { privatePage: this.privateAsks.has(request) }
    )
    return { ...base, ...(day ? { day } : {}), ...workspace }
  }

  /** The repository as the tools read it. */
  private toolSource(): ToolSource {
    if (!this.markdown) throw new Error('The Markdown converter is not loaded yet.')
    return repositorySource(this.repo, this.markdown)
  }

  status(refresh: unknown): Promise<AiStatus> {
    return this.service.status(refresh === true)
  }

  /** Validates a request and starts it for `sender`; the outcome is sent to that window only. */
  run(rawRequest: unknown, sender: WebContents): { id: string } {
    // A request about a page private from the AI: a question goes on without the page, anything else is refused here.
    const { request, privatePage } = withoutPrivatePage(aiRequest(rawRequest), privacyChecker({ get: (id) => this.repo.get(id) }))
    if (privatePage) this.privateAsks.add(request)
    // "Write up notes" on a meeting page: the transcript is read here, not sent by the window.
    if (request.action === 'consolidate' && !request.transcript?.trim() && request.pageId)
      return this.startMeeting(request, request.pageId, sender)
    // A question may be answered from anywhere in the workspace: the tools let the answer look.
    // The servers the user turned on in Settings (Veleiro, Gmail…) come along with a question only.
    if (request.action === 'ask')
      return this.start(request, sender, undefined, undefined, { tools: { maxTurns: HERMAN_TURNS, external: true } })
    return this.start(request, sender)
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
      const source: MeetingSource = {
        get: (id) => this.repo.get(id),
        children: (id) => this.repo.children(id),
        // A private page or database kept among the notes stays out of them.
        blocksToMarkdown: (blocks) =>
          markdown.blocksToMarkdown(this.repo, blocks, { hidden: privacyChecker({ get: (id) => this.repo.get(id) }) })
      }
      const meeting = loadMeeting(source, pageId)
      if (!meeting) throw new Error('This meeting has no transcript yet.')
      return buildPrompt(
        request,
        { meeting: await prepareMeeting(meeting, language, condense, abort.signal) },
        { defaultLanguage: language }
      )
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

  private start(request: AiRequest, sender: WebContents, build?: PromptBuilder, onEnd?: () => void, target?: RunTarget): { id: string } {
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
      build,
      target
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
      filters: windows
        ? [
            { name: 'Programs', extensions: ['exe', 'cmd', 'bat', 'ps1'] },
            { name: 'All files', extensions: ['*'] }
          ]
        : undefined
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

  // ---- Claude's MCP servers (Settings → AI → Claude's tools) ----------------

  /** Claude Code's configuration file, read now. What it holds never leaves this process except into a request's own files. */
  private async localServers(): Promise<{ servers: LocalServer[]; error?: string }> {
    let text: string
    try {
      text = await readFile(claudeConfigFile(process.env, homedir()), 'utf8')
    } catch (err) {
      // No file: Claude Code has no servers of its own here.
      return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { servers: [] } : { servers: [], error: 'unreadable' }
    }
    try {
      return { servers: readLocalServers(JSON.parse(text)) }
    } catch {
      return { servers: [], error: 'unreadable' }
    }
  }

  private catalog(): McpCatalog {
    return readCatalog(this.repo.getSetting(AI_MCP_CATALOG_KEY))
  }

  /** The servers that are on, for one request; null when none is. */
  private async externalPlan(): Promise<ExternalPlan | null> {
    const choices = mcpChoices(this.repo.getSetting(AI_MCP_SERVERS_KEY))
    if (!Object.keys(choices).length) return null
    const { servers } = await this.localServers()
    return planExternal({ choices, local: servers, catalog: this.catalog() })
  }

  async servers(): Promise<ClaudeServerList> {
    const { servers, error } = await this.localServers()
    const catalog = this.catalog()
    return { servers: listServers(servers, catalog), connectorsAt: catalog.connectorsAt, ...(error ? { error } : {}) }
  }

  /** Asks Claude Code for the claude.ai connectors of the account and keeps their names and addresses. */
  async scanServers(): Promise<ClaudeServerList> {
    const { stdout } = await this.service.runCli(['mcp', 'list'], { timeoutMs: SCAN_TIMEOUT_MS })
    const connectors = parseMcpList(stdout)
    this.repo.setSetting(AI_MCP_CATALOG_KEY, { ...this.catalog(), connectors, connectorsAt: Date.now() } satisfies McpCatalog)
    return this.servers()
  }

  /**
   * Starts Claude Code with sel's server and this one only, reads the tools it lists once it is
   * ready, and stops it there. The prompt is a one-word one, in case the stop comes late.
   */
  async serverTools(rawId: unknown): Promise<ClaudeServerList> {
    if (!isMcpServerId(rawId)) throw new Error('Unknown server')
    const id = rawId
    const { servers } = await this.localServers()
    const catalog = this.catalog()
    const server = listServers(servers, catalog).find((entry) => entry.id === id)
    const plan = planExternal({ choices: { [id]: { access: 'all' } }, local: servers, catalog })
    if (!plan || !server) throw new Error('That server is no longer set up in Claude Code.')
    this.markdown ??= await import('../markdown')
    const grant = await this.tools.grant(undefined, { servers: plan.servers, settings: plan.settings })
    const seen: { init: Record<string, unknown> | null } = { init: null }
    try {
      const args = buildArgs({
        model: 'haiku',
        tools: {
          configPath: grant.configPath,
          maxTurns: 2,
          external: grant.settingsPath ? { settingsPath: grant.settingsPath, connectors: plan.connectors } : null
        }
      })
      await this.service.runCli(args, {
        stdin: 'Reply with the single word ok.',
        timeoutMs: TOOLS_TIMEOUT_MS,
        stopWhen: (line) => {
          try {
            const event = JSON.parse(line) as Record<string, unknown>
            if (event['type'] === 'system' && event['subtype'] === 'init') seen.init = event
          } catch {
            /* not an event */
          }
          return seen.init !== null
        }
      })
    } finally {
      grant.release()
    }
    const event = seen.init
    if (!event) throw new Error('Claude Code did not say which tools the server has.')
    const listed = Array.isArray(event['mcp_servers']) ? (event['mcp_servers'] as { name?: unknown; status?: unknown }[]) : []
    const status = listed.find((entry) => entry.name === server.name)?.status
    const names = toolsOfServer(event['tools'], server.name)
    if (!names.length && status !== 'connected') {
      throw new Error(
        status === 'needs-auth'
          ? 'The server needs you to sign in again in Claude Code (run /mcp there).'
          : `The server did not connect${typeof status === 'string' ? ` (${status.slice(0, 40)})` : ''}.`
      )
    }
    const fresh = this.catalog()
    this.repo.setSetting(AI_MCP_CATALOG_KEY, { ...fresh, tools: { ...fresh.tools, [id]: { names, at: Date.now() } } } satisfies McpCatalog)
    return this.servers()
  }

  dispose(): void {
    this.service.dispose()
    this.tools.dispose()
  }
}
