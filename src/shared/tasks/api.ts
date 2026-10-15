/**
 * The `tasks:*` calls: what the Tasks feature asks of the main process beyond ordinary block
 * edits. Importing a Todoist export (the main process opens the file dialog and reads the files;
 * the window never names a path) and the system-wide quick-add shortcut.
 */

export interface TodoistImportResult {
  /** False when the dialog was closed without choosing a file. */
  imported: boolean
  tasks: number
  /** The projects the files became (one per file). */
  projects: string[]
  /** Lines that were not tasks and were left out (sections, empty lines, unknown types). */
  skipped: number
}

/** The system-wide shortcut that opens the small quick-add window. Off unless turned on. */
export interface GlobalShortcutSetting {
  enabled: boolean
  /** An Electron accelerator, such as `CommandOrControl+Alt+Space`. */
  accelerator: string
}

export interface GlobalShortcutState extends GlobalShortcutSetting {
  /** Whether the system gave the app the keys (another app may hold them). */
  registered: boolean
}

export const GLOBAL_SHORTCUT_KEY = 'tasks.globalShortcut'
export const DEFAULT_GLOBAL_SHORTCUT: GlobalShortcutSetting = { enabled: false, accelerator: 'CommandOrControl+Alt+Space' }

const MODIFIERS = new Set(['command', 'cmd', 'control', 'ctrl', 'commandorcontrol', 'cmdorctrl', 'alt', 'option', 'altgr', 'shift', 'super', 'meta'])
const KEY_RE = /^(?:[A-Za-z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Plus|[`~!@#$%^&*()\-_=[\]{};:'",.<>/?\\|])$/

/**
 * A clean accelerator, or null: at least one modifier and exactly one key, as Electron spells them.
 * A shortcut without a modifier would take a key away from every other program.
 */
export function cleanAccelerator(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 60) return null
  const parts = value.split('+').map((part) => part.trim())
  if (parts.length < 2 || parts.some((part) => !part)) return null
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)
  if (!modifiers.every((part) => MODIFIERS.has(part.toLowerCase()))) return null
  if (new Set(modifiers.map((part) => part.toLowerCase())).size !== modifiers.length) return null
  if (!KEY_RE.test(key) || MODIFIERS.has(key.toLowerCase())) return null
  return parts.join('+')
}

/** The stored setting, or the default for anything malformed. */
export function cleanGlobalShortcut(value: unknown): GlobalShortcutSetting {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_GLOBAL_SHORTCUT }
  const record = value as Record<string, unknown>
  return {
    enabled: record['enabled'] === true,
    accelerator: cleanAccelerator(record['accelerator']) ?? DEFAULT_GLOBAL_SHORTCUT.accelerator
  }
}

export interface TasksApi {
  /** Asks for one or more Todoist CSV exports and adds their tasks to the Tasks database. */
  importTodoist(): Promise<TodoistImportResult>
  globalShortcut(): Promise<GlobalShortcutState>
  /** Stores the setting and (un)registers the keys at once. Fails on a malformed accelerator. */
  setGlobalShortcut(setting: GlobalShortcutSetting): Promise<GlobalShortcutState>
}
