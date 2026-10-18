import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './ui/ui.css'
import './styles/shell.css'
import './appearance/skins/index.css'
import { App } from './App'
import { bootAppearance, initAppearance } from './appearance/store'
import { bootMark, whenIdle } from './boot'
import { preloadEditor } from './editor/lazy'
import { preloadQuickFind } from './shell/QuickFind'
import { preloadPalette } from './commands/Palette'
import { preloadShortcuts } from './shortcuts/Host'
import { getBlock, prefetchTree } from './store/blocks'
import { activeTab, initTabs, initialPageId, tabPage } from './store/tabs'
import { initTree } from './store/tree'
import { bootUi, initUi, resolveTheme } from './store/ui'
import { notifyError } from './ui/toast'
import { initAi } from './ai/gate'
import { initHerman } from './herman/gate'
import { preloadHerman } from './herman/Host'
import { initSync } from './sync/store'
import { initMeetings } from './meetings/gate'
import { initUpdates } from './updates/store'
import { initAlarms } from './alarms/gate'
import { initPomodoro } from './pomodoro/gate'
import { initSky } from './sky/route'
import { openTodayOnLaunch, routeTitle } from './briefing/route'
import { isQuickAddWindow } from './tasks/gate'
import { initHome } from './home/store'

bootMark('start')

// A rejection nobody handled is most often a write that did not reach the database.
window.addEventListener('unhandledrejection', (event) => {
  notifyError('Something went wrong. Your last change may not have been saved.', event.reason)
})

// The first frame is painted from the synchronous mirror of the settings (theme, sidebar
// geometry, appearance overrides: see boot.ts), so it does not wait for the main process.
// Without a mirror (first run) it starts from the OS theme and waits, as there is no other
// way to avoid a visible jump.
document.documentElement.dataset.theme = resolveTheme('system')
const mirrored = [bootUi(), bootAppearance()].every(Boolean)

// Everything the shell needs is requested at once; nothing below waits for anything else.
const settings = Promise.all([
  initUi().catch((error) => console.error('could not load ui settings', error)),
  initAppearance().catch((error) => console.error('could not load appearance', error))
]).then(() => bootMark('settings'))
// The small window of the system-wide quick add (tasks/QuickAddWindow.tsx) shows that input
// alone: none of the workspace below is loaded there, and its tabs are not touched.
if (isQuickAddWindow()) void settings.finally(() => void import('./tasks/QuickAddWindow').then((module) => module.mountQuickAddWindow()))
else bootWorkspace()

function bootWorkspace(): void {
  void initTree()
  // Whether the AI entry points exist at all (`ai.enabled`); they stay hidden until this answers.
  void initAi()
  // Whether Herman, the assistant's face, is on (`herman.enabled`); his figure is fetched when the app is idle.
  const herman = initHerman()
  // The state of sync, for the indicator in the sidebar (nothing is loaded for it unless this device syncs).
  void initSync()
  initMeetings()
  // What the main process knows about a new version, for the notice and Settings. Reading it asks nothing of the network.
  initUpdates()
  // What the alarms' clock in the main process has to say (a briefing at one of its times, a reminder).
  initAlarms()
  // The home (synced) and what start-up does on this device, for the Home button and Settings.
  initHome()
  // The pomodoro the main process keeps: the widget shows it while one is on (and after a reload).
  initPomodoro()
  // Whether the Sky is on: its button, command and shortcut follow.
  initSky()
  void initTabs(initialPageId()).then(() => {
    // The page about to be shown: fetch its blocks while the editor's code loads.
    const pageId = tabPage(activeTab())
    if (pageId && !routeTitle(pageId) && getBlock(pageId)?.type !== 'database') prefetchTree(pageId)
    // Today opens by itself on the first launch of the day (`briefing.openOnLaunch`).
    void openTodayOnLaunch()
  })

  function mount(): void {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
    // Code that is not needed for the first frame but very likely soon after it.
    whenIdle(() => {
      preloadEditor()
      preloadQuickFind()
      preloadPalette()
      preloadShortcuts()
      void herman.then(preloadHerman)
    })
  }

  if (mirrored) mount()
  else void settings.finally(mount)
}
