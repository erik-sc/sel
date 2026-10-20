import { FAKE_LEVEL_KEY } from '../../shared/fake'
import * as arg from '../validate'

/**
 * The main side of the feature that does not exist (see src/shared/fake): a handler for its one
 * channel, and what it does when its setting changes. A real feature writes this with
 * `defineFeature` (../feature.ts), which types its handlers by its channels in INVOKE.
 */
export const fakeFeature = {
  namespace: 'fake',
  register: (ctx: { repo: { getSetting(key: string): unknown } }) => {
    const heard: string[] = []
    return {
      heard,
      handlers: {
        'fake:echo': ([text]: unknown[]) => `${arg.text(text, 'text', 100)} (level ${String(ctx.repo.getSetting(FAKE_LEVEL_KEY))})`
      },
      onSettingChanged(key: string) {
        if (key === FAKE_LEVEL_KEY) heard.push(key)
      }
    }
  }
}
