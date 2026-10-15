import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { tabPage, useActiveTab, useTabs } from '@/store/tabs'
import { setFocusMode, useUi } from '@/store/ui'
import { Toaster } from '@/ui/Toaster'
import { VersionHistory } from '@/versions/VersionHistory'
import { AiSetup, AssistantDock } from '@/ai/Host'
import { useAiGate } from '@/ai/gate'
import { CalendarHost, TodayHost } from '@/briefing/Host'
import { HermanHost } from '@/herman/Host'
import { FeedbackHost } from '@/feedback/Host'
import { MeetingSetup, RecordingIndicator } from '@/meetings/slot'
import { isCalendarRoute, isTodayRoute } from '@/briefing/route'
import { isTasksRoute } from '@/tasks/gate'
import { TasksHost } from '@/tasks/Host'
import { UpdateNotice } from '@/updates/Notice'
import { CommandPalette } from '@/commands/Palette'
import { ShortcutsHost } from '@/shortcuts/Host'
import { EmptyState, PageHost } from './PageHost'
import { FindBar } from './FindBar'
import { MainBars } from './MainBars'
import { QuickFind } from './QuickFind'
import { SettingsModal } from './SettingsModal'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { TopBar } from './TopBar'
import { useShellCommands } from './useShellCommands'

export function Shell() {
  useShellCommands()
  const sidebarWidth = useUi((state) => state.sidebarWidth)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const focus = useUi((state) => state.focusMode)
  const focusDim = useUi((state) => state.focusDim)
  const ready = useTabs((state) => state.ready)
  const tab = useActiveTab()
  const pageId = tabPage(tab)

  const classes = ['shell', `platform-${window.api.app.platform}`]
  if (sidebarCollapsed) classes.push('is-sidebar-collapsed')
  if (focus) classes.push('is-focus')
  if (focus && focusDim) classes.push('is-focus-dim')

  // Focus mode hides the assistant panel; whatever opens it (a page action, a shortcut) ends focus mode.
  useEffect(
    () =>
      useAiGate.subscribe((state, previous) => {
        if (state.panelOpen && !previous.panelOpen) setFocusMode(false)
      }),
    []
  )

  // A width the user dragged wins over the `--sidebar-width` appearance token; without one
  // the token (and so a theme or preset) decides.
  const style = sidebarWidth === null ? undefined : ({ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties)

  return (
    <div className={classes.join(' ')} style={style}>
      <Sidebar />
      <div className="main glass">
        <MainBars>
          <TabBar />
          <TopBar />
        </MainBars>
        {/* The bars are hidden in focus mode; that a meeting is being recorded is not. */}
        {focus && (
          <div className="focus-indicators">
            <RecordingIndicator />
          </div>
        )}
        <div className="content-row">
          <main className="content">
            {!ready ? null : isTodayRoute(pageId) ? (
              <TodayHost />
            ) : isCalendarRoute(pageId) ? (
              <CalendarHost />
            ) : isTasksRoute(pageId) ? (
              <TasksHost />
            ) : pageId && tab ? (
              <PageHost key={`${tab.id}:${pageId}`} pageId={pageId} />
            ) : (
              <EmptyState />
            )}
            <HermanHost />
            <FindBar />
            <UpdateNotice />
          </main>
        </div>
      </div>
      <AssistantDock />
      <QuickFind />
      <CommandPalette />
      <ShortcutsHost />
      <SettingsModal />
      <VersionHistory />
      <AiSetup />
      <MeetingSetup />
      <FeedbackHost />
      <Toaster />
    </div>
  )
}
