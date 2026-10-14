import { app, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { cleanFeedbackInput } from '../../shared/feedback'
import type { FeedbackStore } from './store'

/**
 * The `feedback:*` channels: bug reports and suggestions written in the app, kept as files in
 * `<userData>/feedback` for the nightly development agent (see shared/feedback.ts). The store is
 * imported the first time a window asks. The folder's path is fixed here; the renderer never names one.
 */

type Handle = (channel: string, fn: (args: unknown[], event: IpcMainInvokeEvent) => unknown) => void

export function feedbackDir(): string {
  return join(app.getPath('userData'), 'feedback')
}

export function registerFeedbackIpc(handle: Handle): void {
  let store: FeedbackStore | null = null
  const feedback = async (): Promise<FeedbackStore> =>
    (store ??= new (await import('./store')).FeedbackStore(feedbackDir(), {
      appVersion: app.getVersion(),
      platform: process.platform
    }))

  handle('feedback:list', async () => (await feedback()).list())
  handle('feedback:create', async ([a]) => {
    const input = cleanFeedbackInput(a)
    return (await feedback()).create(input)
  })
  handle('feedback:withdraw', async ([a]) => (await feedback()).withdraw(typeof a === 'string' ? a : ''))
  handle('feedback:openFolder', async () => {
    const dir = await (await feedback()).folder()
    await shell.openPath(dir)
  })
}
