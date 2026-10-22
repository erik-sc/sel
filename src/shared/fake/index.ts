/**
 * A feature that does not exist, written the way a real one is: its shared side, with one call,
 * one setting and one command. Nothing in the app imports it; the tests in src/main/fake and
 * src/renderer/src/fake add it to each list of features, the one line a real feature adds there,
 * and check that everything works with that alone (see "Adicionar uma feature" in
 * docs/codebase-knowledge/50-conventions.md).
 *
 * A real feature also writes `fake: FakeApi` in `Api` (src/shared/api.ts), which is what makes its
 * channels part of `InvokeChannel` and its command part of `MenuCommand` for the type checks.
 */
import type { CommandSpec } from '../commands'
import type { InvokeChannels } from '../ipc'
import type { SettingsSpec } from '../settings'

/** The calls of `api.fake`. */
export interface FakeApi {
  /** Answers with the text it was given. */
  echo(text: string): Promise<string>
}

/** Its invoke channels: one fragment of INVOKE. */
export const FAKE_INVOKE = {
  'fake:echo': true
} as const satisfies Record<InvokeChannels<{ fake: FakeApi }>, true>

/** A level from 0 to 10, in whole steps. */
export const FAKE_LEVEL_KEY = 'fake.level'

export const FAKE_SETTINGS: SettingsSpec = {
  keys: [FAKE_LEVEL_KEY],
  clean: (_key, value) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(10, Math.max(0, Math.round(value))) : undefined)
}

/** The route of its screen; a real one goes in src/renderer/src/routes.ts. */
export const FAKE_ROUTE = '_fake'

/** Opening its screen: from the View menu, a shortcut, the palette, and a line on the shortcuts screen. */
export const FAKE_COMMANDS = [
  {
    id: 'open-fake',
    shortcut: { accelerator: 'CmdOrCtrl+Alt+Y', key: 'y', ctrl: true, alt: true },
    menu: { submenu: 'view', label: 'Fake', order: 290 },
    palette: { title: 'Fake', keywords: ['pretend'], order: 125 },
    catalog: { group: 'navigation', label: 'Fake', order: 215 }
  }
] as const satisfies readonly CommandSpec[]
