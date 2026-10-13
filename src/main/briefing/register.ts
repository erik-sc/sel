import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { PromptBuilder } from '../ai/service'
import type { Repository } from '../db/repository'
import type { BriefingBridge } from './index'

/**
 * The `briefing:*` channels. This file is all of the briefing that loads at start-up: the
 * rest (the calendar reader, the parser, the bundled phrases) is imported when a window first
 * asks. Every handler goes through `handle`, which checks the sender and reduces failures to
 * safe messages, and every argument is validated by the service before it is used.
 */

type Handle = (channel: string, fn: (args: unknown[], event: IpcMainInvokeEvent) => unknown) => void

export interface BriefingIpcContext {
  handle: Handle
  repo: Repository
  /** The AI bridge, for the optional "Brief me" paragraph. */
  ai: () => Promise<{ runPrompt(build: PromptBuilder, sender: WebContents): { id: string } }>
}

export function registerBriefingIpc({ handle, repo, ai }: BriefingIpcContext): void {
  let bridge: BriefingBridge | null = null
  const briefing = async (): Promise<BriefingBridge> => (bridge ??= new (await import('./index')).BriefingBridge(repo))

  handle('briefing:get', async ([force]) => (await briefing()).service.get(force === true))
  handle('briefing:anotherPhrase', async () => (await briefing()).service.anotherPhrase())
  handle('briefing:completeTask', async ([id]) => (await briefing()).service.completeTask(id))
  handle('briefing:undoCompleteTask', async ([token]) => (await briefing()).service.undoCompleteTask(token))
  handle('briefing:ensurePhrasesDatabase', async () => (await briefing()).service.ensurePhrasesDatabase())
  handle('briefing:addPhrase', async ([id]) => (await briefing()).service.addPhrase(id))
  handle('briefing:databases', async () => (await briefing()).service.databases())

  // Calendars. An address comes in through `add` and never goes out again.
  handle('briefing:calendars.list', async () => (await briefing()).service.listCalendars())
  handle('briefing:calendars.add', async ([input]) => {
    const b = await briefing()
    const calendar = b.service.addCalendar(input)
    // Read it right away; the windows hear when it has answered.
    void b.service.get(false).catch(() => undefined)
    b.changed()
    return calendar
  })
  handle('briefing:calendars.update', async ([id, patch]) => {
    const b = await briefing()
    const calendar = b.service.updateCalendar(id, patch)
    b.changed()
    return calendar
  })
  handle('briefing:calendars.remove', async ([id]) => {
    const b = await briefing()
    b.service.removeCalendar(id)
    b.changed()
  })
  handle('briefing:calendars.test', async ([id]) => (await briefing()).service.testCalendar(id))

  // The prompt is written here from the agenda and tasks this process reads: the window only asks.
  handle('briefing:brief', async (_args, event) => {
    const b = await briefing()
    const { buildBriefingPrompt } = await import('../ai/prompts')
    return (await ai()).runPrompt((language) => buildBriefingPrompt(b.service.promptData(), { defaultLanguage: language }), event.sender)
  })
}
