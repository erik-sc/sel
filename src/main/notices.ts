import { BrowserWindow } from 'electron'
import { IPC, type AppNotice } from '../shared/api'

/**
 * What the main process asks the windows to tell the user (the words are the renderer's, see
 * renderer/failures). A lasting notice (`crashed`) reaches every window, now and opened later;
 * a single one (`seed-failed`) is shown by the first window that asks, once.
 */

const lasting = new Set<AppNotice>()
const single = new Set<AppNotice>()

export function raiseNotice(notice: AppNotice, kind: 'lasting' | 'single'): void {
  if (kind === 'single') {
    single.add(notice)
    return
  }
  if (lasting.has(notice)) return
  lasting.add(notice)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.notice, notice)
  }
}

/** What a window that has just started should show: every lasting notice, and the single ones not shown yet. */
export function takeNotices(): AppNotice[] {
  const notices = [...lasting, ...single]
  single.clear()
  return notices
}
