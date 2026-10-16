import type { AiEvent, AiRequest, AiStatus } from './ai'
import type { AlarmsApi } from './alarms'
import type { SyncSetup, SyncStatus } from './sync'
import type { BriefingApi } from './briefing'
import type { AgentKind, AiAgentInfo } from './council'
import type { FeedbackApi } from './feedback'
import type { TasksApi } from './tasks/api'
import type { HermanApi } from './herman'
import type { InvokeChannels } from './ipc'
import type { McpApi } from './mcp'
import type { MeetingsApi } from './meetings'
import type { NotebookApi } from './notebook'
import type { PomodoroApi } from './pomodoro'
import type { TemplatesApi } from './templates/model'
import type {
  Block,
  ChangeEvent,
  CreateBlockInput,
  DatabaseLocation,
  Op,
  SearchResult,
  Theme,
  UpdateBlockInput
} from './types'
import type { UpdatesApi } from './updates'
import type { RestoreMode, RestoreResult, VersionInfo, VersionSnapshot, VersionStats } from './versions'

/**
 * The contract exposed on `window.api` by the preload script.
 * Every method that returns a promise is an invoke call on the channel `<namespace>:<method>`,
 * declared once in `INVOKE` below; events and fire-and-forget sends are named in `IPC`.
 * All mutations are applied in one SQLite transaction and broadcast a ChangeEvent.
 */
export interface Api {
  /** Unique per window; ChangeEvent.origin equals this for self-made changes. */
  clientId: string

  blocks: {
    get(id: string): Promise<Block | null>
    getMany(ids: string[]): Promise<Block[]>
    /**
     * The block `rootId` plus all its descendants, without descending into
     * nested pages or databases (those are included themselves, their content is not).
     */
    getTree(rootId: string): Promise<Block[]>
    /** Direct children, in order. */
    children(id: string): Promise<Block[]>
    create(input: CreateBlockInput): Promise<Block>
    update(id: string, patch: UpdateBlockInput): Promise<Block>
    move(id: string, parentId: string | null, afterId?: string | null): Promise<Block>
    /**
     * Pages and databases go to the trash; other blocks (linked database views included)
     * are removed with their descendants.
     */
    delete(id: string): Promise<void>
    /** Atomic batch. Returns the affected blocks (deleted ones omitted). */
    apply(ops: Op[]): Promise<Block[]>
  }

  pages: {
    /** Non-trashed pages/databases with parentId null, in workspace order. */
    listRoot(): Promise<Block[]>
    /** Non-trashed pages/databases that are direct children of a page (for the sidebar tree). */
    listChildren(pageId: string): Promise<Block[]>
    listFavorites(): Promise<Block[]>
    listRecent(limit?: number): Promise<Block[]>
    listTrash(): Promise<Block[]>
    /** Pages and databases archived by themselves, outside the trash, the most recently archived first. */
    listArchived(): Promise<Block[]>
    restore(id: string): Promise<void>
    deleteForever(id: string): Promise<void>
    /** Ancestor pages of a block, root first, excluding the block itself. */
    ancestors(id: string): Promise<Block[]>
    duplicate(id: string): Promise<Block>
    exportMarkdown(id: string): Promise<{ saved: boolean; path?: string }>
    importMarkdown(parentId: string | null): Promise<Block | null>
  }

  databases: {
    /**
     * Every database that can be the source of a linked view: not in the trash, not itself
     * a linked view, most recently edited first.
     */
    list(): Promise<Block[]>
    /**
     * Every linked view of a source database that is not in the trash, with the page that
     * contains it. Given a linked view, answers for its source.
     */
    locations(sourceId: string): Promise<DatabaseLocation[]>
  }

  search: {
    query(text: string, limit?: number): Promise<SearchResult[]>
  }

  /**
   * Version history. Every page (and database) keeps snapshots of its own content, taken
   * automatically while it is edited; see shared/versions.ts for what a snapshot holds.
   */
  versions: {
    /** Versions of a page, newest first, without their content. Unreadable rows are left out. */
    list(pageId: string): Promise<VersionInfo[]>
    /** One version, decoded and checked. Rejects when it is missing or damaged. */
    get(id: string): Promise<VersionSnapshot>
    /** The page as it is now, in the shape of a version (`info` is null). */
    current(pageId: string): Promise<VersionSnapshot>
    /** Stores the current state as a saved version that is never pruned. */
    save(pageId: string, label?: string | null): Promise<VersionInfo>
    rename(id: string, label: string | null): Promise<VersionInfo>
    delete(id: string): Promise<void>
    /**
     * `replace` saves the current state first (`backupId`) and makes the page equal to the
     * version; `copy` creates a sibling page from it. Sub-pages are never destroyed.
     */
    restore(id: string, mode: RestoreMode): Promise<RestoreResult>
    /** Stored versions and their compressed size: of one page, or of everything. */
    stats(pageId?: string): Promise<VersionStats>
    /** Deletes the history of one page, or all history. */
    clear(pageId?: string): Promise<void>
  }

