// The commands the app has out of the box: everything in the app menu, plus what the shell
// and the page menu offer. A new feature adds a line here, or calls registerCommand from its gate.
import type { Block, Theme } from '@shared/types'
import type { MenuCommand } from '@shared/api'
import { acceleratorOf } from '@shared/shortcuts'
import { getBlock } from '@/store/blocks'
import { activeTab, tabPage } from '@/store/tabs'
import { setFocusDim, setFocusMode, setHistoryPage, setSettingsOpen, setTheme, useUi, type SettingsSection } from '@/store/ui'
import { aiEnabled, requestPageAi } from '@/ai/gate'
import { routeTitle } from '@/briefing/route'
import { IS_MAC } from '@/ui/platform'
import { preloadVersionHistory } from '@/versions/VersionHistory'
import { duplicatePage, exportMarkdown, importMarkdown, reportError, toggleFavorite, toggleFullWidth } from '@/shell/actions'
import { runMenuCommand } from '@/shell/menuCommands'
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

/** A command that sends a menu command, with the menu's shortcut. */
function menu(command: MenuCommand, title: string, keywords?: readonly string[], when?: () => boolean): Command {
  return { id: command, title, keywords, shortcut: acceleratorOf(command, IS_MAC), when, run: () => runMenuCommand(command) }
}

function openSettings(section: SettingsSection): void {
  useUi.setState({ settingsSection: section })
  setSettingsOpen(true)
}

const SETTINGS: [SettingsSection, string, string[]][] = [
  ['general', 'General', ['import', 'theme']],
  ['appearance', 'Appearance', ['colours', 'colors', 'font', 'look']],
  ['history', 'History', ['versions', 'snapshots']],
  ['ai', 'AI', ['claude', 'assistant']],
  ['herman', 'Herman', ['assistant', 'council']],
  ['sync', 'Sync', ['git', 'devices', 'backup']],
  ['today', 'Today', ['calendar', 'briefing']],
  ['meetings', 'Meetings', ['recording', 'transcription', 'whisper']]
]

const FOCUS_WORDS = ['zen', 'distraction free', 'writing', 'hide']

const THEMES: [Theme, string][] = [
  ['light', 'Use the light theme'],
  ['dark', 'Use the dark theme'],
  ['system', 'Follow the system theme']
]

export const BUILTIN_COMMANDS: readonly Command[] = [
  menu('new-page', 'New page', ['create', 'add', 'note']),
  menu('quick-find', 'Find a page…', ['search', 'open', 'go to', 'jump']),
  menu('find-in-page', 'Find in this page…', ['search', 'word', 'text']),
  menu('open-today', 'Today', ['briefing', 'agenda', 'tasks']),
  menu('open-calendar', 'Calendar', ['events', 'schedule', 'agenda']),
  menu('open-tasks', 'Tasks', ['todo', 'to-do', 'inbox', 'todoist']),
  menu('add-task', 'Add a task…', ['new task', 'quick add', 'todo']),
  menu('new-meeting', 'New meeting', ['record', 'transcribe', 'call']),
  menu('toggle-assistant', 'Herman, the assistant', ['ai', 'ask', 'chat', 'claude'], aiEnabled),
  menu('new-tab', 'New tab'),
  menu('close-tab', 'Close tab'),
  menu('reopen-tab', 'Reopen closed tab', ['undo close', 'restore']),
  menu('next-tab', 'Next tab'),
  menu('prev-tab', 'Previous tab'),
  menu('go-back', 'Back', ['history', 'navigate']),
  menu('go-forward', 'Forward', ['history', 'navigate']),
  menu('new-window', 'New window'),
  menu('toggle-sidebar', 'Show or hide the sidebar', ['collapse', 'expand', 'panel']),
  menu('toggle-focus-mode', 'Focus mode: only the page', FOCUS_WORDS, () => !useUi.getState().focusMode),
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
  },
  menu('toggle-theme', 'Switch between light and dark', ['theme', 'dark mode', 'night']),
  ...THEMES.map(([theme, title]): Command => ({
    id: `theme-${theme}`,
    title,
    keywords: ['theme', 'appearance', 'mode'],
    run: () => setTheme(theme)
  })),
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
  { id: 'import-markdown', title: 'Import a Markdown file…', keywords: ['open', 'md', 'file'], run: () => void importMarkdown(null).catch(reportError('import the file')) },
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
  }),
  menu('open-settings', 'Settings', ['preferences', 'options']),
  ...SETTINGS.map(([section, label, keywords]): Command => ({
    id: `settings-${section}`,
    title: `Settings: ${label}`,
    keywords: ['preferences', 'options', ...keywords],
    run: () => openSettings(section)
  })),
  menu('keyboard-shortcuts', 'Keyboard shortcuts', ['keys', 'hotkeys', 'keybindings', 'help']),
  menu('send-feedback', 'Report a bug or suggest a feature…', ['feedback', 'issue', 'help'])
]

registerCommands(BUILTIN_COMMANDS)
