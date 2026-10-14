// The command registry: every action the command palette (Ctrl+K) can run. Pure: a list of
// plain objects, free of React, the DOM and the store; what a command does is its own `run`.
//
// A feature adds itself with one line, from a module that is loaded at start-up (its gate):
//
//   registerCommand({ id: 'focus-mode', title: 'Focus mode', shortcut: 'CmdOrCtrl+Shift+F', run: toggleFocus })
//
// or by adding an entry to the list in builtin.ts.

export interface Command {
  /** Stable and unique: recently used commands are remembered by it. */
  id: string
  /** What the palette lists, in sentence case: "New page", "Settings: Sync". */
  title: string
  /** Other words it should be found by: synonyms, the menu it lives in. */
  keywords?: readonly string[]
  /** Electron-style accelerator ('CmdOrCtrl+Shift+L'), shown in the platform's notation. Display only. */
  shortcut?: string
  /** Whether it can run right now; the palette leaves it out when this is false. */
  when?: () => boolean
  run: () => void
}

const commands = new Map<string, Command>()

/** Adds a command (a later one with the same id replaces it). Returns a function that removes it again. */
export function registerCommand(command: Command): () => void {
  commands.set(command.id, command)
  return () => {
    if (commands.get(command.id) === command) commands.delete(command.id)
  }
}

/** Adds several commands at once; the function returned removes them all. */
export function registerCommands(list: readonly Command[]): () => void {
  const removers = list.map(registerCommand)
  return () => removers.forEach((remove) => remove())
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id)
}

/** Every registered command, in the order they were added. */
export function allCommands(): Command[] {
  return [...commands.values()]
}

/** True when `command` can run now. A `when` that throws counts as "not now". */
export function isAvailable(command: Command): boolean {
  if (!command.when) return true
  try {
    return command.when()
  } catch {
    return false
  }
}

/** The commands that can run now, in registration order. */
export function availableCommands(): Command[] {
  return allCommands().filter(isAvailable)
}
