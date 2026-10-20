import { app, shell } from 'electron'
import { join } from 'node:path'
import { cleanFeedbackInput } from '../../shared/feedback'
import type { Handlers } from '../invoke'
import type { FeedbackStore } from './store'
import { defineFeature, type Registered } from '../feature'

/**
 * The `feedback:*` channels: bug reports and suggestions written in the app, kept as files in
 * `<userData>/feedback` for the nightly development agent (see shared/feedback.ts). The store is
 * imported the first time a window asks. The folder's path is fixed here; the renderer never names one.
 */

export function feedbackDir(): string {
  return join(app.getPath('userData'), 'feedback')
}

export function registerFeedbackIpc(): Handlers<'feedback'> {
  let store: FeedbackStore | null = null
  const feedback = async (): Promise<FeedbackStore> =>
    (store ??= new (await import('./store')).FeedbackStore(feedbackDir(), {
      appVersion: app.getVersion(),
      platform: process.platform
    }))

  return {
    'feedback:list': async () => (await feedback()).list(),
    'feedback:create': async ([a]) => {
      const input = cleanFeedbackInput(a)
      return (await feedback()).create(input)
    },
    'feedback:withdraw': async ([a]) => (await feedback()).withdraw(typeof a === 'string' ? a : ''),
    'feedback:openFolder': async () => {
      const dir = await (await feedback()).folder()
      await shell.openPath(dir)
    }
  }
}

/** Bug reports and suggestions, kept as files for the nightly agent. */
export const feedbackFeature = defineFeature({
  namespace: 'feedback',
  register: (): Registered<'feedback'> => ({ handlers: registerFeedbackIpc() })
})
