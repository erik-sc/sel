import type { CSSProperties } from 'react'
import { tabPage, useActiveTab, useTabs } from '@/store/tabs'
import { useUi } from '@/store/ui'
import { Toaster } from '@/ui/Toaster'
import { VersionHistory } from '@/versions/VersionHistory'
import { AiSetup, AssistantDock } from '@/ai/Host'
import { CalendarHost, TodayHost } from '@/briefing/Host'
import { HermanHost } from '@/herman/Host'
import { FeedbackHost } from '@/feedback/Host'
import { MeetingSetup } from '@/meetings/slot'
import { isCalendarRoute, isTodayRoute } from '@/briefing/route'
import { EmptyState, PageHost } from './PageHost'
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
  const ready = useTabs((state) => state.ready)
  const tab = useActiveTab()
  const pageId = tabPage(tab)

  const classes = ['shell', `platform-${window.api.app.platform}`]
  if (sidebarCollapsed) classes.push('is-sidebar-collapsed')

  // A width the user dragged wins over the `--sidebar-width` appearance token; without one
  // the token (and so a theme or preset) decides.
  const style = sidebarWidth === null ? undefined : ({ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties)

  return (
    <div className={classes.join(' ')} style={style}>
      <Sidebar />
      <div className="main glass">
        <TabBar />
        <TopBar />
        <div className="content-row">
          <main className="content">
            {!ready ? null : isTodayRoute(pageId) ? (
              <TodayHost />
            ) : isCalendarRoute(pageId) ? (
              <CalendarHost />
            ) : pageId && tab ? (
              <PageHost key={`${tab.id}:${pageId}`} pageId={pageId} />
            ) : (
              <EmptyState />
            )}
            <HermanHost />
          </main>
        </div>
      </div>
      <AssistantDock />
      <QuickFind />
      <SettingsModal />
      <VersionHistory />
      <AiSetup />
      <MeetingSetup />
      <FeedbackHost />
      <Toaster />
    </div>
  )
}
