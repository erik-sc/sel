// The commands the app has out of the box: every command with a palette entry in its spec
// (src/shared/commands.ts), plus what the shell and the page menu offer. A feature's command
// comes with its spec; anything else it offers it registers from its gate (registerCommand).
import { COMMANDS, type CommandSpec, type MenuCommand } from '@shared/commands'
import type { Block, Theme } from '@shared/types'
import { acceleratorOf } from '@shared/shortcuts'
import { getBlock } from '@/store/blocks'
import { activeTab, tabPage } from '@/store/tabs'
import { setFocusDim, setFocusMode, setHistoryPage, setSettingsOpen, setTheme, useUi, type SettingsSection } from '@/store/ui'
import { aiEnabled, requestPageAi } from '@/ai/gate'
import { routeTitle } from '@/screens'
import { IS_MAC } from '@/ui/platform'
import { preloadVersionHistory } from '@/versions/VersionHistory'
import { duplicatePage, exportMarkdown, importMarkdown, reportError, toggleFavorite, toggleFullWidth } from '@/shell/actions'
import { menuHandlers, runMenuCommand } from '@/shell/menuCommands'
import { archivePage, canArchive, isArchived, unarchivePage } from '@/archive/actions'
import { ARCHIVE_KEYWORDS } from '@/archive/copy'
import { archiveCopy } from '@/archive/locale'
import { customizeSidebar, sidebarCopy } from '@/shell/sidebarLayout'
import { SIDEBAR_KEYWORDS } from '@/shell/sidebarCopy'
import { openSidebarPanel } from '@/shell/sidebarPanels'
import { registerCommands, type Command } from './registry'

/** The page (or database) in the active tab, if it is one and not in the Trash. */
function currentPage(): Block | null {
  const pageId = tabPage(activeTab())
  if (!pageId || routeTitle(pageId)) return null
  const block = getBlock(pageId)
  return block && !block.trashedAt ? block : null
}

/** A command that runs a page action on the current page, and is there only when there is one. */
function onPage(command: Omit<Command, 'run' | 'when'> & { when?: (page: Block) => boolean; run: (page: Block) => void }): Command {
  const { when, run, ...rest } = command
  return {
    ...rest,
    when: () => {
      const page = currentPage()
      return !!page && (!when || when(page))
    },
    run: () => {
      const page = currentPage()
      if (page) run(page)
    }
  }
}

/** The palette's entry for a command with one in its spec: the menu's shortcut, its handler's `when`. */
function fromSpec(spec: CommandSpec & { palette: NonNullable<CommandSpec['palette']> }): [number, Command] {
  const command = spec.id as MenuCommand
  const { title, keywords, order } = spec.palette
  const when = menuHandlers()[command].when
  return [order, { id: command, title, keywords, shortcut: acceleratorOf(command, IS_MAC), when, run: () => runMenuCommand(command) }]
}

function openSettings(section: SettingsSection): void {
  useUi.setState({ settingsSection: section })
  setSettingsOpen(true)
}

const SETTINGS: [SettingsSection, string, string[]][] = [
  ['general', 'General', ['import', 'theme', 'home', 'startup']],
  ['appearance', 'Appearance', ['colours', 'colors', 'font', 'look']],
  ['sidebar', 'Sidebar', SIDEBAR_KEYWORDS],
  ['history', 'History', ['versions', 'snapshots']],
  ['ai', 'AI', ['claude', 'assistant']],
  ['herman', 'Herman', ['assistant', 'council']],
  ['notifications', 'Notifications', ['notificações', 'reminders', 'lembretes', 'alarms', 'events', 'tray', 'bandeja']],
  ['sync', 'Sync', ['git', 'devices', 'backup']],
  ['today', 'Today', ['calendar', 'briefing', 'bell', 'close the day', 'sky', 'céu', 'hemisphere', 'rare nights']],
  ['meetings', 'Meetings', ['recording', 'transcription', 'whisper']],
  ['pomodoro', 'Pomodoro', ['timer', 'focus', 'break', 'tomato']],
  ['mcp', 'MCP', ['connect', 'other apps', 'claude desktop', 'claude code', 'token']]
]

const FOCUS_WORDS = ['zen', 'distraction free', 'writing', 'hide']

/** Archive or unarchive the current page; the title is read when the palette lists it, in the archive's language. */
function archiveCommand(id: string, archived: boolean, title: () => string): Command {
  return {
    id,
    get title() {
      return title()
    },
    keywords: ARCHIVE_KEYWORDS,
    when: () => {
      const page = currentPage()
      return canArchive(page) && isArchived(page) === archived
    },
    run: () => {
      const page = currentPage()
      if (page) void (archived ? unarchivePage(page.id) : archivePage(page.id))
    }
  }
}

const THEMES: [Theme, string][] = [
  ['light', 'Use the light theme'],
  ['dark', 'Use the dark theme'],
  ['system', 'Follow the system theme']
]

/** Commands numbered from `from`, ten apart: where they sit among the commands' own entries (`palette.order`). */
function numbered(from: number, commands: readonly Command[]): [number, Command][] {
  return commands.map((command, index) => [from + index * 10, command])
}

