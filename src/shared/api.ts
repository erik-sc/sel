import type { AiEvent, AiRequest, AiStatus } from './ai'
import type { SyncSetup, SyncStatus } from './sync'
import type { BriefingApi } from './briefing'
import type { AgentKind, AiAgentInfo } from './council'
import type { FeedbackApi } from './feedback'
import type { HermanApi } from './herman'
import type { MeetingsApi } from './meetings'
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
import type { RestoreMode, RestoreResult, VersionInfo, VersionSnapshot, VersionStats } from './versions'

/**
 * The contract exposed on `window.api` by the preload script.
 * Every method maps to the ipc channel `<namespace>:<method>` (see IPC below).
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
   * Bug reports and suggestions the user writes in the app, kept as files on this computer for
   * the nightly development agent to pick up. See shared/feedback.ts.
   */
  feedback: FeedbackApi

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
  | 'new-tab'
  | 'close-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'quick-find'
  | 'find-in-page'
  | 'toggle-sidebar'
  | 'toggle-theme'
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
  | 'open-today'
  | 'open-calendar'
  | 'new-meeting'
  | 'send-feedback'
  | 'command-palette'
  | 'keyboard-shortcuts'

/** ipc channel names. invoke channels are `<namespace>:<method>`. */
export const IPC = {
  change: 'event:change',
  command: 'event:command',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close'
} as const

export const FILE_PROTOCOL = 'sel-file'
