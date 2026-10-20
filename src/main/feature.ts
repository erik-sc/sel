import type { Repository } from './db/repository'
import type { FeatureName, RegisteredOf } from './features'
import type { Handlers } from './invoke'

/**
 * What a feature's main side is given when it registers (see `MainFeature`): the shared
 * services every feature leans on, and the other features, reached by namespace.
 */
export interface FeatureContext {
  repo: Repository
  /** Settles once the workspace can be read (first-run content created). Every handler already waits for it. */
  ready: Promise<void>
  createWindow(pageId?: string): void
  /**
   * What this feature wrote outside an invoke (a transcription, a sync, a connected app) reaches
   * the windows as a change from `origin`, a name no window has. Unless `local` is false it is
   * also a change for sync to upload.
   */
  changes(origin: string, options?: { local?: boolean }): void
  /** Something changed on this device: sync uploads it once things have been quiet for a moment. */
  noteLocalChange(): void
  /** True while a meeting is recorded: whatever would ring or restart stays quiet. */
  recording(): boolean
  /**
   * Another feature's main side, as its `register` returned it. Reach for it when it is used, not
   * while registering: only the features listed before this one in ./features.ts exist by then.
   */
  feature<N extends FeatureName>(namespace: N): RegisteredOf<N>
}

/** What a feature's `register` returns: a handler for each of its channels, and the hooks the shell calls. */
export interface Registered<N extends string> {
  handlers: Handlers<N>
  /** A renderer wrote a setting: every key reaches every feature, which follows the ones it cares about. */
  onSettingChanged?(key: string): void
  /** Once the first window is on screen (a daily backup, the sync timers). */
  start?(): void
}

/**
 * A feature's main side: the invoke namespace it answers (see `INVOKE` in src/shared/api.ts) and
 * how it registers. Each `register.ts` exports one; ./features.ts lists them.
 */
export interface MainFeature<N extends string = string, R extends Registered<N> = Registered<N>> {
  namespace: N
  register(ctx: FeatureContext): R
}

/** Keeps a feature's namespace and what it registers as literal types, for `FeatureContext.feature`. */
export function defineFeature<const N extends string, R extends Registered<N>>(feature: MainFeature<N, R>): MainFeature<N, R> {
  return feature
}