// The shell's own entries, in runs between the commands' (new-page at 10 … toggle-sidebar at 230).
const OWN: [number, Command][] = [
  ...numbered(240, [
    {
      id: 'customize-sidebar',
      get title() {
        return sidebarCopy().customizeCommand
      },
      keywords: SIDEBAR_KEYWORDS,
      run: customizeSidebar
    },
    // The Trash and the Archive stay at hand when their sidebar buttons are hidden.
    {
      id: 'open-trash',
      get title() {
        return sidebarCopy().openTrash
      },
      keywords: ['trash', 'lixeira', 'deleted', 'restore', 'apagadas'],
      run: () => openSidebarPanel('trash')
    },
    {
      id: 'open-archive',
      get title() {
        return sidebarCopy().openArchive
      },
      keywords: ['archive', 'arquivo', 'archived', 'arquivadas'],
      run: () => openSidebarPanel('archive')
    }
  ]),
  // 270: toggle-focus-mode
  ...numbered(280, [
    {
      id: 'leave-focus-mode',
      title: 'Leave focus mode',
      keywords: FOCUS_WORDS,
      shortcut: acceleratorOf('toggle-focus-mode', IS_MAC),
      when: () => useUi.getState().focusMode,
      run: () => setFocusMode(false)
    },
    {
      id: 'focus-dim',
      title: 'Focus mode, fading all but the block you write in',
      keywords: [...FOCUS_WORDS, 'dim', 'fade', 'paragraph', 'typewriter'],
      when: () => !useUi.getState().focusDim,
      run: () => setFocusDim(true)
    },
    {
      id: 'focus-no-dim',
      title: 'Stop fading the other blocks in focus mode',
      keywords: [...FOCUS_WORDS, 'dim', 'fade', 'paragraph', 'typewriter'],
      when: () => useUi.getState().focusDim,
      run: () => setFocusDim(false)
    }
  ]),
  // 310: toggle-theme
  ...numbered(
    320,
    THEMES.map(
      ([theme, title]): Command => ({
        id: `theme-${theme}`,
        title,
        keywords: ['theme', 'appearance', 'mode'],
        run: () => setTheme(theme)
      })
    )
  ),
  ...numbered(350, [
    onPage({
      id: 'page-history',
      title: 'Version history of this page',
      keywords: ['versions', 'restore', 'undo', 'snapshots'],
      shortcut: acceleratorOf('version-history', IS_MAC),
      run: (page) => {
        preloadVersionHistory()
        setHistoryPage(page.id)
      }
    }),
    onPage({
      id: 'page-export-markdown',
      title: 'Export this page as Markdown…',
      keywords: ['save', 'download', 'md', 'file'],
      run: (page) => void exportMarkdown(page.id).catch(reportError('export the page'))
    }),
    {
      id: 'import-markdown',
      title: 'Import a Markdown file…',
      keywords: ['open', 'md', 'file'],
      run: () => void importMarkdown(null).catch(reportError('import the file'))
    },
    onPage({
      id: 'page-duplicate',
      title: 'Duplicate this page',
      keywords: ['copy'],
      run: (page) => void duplicatePage(page.id, { open: true }).catch(reportError('duplicate the page'))
    }),
    onPage({
      id: 'page-favorite',
      title: 'Add this page to Favorites',
      keywords: ['star', 'pin'],
      when: (page) => !page.props.favorite,
      run: (page) => void toggleFavorite(page.id).catch(reportError('update Favorites'))
    }),
    onPage({
      id: 'page-unfavorite',
      title: 'Remove this page from Favorites',
      keywords: ['star', 'unpin'],
      when: (page) => !!page.props.favorite,
      run: (page) => void toggleFavorite(page.id).catch(reportError('update Favorites'))
    }),
    archiveCommand('page-archive', false, () => archiveCopy().archiveThisPage),
    archiveCommand('page-unarchive', true, () => archiveCopy().unarchiveThisPage),
    onPage({
      id: 'page-full-width',
      title: 'Full width',
      keywords: ['wide', 'layout'],
      when: (page) => page.type === 'page' && !page.props.fullWidth,
      run: (page) => void toggleFullWidth(page.id).catch(reportError('change the page width'))
    }),
    onPage({
      id: 'page-normal-width',
      title: 'Normal width',
      keywords: ['narrow', 'layout', 'full width'],
      when: (page) => page.type === 'page' && !!page.props.fullWidth,
      run: (page) => void toggleFullWidth(page.id).catch(reportError('change the page width'))
    }),
    onPage({
      id: 'page-new-window',
      title: 'Open this page in a new window',
      run: (page) => void window.api.app.newWindow(page.id).catch(reportError('open a new window'))
    }),
    onPage({
      id: 'page-ai-summarize',
      title: 'Summarize this page',
      keywords: ['ai', 'herman', 'summary'],
      when: (page) => page.type === 'page' && aiEnabled(),
      run: (page) => requestPageAi(page.id, 'summarize')
    }),
    onPage({
      id: 'page-ai-title',
      title: 'Suggest a title for this page',
      keywords: ['ai', 'herman', 'rename'],
      when: (page) => page.type === 'page' && aiEnabled(),
      run: (page) => requestPageAi(page.id, 'title')
    })
  ]),
  // 480: open-settings, then each section of Settings
  ...numbered(
    500,
    SETTINGS.map(
      ([section, label, keywords]): Command => ({
        id: `settings-${section}`,
        title: `Settings: ${label}`,
        keywords: ['preferences', 'options', ...keywords],
        run: () => openSettings(section)
      })
    )
  )
  // 900: keyboard-shortcuts, 910: send-feedback
]

export const BUILTIN_COMMANDS: readonly Command[] = [
  ...(COMMANDS as readonly CommandSpec[]).flatMap((spec) => (spec.palette ? [fromSpec({ ...spec, palette: spec.palette })] : [])),
  ...OWN
]
  .sort(([a], [b]) => a - b)
  .map(([, command]) => command)

registerCommands(BUILTIN_COMMANDS)