  files: {
    /** Opens a file picker, copies the image into the app data dir and returns a `sel-file://` url. */
    pickImage(): Promise<string | null>
    /** Stores pasted/dropped image bytes and returns a `sel-file://` url. */
    saveImage(data: ArrayBuffer, extension: string): Promise<string>
    /**
     * Asks where to save a PNG the renderer generated (a chart) and writes it there.
     * The bytes must be a PNG within the size cap; the path comes from the save dialog only.
     */
    saveGeneratedImage(pngBytes: ArrayBuffer | Uint8Array): Promise<{ saved: boolean; path?: string }>
  }

  /**
   * AI workflows. sel drives the Claude Code program installed on this computer, signed in
   * with the user's own account: no key is stored here and sel makes no network request.
   * The prompt is built in the main process from the ids and options in the request.
   */
  ai: {
    /** Whether the program was found and answers; cached unless `refresh`. */
    status(refresh?: boolean): Promise<AiStatus>
    /**
     * Starts a request and resolves with its id at once. Its text, its end and any failure
     * (including the program missing) arrive through `onEvent`. Rejects only for an invalid request.
     */
    run(request: AiRequest): Promise<{ id: string }>
    /** Stops a request of this window. Resolves false when it was already over. */
    cancel(id: string): Promise<boolean>
    /**
     * Opens a file dialog to choose the program and stores the choice (`ai.cliPath`), the only way
     * that setting gets a value. Null when cancelled; otherwise the status with the chosen file.
     */
    pickCli(): Promise<AiStatus | null>
    /**
     * Other programs that can answer for a seat of Herman's council (see shared/council.ts).
     * A program's path only ever comes from a search of PATH or the native file dialog.
     */
    agents: {
      list(): Promise<AiAgentInfo[]>
      /** Connects a program of this kind: found on PATH, or (with `pick`, or when not found) chosen in a file dialog. Null when cancelled. */
      connect(kind: AgentKind, pick?: boolean): Promise<AiAgentInfo | null>
      remove(id: string): Promise<AiAgentInfo[]>
    }
    /** `ai:delta`, `ai:done`, `ai:error` and `ai:council` for this window's requests. Returns an unsubscribe function. */
    onEvent(listener: (event: AiEvent) => void): () => void
  }

  /**
   * Sync between this person's devices through a private git repository they own. sel
   * drives the git installed on this computer, which signs in by itself: no token is stored
   * here. Every method resolves with the state afterwards; what went wrong is in `lastError`.
   */
  sync: {
    status(): Promise<SyncStatus>
    /**
     * Connects this device and runs the first sync. When a decision is needed (`needs-choice`,
     * `not-sel-repo`, `passphrase-required`…) `lastError` names it and nothing was set up.
     */
    setup(input: SyncSetup): Promise<SyncStatus>
    now(): Promise<SyncStatus>
    pause(paused: boolean): Promise<SyncStatus>
    /** Stops syncing on this device and removes its local clone. Nothing on the remote is ever deleted. */
    disconnect(options: { keepRemote: true }): Promise<SyncStatus>
    /**
     * Opens a file dialog to choose the git program and stores the choice (`sync.gitPath`), the
     * only way that setting gets a value. Null when cancelled.
     */
    pickGit(): Promise<SyncStatus | null>
    /** Enters the passphrase of a repository another device encrypted. */
    unlock(passphrase: string): Promise<SyncStatus>
    /** Turns encryption on or changes the passphrase (a string), or turns it off (null): everything is uploaded again. */
    setEncryption(passphrase: string | null): Promise<SyncStatus>
    /** `sync:status`, sent to every window whenever the state changes. Returns an unsubscribe function. */
    onStatus(listener: (status: SyncStatus) => void): () => void
  }

  /**
   * The morning briefing ("Today"): calendars the user connected, open tasks, the day's phrase.
   * See shared/briefing.ts. A calendar's address goes in once and never comes back.
   */
  briefing: BriefingApi

