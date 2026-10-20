// What each menu command does in this window: the app menu and main's shortcuts send them
// (see useShellCommands), and the command palette runs the same ones. Every command
// (src/shared/commands.ts) has its handler in its feature's `menu` (see ../features.ts).
import type { MenuCommand } from '@shared/commands'
import type { HandledBy, MenuHandler } from '@/feature'
import { FEATURES } from '@/features'

type Unhandled = Exclude<MenuCommand, HandledBy<(typeof FEATURES)[number]>>
/** Typecheck fails here when a command has no handler in any feature. */
const EVERY_COMMAND_HANDLED: [Unhandled] extends [never] ? true : { unhandled: Unhandled } = true
void EVERY_COMMAND_HANDLED

let handlers: Readonly<Record<MenuCommand, MenuHandler>> | null = null

/** Every command's handler, from the features (put together on first use, once every feature has loaded). */
export function menuHandlers(): Readonly<Record<MenuCommand, MenuHandler>> {
  handlers ??= Object.assign({}, ...FEATURES.map((feature) => feature.menu ?? {})) as Record<MenuCommand, MenuHandler>
  return handlers
}

export function runMenuCommand(command: MenuCommand, arg?: unknown): void {
  // A command this window does not know (sent by a newer main process) does nothing, as before.
  menuHandlers()[command]?.run(arg)
}
