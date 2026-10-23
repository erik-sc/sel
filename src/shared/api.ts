import { ACTIVITY_INVOKE, type ActivityApi } from './activity'
import { AI_INVOKE, type AiApi } from './ai'
import { ALARMS_INVOKE, type AlarmsApi } from './alarms'
import { SYNC_INVOKE, type SyncApi } from './sync'
import { BRIEFING_INVOKE, type BriefingApi } from './briefing'
import { FEEDBACK_INVOKE, type FeedbackApi } from './feedback'
import { TASKS_INVOKE, type TasksApi } from './tasks/api'
import { HERMAN_INVOKE, type HermanApi } from './herman'
import type { MenuCommand } from './commands'
import type { InvokeChannels } from './ipc'
import { MCP_INVOKE, type McpApi } from './mcp'
import { MEETINGS_INVOKE, type MeetingsApi } from './meetings'
import { NOTEBOOK_INVOKE, type NotebookApi } from './notebook'
import { POMODORO_INVOKE, type PomodoroApi } from './pomodoro'
import { SKY_INVOKE, type SkyApi } from './sky'
import { TEMPLATES_INVOKE, type TemplatesApi } from './templates/model'
import { DATA_INVOKE, type DataApi } from './data'
import type { Block, ChangeEvent, CreateBlockInput, DatabaseLocation, Op, SearchResult, Theme, UpdateBlockInput } from './types'
import { UPDATES_INVOKE, type UpdatesApi } from './updates'
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
    /** Pages whose text links to this one, each once with the text around the link; not the trash. */
    backlinks(id: string): Promise<SearchResult[]>
    duplicate(id: string): Promise<Block>
    exportMarkdown(id: string): Promise<{ saved: boolean; path?: string }>
    importMarkdown(parentId: string | null): Promise<Block | null>
    /** A LaTeX document (`props.kind: 'latex'`): its source as a .tex file. */
    exportTex(id: string): Promise<{ saved: boolean; path?: string }>
    /** A LaTeX document: this window printed to PDF, its print stylesheet showing only the preview. */
    exportPdf(id: string, pageSize: 'A4' | 'Letter'): Promise<{ saved: boolean; path?: string }>
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
  ai: AiApi

  /**
   * Sync between this person's devices through a private git repository they own. sel
   * drives the git installed on this computer, which signs in by itself: no token is stored
   * here. Every method resolves with the state afterwards; what went wrong is in `lastError`.
   */
  sync: SyncApi

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
   * Backups of the database kept on this computer, restoring one, and the whole workspace as
   * Markdown files. Files are chosen in native dialogs; no path crosses over. See shared/data.ts.
   */
  data: DataApi

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
  /**
   * The Sky: each day written in Meditations lights a star, a month draws a constellation, a year
   * is a sky. Derived from the notes, plus a few happenings written under `sel-sky`. See shared/sky.
   */
  sky: SkyApi
  /**
   * The local activity log: screens and pages a window shows go in, aggregates for the heatmaps
   * come out. Never synced, never sent to AI. See shared/activity.ts.
   */
  activity: ActivityApi

  app: {
    getTheme(): Promise<Theme>
    setTheme(theme: Theme): Promise<void>
    getSetting<T = unknown>(key: string): Promise<T | null>
    setSetting(key: string, value: unknown): Promise<void>
    openExternal(url: string): Promise<void>
    newWindow(pageId?: string): Promise<void>
    /**
     * What the main process asked the windows to say and that this window has not shown yet (a
     * crash, the welcome page that could not be made). Waits for the workspace to be ready.
     */
    notices(): Promise<AppNotice[]>
    /**
     * Writes a failure the user was told about to the local log (src/main/log.ts). Only the
     * message and the error's name, message and stack are sent; fire-and-forget.
     */
    log(message: string, error?: unknown): void
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
  /** A notice from the main process while this window is open (see `app.notices`). */
  onNotice(listener: (notice: AppNotice) => void): () => void
}

/**
 * What the main process asks a window to tell the user; the words are the renderer's.
 * `crashed`: an exception nobody caught, the app may be in a bad state. `seed-failed`: the
 * first-run welcome page could not be made (tried again on the next start).
 */
export type AppNotice = 'crashed' | 'seed-failed'
export const APP_NOTICES: readonly AppNotice[] = ['crashed', 'seed-failed']

/** What `app.log` sends: strings only, capped by the main process. */
export interface RendererLogEntry {
  message: string
  error?: { name: string; message: string; stack: string }
}

/** What main sends a window from the menu and its shortcuts, declared with the commands (./commands.ts). */
export type { MenuCommand } from './commands'

/** Event and fire-and-forget channel names. Invoke channels are declared in `INVOKE` below. */
export const IPC = {
  change: 'event:change',
  command: 'event:command',
  notice: 'event:notice',
  log: 'log:error',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close'
} as const

/** Every invoke channel of `Api`: `blocks.get` answers on `blocks:get`, `briefing.calendars.list` on `briefing:calendars.list`. */
export type InvokeChannel = InvokeChannels<Api>

/**
 * The invoke channels, one per method of `Api` that returns a promise: the preload exposes these
 * and no other, and main must give each one a handler (see src/main/invoke.ts). Typecheck fails
 * when a method of `Api` is missing here or a line here names no method.
 *
 * The shell's own channels are written here; every feature's come from its fragment, next to its
 * contract (`BRIEFING_INVOKE` beside `BriefingApi`), which has a `satisfies` of its own because a
 * spread would let a channel too many through. To add a call: write the method in the feature's
 * contract, its channel in the feature's fragment and in src/preload/reviewed/<namespace>.ts, and
 * its handler in the feature's main side.
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
  'pages:backlinks': true,
  'pages:duplicate': true,
  'pages:exportMarkdown': true,
  'pages:importMarkdown': true,
  'pages:exportTex': true,
  'pages:exportPdf': true,

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

  'app:getTheme': true,
  'app:setTheme': true,
  'app:getSetting': true,
  'app:setSetting': true,
  'app:openExternal': true,
  'app:newWindow': true,
  'app:notices': true,
  'app:window.isMaximized': true,

  ...AI_INVOKE,
  ...SYNC_INVOKE,
  ...BRIEFING_INVOKE,
  ...MEETINGS_INVOKE,
  ...HERMAN_INVOKE,
  ...NOTEBOOK_INVOKE,
  ...TEMPLATES_INVOKE,
  ...DATA_INVOKE,
  ...FEEDBACK_INVOKE,
  ...TASKS_INVOKE,
  ...UPDATES_INVOKE,
  ...MCP_INVOKE,
  ...ALARMS_INVOKE,
  ...POMODORO_INVOKE,
  ...SKY_INVOKE,
  ...ACTIVITY_INVOKE
} as const satisfies Record<InvokeChannel, true>

export const FILE_PROTOCOL = 'sel-file'