  /**
   * Meeting recording: microphone and computer audio into local files, a transcript made on this
   * computer by whisper.cpp, and notes written up by the AI service. See shared/meetings.ts.
   */
  meetings: MeetingsApi

  /**
   * Herman, the face and the voice of the assistant: his settings as the main process reads
   * them, and the short lines he offers unasked, which are composed locally and never by a
   * model. See shared/herman.ts.
   */
  herman: HermanApi

  /**
   * The ink notebook: one line a day, written while the day lasts and kept as it is after, and
   * the ritual that closes the day. Stored as blocks, so it syncs. See shared/notebook.ts.
   */
  notebook: NotebookApi

  /** Templates of pages and databases (see shared/templates): making one is a single transaction. */
  templates: TemplatesApi

  /**
   * Bug reports and suggestions the user writes in the app, kept as files on this computer for
   * the nightly development agent to pick up. See shared/feedback.ts.
   */
  feedback: FeedbackApi

  /** The Tasks feature's calls beyond block edits: Todoist import, the system-wide quick add. See shared/tasks/api.ts. */
  tasks: TasksApi

  /**
   * New versions from the project's GitHub Releases: looked for once a day only when the user
   * turned that on, downloaded and installed only when they say so. See shared/updates.ts.
   */
  updates: UpdatesApi

  /**
   * Other apps (Claude Desktop, Claude Code, any MCP client) connected to the notes over MCP, when
   * the user turned that on: the state of the endpoint, and a new token. See shared/mcp.ts.
   */
  mcp: McpApi

  /**
   * The times of day Herman briefs the user, aloud if they like, and the reminders of tasks
   * that carry a time: kept by the main process's clock, said in a window. See shared/alarms.ts.
   */
  alarms: AlarmsApi

  /**
   * The pomodoro timer: kept by the main process, so it outlives a reload and every window shows
   * the same; a phase never starts by itself. See shared/pomodoro.ts.
   */
  pomodoro: PomodoroApi

  app: {
    getTheme(): Promise<Theme>
    setTheme(theme: Theme): Promise<void>
    getSetting<T = unknown>(key: string): Promise<T | null>
    setSetting(key: string, value: unknown): Promise<void>
    openExternal(url: string): Promise<void>
    newWindow(pageId?: string): Promise<void>
    /** Node's `process.platform`, e.g. 'win32' | 'darwin' | 'linux'. */
    platform: string
    window: {
      minimize(): void
      toggleMaximize(): void
      close(): void
      isMaximized(): Promise<boolean>
    }
  }

  /** Subscribe to data changes from any window. Returns an unsubscribe function. */
  onChange(listener: (event: ChangeEvent) => void): () => void
  /** Menu/accelerator commands forwarded from the main process (see MenuCommand). */
  onCommand(listener: (command: MenuCommand, arg?: unknown) => void): () => void
}

export type MenuCommand =
  | 'new-page'
  /** Opens the template gallery. */
  | 'new-from-template'
  | 'new-tab'
  | 'close-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'quick-find'
  | 'find-in-page'
  | 'toggle-sidebar'
  | 'toggle-theme'
  | 'toggle-focus-mode'
  | 'go-back'
  | 'go-forward'
  | 'open-settings'
  | 'open-page'
  /** arg: 1-based tab position; 9 means the last tab */
  | 'select-tab'
  | 'reopen-tab'
  | 'new-window'
  | 'version-history'
  | 'toggle-assistant'
  | 'go-home'
  | 'open-today'
  | 'open-calendar'
  | 'open-tasks'
  /** Opens Tasks with the quick-add input focused. */
  | 'add-task'
  | 'open-notebook'
  | 'close-day'
  | 'new-meeting'
  | 'send-feedback'
  | 'command-palette'
  | 'keyboard-shortcuts'
  /** Starts a pomodoro; with one on, shows its controls. */
  | 'start-pomodoro'

/** Event and fire-and-forget channel names. Invoke channels are declared in `INVOKE` below. */
export const IPC = {
  change: 'event:change',
  command: 'event:command',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close'
} as const

/** Every invoke channel of `Api`: `blocks.get` answers on `blocks:get`, `ai.agents.list` on `ai:agents.list`. */
export type InvokeChannel = InvokeChannels<Api>

/**
 * The invoke channels, one per method of `Api` that returns a promise: the preload exposes these
 * and no other, and main must give each one a handler (see src/main/invoke.ts). Typecheck fails
 * when a method of `Api` is missing here or a line here names no method. To add a call: write the
 * method in `Api` (or a feature's contract), add its channel here, and add its handler in main.
 */
