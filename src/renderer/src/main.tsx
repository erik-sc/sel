import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import './ui/ui.css'
import './styles/shell.css'
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
import { listenForNotices, watchFailures } from './failures/global'
import { followLocale } from './failures/notify'
import { useHome } from './home/store'
import { openTodayOnLaunch } from './briefing/route'
import { idleFeatures, initFeatures } from './features'
import { routeTitle } from './screens'
import { isQuickAddWindow } from './tasks/gate'

bootMark('start')

// Failures nobody caught are said, in the language the window speaks (failures/).
followLocale(() => useHome.getState().locale)
watchFailures()

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
  listenForNotices()
  void initTree()
  // Each feature's start-up (features.ts): what it asks the main process for, what it listens to.
  initFeatures()
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
      idleFeatures()
    })
  }

  if (mirrored) mount()
  else void settings.finally(mount)
}
