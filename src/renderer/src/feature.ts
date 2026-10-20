// What a feature hands the shell of a window: what it starts, what it overlays on the window and
// what its commands do. ./features.ts lists every feature; each declares itself in its own folder
// (`<feature>/feature.ts`) with `defineFeature`. A feature's components are lazy imports here:
// the list is loaded at start-up, a component only when it is first drawn.
import type { ComponentType } from 'react'
import type { MenuCommand } from '@shared/commands'

/** What a command (src/shared/commands.ts) does in this window. */
export interface MenuHandler {
  /** Runs it: from the menu, its shortcut, the palette or a link. `arg` is what main sent with it. */
  run(arg?: unknown): void
  /** Whether the palette lists it right now; the menu and the keys run it regardless. */
  when?(): boolean
}

/** Something a feature draws over the window whatever the tab shows (Herman, the pomodoro, a dialog). */
export interface Overlay {
  /** `content`: over the page, inside the main area; `window`: over everything. */
  slot: 'content' | 'window'
  /** Its place among the shell's own and the other features' in that slot (later ones are drawn on top), ten apart. */
  order: number
  /** A lazy component; it is drawn with no fallback. */
  Overlay: ComponentType
}

export interface RendererFeature<C extends MenuCommand = never> {
  /** For messages and tests; the folder's name. */
  id: string
  /** At start-up of a workspace window (not the quick-add window), in the order of ./features.ts. */
  init?(): void
  /** Once the first frame is up and the window is idle: fetches what is very likely needed soon. */
  idle?(): void
  overlays?: readonly Overlay[]
  /** A handler for each command the feature declares. Every command needs one (see ./shell/menuCommands.ts). */
  menu?: { readonly [K in C]: MenuHandler }
}

/** Keeps which commands a feature handles as a literal type, so a command nobody handles fails typecheck. */
export function defineFeature<const C extends MenuCommand = never>(feature: RendererFeature<C>): RendererFeature<C> {
  return feature
}

/** The commands a list of features handles. */
export type HandledBy<F> = F extends RendererFeature<infer C> ? C : never