export const INVOKE = {
  'blocks:get': true,
  'blocks:getMany': true,
  'blocks:getTree': true,
  'blocks:children': true,
  'blocks:create': true,
  'blocks:update': true,
  'blocks:move': true,
  'blocks:delete': true,
  'blocks:apply': true,

  'pages:listRoot': true,
  'pages:listChildren': true,
  'pages:listFavorites': true,
  'pages:listRecent': true,
  'pages:listTrash': true,
  'pages:listArchived': true,
  'pages:restore': true,
  'pages:deleteForever': true,
  'pages:ancestors': true,
  'pages:duplicate': true,
  'pages:exportMarkdown': true,
  'pages:importMarkdown': true,

  'databases:list': true,
  'databases:locations': true,

  'search:query': true,

  'versions:list': true,
  'versions:get': true,
  'versions:current': true,
  'versions:save': true,
  'versions:rename': true,
  'versions:delete': true,
  'versions:restore': true,
  'versions:stats': true,
  'versions:clear': true,

  'files:pickImage': true,
  'files:saveImage': true,
  'files:saveGeneratedImage': true,

  'ai:status': true,
  'ai:run': true,
  'ai:cancel': true,
  'ai:pickCli': true,
  'ai:agents.list': true,
  'ai:agents.connect': true,
  'ai:agents.remove': true,

  'sync:status': true,
  'sync:setup': true,
  'sync:now': true,
  'sync:pause': true,
  'sync:disconnect': true,
  'sync:pickGit': true,
  'sync:unlock': true,
  'sync:setEncryption': true,

  'briefing:get': true,
  'briefing:agenda': true,
  'briefing:anotherPhrase': true,
  'briefing:calendars.list': true,
  'briefing:calendars.add': true,
  'briefing:calendars.update': true,
  'briefing:calendars.remove': true,
  'briefing:calendars.test': true,
  'briefing:completeTask': true,
  'briefing:undoCompleteTask': true,
  'briefing:ensurePhrasesDatabase': true,
  'briefing:addPhrase': true,
  'briefing:databases': true,
  'briefing:brief': true,

  'meetings:status': true,
  'meetings:engine.status': true,
  'meetings:engine.download': true,
  'meetings:engine.cancelDownload': true,
  'meetings:engine.pickProgram': true,
  'meetings:engine.pickModel': true,
  'meetings:engine.remove': true,
  'meetings:create': true,
  'meetings:recording.probe': true,
  'meetings:recording.begin': true,
  'meetings:recording.pause': true,
  'meetings:recording.resume': true,
  'meetings:recording.stop': true,
  'meetings:recording.recover': true,
  'meetings:recording.discard': true,
  'meetings:transcribe': true,
  'meetings:cancelTranscribe': true,
  'meetings:setSpeakers': true,
  'meetings:audio.info': true,
  'meetings:audio.delete': true,
  'meetings:storage': true,
  'meetings:openFolder': true,

  'herman:state': true,
  'herman:nudge.next': true,
  'herman:nudge.dismiss': true,
  'herman:met': true,
  'herman:reset': true,

  'notebook:get': true,
  'notebook:write': true,
  'notebook:plan': true,
  'notebook:dismissPlans': true,
  'notebook:review': true,

  'templates:create': true,

  'feedback:list': true,
  'feedback:create': true,
  'feedback:withdraw': true,
  'feedback:openFolder': true,
  'tasks:importTodoist': true,
  'tasks:globalShortcut': true,
  'tasks:setGlobalShortcut': true,

  'updates:status': true,
  'updates:check': true,
  'updates:download': true,
  'updates:restart': true,
  'updates:dismiss': true,

  'mcp:status': true,
  'mcp:rotateToken': true,
  'alarms:pending': true,
  'alarms:heard': true,
  'alarms:snooze': true,
  'alarms:test': true,

  'pomodoro:state': true,
  'pomodoro:start': true,
  'pomodoro:pause': true,
  'pomodoro:resume': true,
  'pomodoro:skip': true,
  'pomodoro:next': true,
  'pomodoro:stop': true,

  'app:getTheme': true,
  'app:setTheme': true,
  'app:getSetting': true,
  'app:setSetting': true,
  'app:openExternal': true,
  'app:newWindow': true,
  'app:window.isMaximized': true
} as const satisfies Record<InvokeChannel, true>

export const FILE_PROTOCOL = 'sel-file'
