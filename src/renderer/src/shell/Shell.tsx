import { Fragment, Suspense, useEffect } from 'react'
import type { ComponentType, CSSProperties } from 'react'
import type { Overlay } from '@/feature'
import { FEATURES } from '@/features'
import { tabPage, useActiveTab, useTabs } from '@/store/tabs'
import { setFocusMode, useUi } from '@/store/ui'
import { Toaster } from '@/ui/Toaster'
import { VersionHistory } from '@/versions/VersionHistory'
import { useAiGate } from '@/ai/gate'
import { RecordingIndicator } from '@/meetings/slot'
import { screenOf } from '@/screens'
import { CommandPalette } from '@/commands/Palette'
import { ShortcutsHost } from '@/shortcuts/Host'
import { PageSkeleton } from '@/ui/Skeleton'
import { EmptyState, PageHost } from './PageHost'
import { FindBar } from './FindBar'
import { MainBars } from './MainBars'
import { QuickFind } from './QuickFind'
import { SettingsModal } from './SettingsModal'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { TopBar } from './TopBar'
import { useShellCommands } from './useShellCommands'

/** The shell's own overlays and the features', in their slot's order (see `Overlay` in ../feature.ts). */
function overlays(slot: Overlay['slot'], own: readonly { order: number; Overlay: ComponentType }[]) {
  const features = FEATURES.flatMap((feature) => feature.overlays ?? [])
  return [
    ...own.map((entry) => ({ ...entry, lazy: false })),
    ...features.filter((entry) => entry.slot === slot).map((entry) => ({ ...entry, lazy: true }))
  ].sort((a, b) => a.order - b.order)
}

const CONTENT_OVERLAYS = overlays('content', [{ order: 30, Overlay: FindBar }])
const WINDOW_OVERLAYS = overlays('window', [
  { order: 20, Overlay: QuickFind },
  { order: 30, Overlay: CommandPalette },
  { order: 40, Overlay: ShortcutsHost },
  { order: 50, Overlay: SettingsModal },
  { order: 60, Overlay: VersionHistory },
  { order: 110, Overlay: Toaster }
])

function Overlays({ list }: { list: typeof CONTENT_OVERLAYS }) {
  return list.map(({ order, Overlay, lazy }) =>
    lazy ? (
      <Suspense key={order} fallback={null}>
        <Overlay />
      </Suspense>
    ) : (
      <Fragment key={order}>
        <Overlay />
      </Fragment>
    )
  )
}

export function Shell() {
  useShellCommands()
  const sidebarWidth = useUi((state) => state.sidebarWidth)
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed)
  const focus = useUi((state) => state.focusMode)
  const focusDim = useUi((state) => state.focusDim)
  const ready = useTabs((state) => state.ready)
  const tab = useActiveTab()
  const pageId = tabPage(tab)
  const screen = screenOf(pageId)

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
            {!ready ? null : screen ? (
              // A screen's mount point is fetched the first time it is shown (../screens.ts).
              <Suspense fallback={<ScreenSkeleton />}>
                <screen.Host />
              </Suspense>
            ) : pageId && tab ? (
              <PageHost key={`${tab.id}:${pageId}`} pageId={pageId} />
            ) : (
              <EmptyState />
            )}
            <Overlays list={CONTENT_OVERLAYS} />
          </main>
        </div>
      </div>
      <Overlays list={WINDOW_OVERLAYS} />
    </div>
  )
}

/** What a screen shows while its mount point loads: what the mount point itself shows while its screen does. */
function ScreenSkeleton() {
  return (
    <div className="page-host">
      <div className="page-scroll">
        <PageSkeleton />
      </div>
    </div>
  )
}
