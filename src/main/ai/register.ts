import { app, BrowserWindow } from 'electron'
import { defineFeature, type Registered } from '../feature'
import type { AiBridge } from './index'

/**
 * The `ai:*` channels: they drive the Claude Code program installed on this computer (see
 * ./index.ts). Nothing of it is loaded until a window asks. A request is validated, and its
 * prompt built, in this process; its events go back to the window that made it and to no other.
 */

export interface AiRegistered extends Registered<'ai'> {
  /** The bridge, loaded the first time anything asks for it (the briefing's "Brief me", the alarms). */
  bridge(): Promise<AiBridge>
}

export const aiFeature = defineFeature({
  namespace: 'ai',
  register(ctx): AiRegistered {
    let bridge: AiBridge | null = null
    const ai = async (): Promise<AiBridge> =>
      (bridge ??= new (await import('./index')).AiBridge(ctx.repo, () => ctx.feature('briefing').promptData()))
    const windowOf = (event: { sender: Electron.WebContents }): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender)
    app.on('will-quit', () => bridge?.dispose())
    return {
      bridge: ai,
      handlers: {
        'ai:status': async ([a]) => (await ai()).status(a),
        'ai:run': async ([a], event) => (await ai()).run(a, event.sender),
        'ai:cancel': async ([a], event) => (await ai()).cancel(a, event.sender),
        // Goes through a native dialog: the renderer never names a path to run.
        'ai:pickCli': async (_args, event) => (await ai()).pickCli(windowOf(event)),
        // The MCP servers of the user's own Claude Code, by name (Settings → AI → Claude's tools).
        'ai:servers': async () => (await ai()).servers(),
        'ai:scanServers': async () => (await ai()).scanServers(),
        'ai:serverTools': async ([a]) => (await ai()).serverTools(a)
      },
      // Which program runs, and whether any does, is decided by these: the cached answer is stale.
      onSettingChanged(key) {
        if (key === 'ai.enabled' || key === 'ai.cliPath') bridge?.service.invalidate()
      }
    }
  }
})
