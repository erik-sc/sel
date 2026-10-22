import { join } from 'node:path'
import { app, dialog, type BrowserWindow, type WebContents } from 'electron'
import { AI_CHANNELS, type AiDone, type AiError, type AiRequest, type AiStatus } from '../../shared/ai'
import type { Repository } from '../db/repository'
import { buildWorkspace } from './context'
import { inspectCli } from './locate'
import { loadMeeting, prepareMeeting, type MeetingSource } from './meeting'
import { buildPrompt, type BriefingPromptData, type PromptContext } from './prompts'
import { aiRequest, loadContext } from './request'
import { AiService, type PromptBuilder, type RunTarget } from './service'
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
        grant: async (listener) => {
          this.markdown ??= await import('../markdown')
          return this.tools.grant(listener)
        }
      },
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
        // What the assistant is shown by itself leaves archived pages out; it finds them when it searches.
        listDatabases: () => repo.listDatabases({ archived: false }),
        search: (text, limit) => repo.search(text, limit),
        pageToMarkdown: (id) => markdown.pageToMarkdown(repo, id)
      },
      request
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
    const request = aiRequest(rawRequest)
    // "Write up notes" on a meeting page: the transcript is read here, not sent by the window.
    if (request.action === 'consolidate' && !request.transcript?.trim() && request.pageId)
      return this.startMeeting(request, request.pageId, sender)
    // A question may be answered from anywhere in the workspace: the tools let the answer look.
    if (request.action === 'ask') return this.start(request, sender, undefined, undefined, { tools: { maxTurns: HERMAN_TURNS } })
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
        blocksToMarkdown: (blocks) => markdown.blocksToMarkdown(this.repo, blocks)
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

  dispose(): void {
    this.service.dispose()
    this.tools.dispose()
  }
}
