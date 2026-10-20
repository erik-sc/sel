// What a feature hands the shell of a window: what its commands do. ./features.ts lists every
// feature; each declares itself in its own folder (`<feature>/feature.ts`) with `defineFeature`.
import type { MenuCommand } from '@shared/commands'

/** What a command (src/shared/commands.ts) does in this window. */
export interface MenuHandler {
  /** Runs it: from the menu, its shortcut, the palette or a link. `arg` is what main sent with it. */
  run(arg?: unknown): void
  /** Whether the palette lists it right now; the menu and the keys run it regardless. */
  when?(): boolean
}

export interface RendererFeature<C extends MenuCommand = never> {
  /** For messages and tests; the folder's name. */
  id: string
  /** A handler for each command the feature declares. Every command needs one (see ./shell/menuCommands.ts). */
  menu?: { readonly [K in C]: MenuHandler }
}

/** Keeps which commands a feature handles as a literal type, so a command nobody handles fails typecheck. */
export function defineFeature<const C extends MenuCommand = never>(feature: RendererFeature<C>): RendererFeature<C> {
  return feature
}

/** The commands a list of features handles. */
export type HandledBy<F> = F extends RendererFeature<infer C> ? C : never
