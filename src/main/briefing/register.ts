import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { BriefingPromptData } from '../ai/prompts'
import type { PromptBuilder } from '../ai/service'
import type { Briefing } from '../../shared/briefing'
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
  /** A task was marked done from a window, or that was taken back (Herman notices a streak). */
  onTaskCompleted?: (sender: WebContents) => void
  onTaskUncompleted?: () => void
}

export interface BriefingAccess {
  /** The briefing from what is stored: no calendar is read for it. */
  stored(): Promise<Briefing>
  /** The same, as the lines a prompt about the day is written from. */
  promptData(): Promise<BriefingPromptData>
}

export function registerBriefingIpc({ handle, repo, ai, onTaskCompleted, onTaskUncompleted }: BriefingIpcContext): BriefingAccess {
  let bridge: BriefingBridge | null = null
  const briefing = async (): Promise<BriefingBridge> => (bridge ??= new (await import('./index')).BriefingBridge(repo))

  handle('briefing:get', async ([force]) => (await briefing()).service.get(force === true))
  handle('briefing:anotherPhrase', async () => (await briefing()).service.anotherPhrase())
  handle('briefing:completeTask', async ([id], event) => {
    const result = (await briefing()).service.completeTask(id)
    onTaskCompleted?.(event.sender)
    return result
  })
  handle('briefing:undoCompleteTask', async ([token]) => {
    ;(await briefing()).service.undoCompleteTask(token)
    onTaskUncompleted?.()
  })
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
    // With Herman on, he is the one who answers ("Ask Herman about today"): the same request, in his voice.
    return (await ai()).runPrompt((language, voice) => buildBriefingPrompt(b.service.promptData(), { defaultLanguage: language, voice }), event.sender)
  })

  return { stored: async () => (await briefing()).service.build(), promptData: async () => (await briefing()).service.promptData() }
}
