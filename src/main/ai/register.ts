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
        'ai:agents.list': async () => (await ai()).agents(),
        'ai:agents.connect': async ([a, b], event) => (await ai()).connectAgent(a, b, windowOf(event)),
        'ai:agents.remove': async ([a]) => (await ai()).removeAgent(a)
      },
      // Which program runs, and whether any does, is decided by these: the cached answer is stale.
      onSettingChanged(key) {
        if (key.startsWith('ai.')) bridge?.service.invalidate()
      }
    }
  }
})
