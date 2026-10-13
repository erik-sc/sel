/** Platform facts the interface needs in more than one place. */
export const IS_MAC = window.api.app.platform === 'darwin'

/** Prefix of a shortcut label: `⌘P` on macOS, `Ctrl+P` elsewhere. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl+'
