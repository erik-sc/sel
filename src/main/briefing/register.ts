import type { WebContents } from 'electron'
import type { BriefingPromptData } from '../ai/prompts'
import type { PromptBuilder } from '../ai/service'
import type { Briefing, BriefingEvent } from '../../shared/briefing'
import type { Repository } from '../db/repository'
import type { Handlers } from '../invoke'
import type { CalendarSync } from '../sync/format'
import type { BriefingBridge } from './index'

/**
 * The `briefing:*` channels. This file is all of the briefing that loads at start-up: the
 * rest (the calendar reader, the parser, the bundled phrases) is imported when a window first
 * asks. Every handler is registered by ../ipc.ts behind its wrapper, which checks the sender and
 * reduces failures to safe messages, and every argument is validated by the service before it is used.
 */

export interface BriefingIpcContext {
  repo: Repository
  /** The AI bridge, for the optional "Brief me" paragraph. */
  ai: () => Promise<{ runPrompt(build: PromptBuilder, sender: WebContents): { id: string } }>
  /** A task was marked done from a window, or that was taken back (Herman notices a streak). */
  onTaskCompleted?: (sender: WebContents) => void
  onTaskUncompleted?: () => void
  /** A calendar was connected, changed or removed here: sync carries it (to an encrypted repository only). */
  onCalendarsChanged?: () => void
}

export interface BriefingAccess {
  /** The briefing from what is stored: no calendar is read for it. */
  stored(): Promise<Briefing>
  /** The same, as the lines a prompt about the day is written from. */
  promptData(): Promise<BriefingPromptData>
  /** The calendars for sync. Loads the briefing, so it is asked for only by an encrypted repository. */
  calendarSync(): Promise<CalendarSync>
  /** Stored events overlapping [from, to), for the alarms; a calendar that is due is read in the background. */
  upcoming(from: number, to: number): Promise<BriefingEvent[]>
  /** One stored occurrence of an event, by UID and start; nothing is read for it. */
  occurrence(uid: string, start: number): Promise<BriefingEvent | null>
}

export function registerBriefingIpc({
  repo,
  ai,
  onTaskCompleted,
  onTaskUncompleted,
  onCalendarsChanged
}: BriefingIpcContext): BriefingAccess & { handlers: Handlers<'briefing'> } {
  let bridge: BriefingBridge | null = null
  const briefing = async (): Promise<BriefingBridge> => (bridge ??= new (await import('./index')).BriefingBridge(repo))

  const handlers: Handlers<'briefing'> = {
    'briefing:get': async ([force]) => (await briefing()).service.get(force === true),
    'briefing:agenda': async ([from, to, force]) => (await briefing()).service.agenda(from, to, force === true),
    'briefing:anotherPhrase': async () => (await briefing()).service.anotherPhrase(),
    'briefing:completeTask': async ([id], event) => {
      const result = (await briefing()).service.completeTask(id)
      onTaskCompleted?.(event.sender)
      return result
    },
    'briefing:undoCompleteTask': async ([token]) => {
      ;(await briefing()).service.undoCompleteTask(token)
      onTaskUncompleted?.()
    },
    'briefing:ensurePhrasesDatabase': async () => (await briefing()).service.ensurePhrasesDatabase(),
    'briefing:addPhrase': async ([id]) => (await briefing()).service.addPhrase(id),
    'briefing:databases': async () => (await briefing()).service.databases(),

    // Calendars. An address comes in through `add` and never goes out again.
    'briefing:calendars.list': async () => (await briefing()).service.listCalendars(),
    'briefing:calendars.add': async ([input]) => {
      const b = await briefing()
      const calendar = b.service.addCalendar(input)
      // Read it right away; the windows hear when it has answered.
      void b.service.get(false).catch(() => undefined)
      b.changed()
      onCalendarsChanged?.()
      return calendar
    },
    'briefing:calendars.update': async ([id, patch]) => {
      const b = await briefing()
      const calendar = b.service.updateCalendar(id, patch)
      b.changed()
      onCalendarsChanged?.()
      return calendar
    },
    'briefing:calendars.remove': async ([id]) => {
      const b = await briefing()
      b.service.removeCalendar(id)
      b.changed()
      onCalendarsChanged?.()
    },
    'briefing:calendars.test': async ([id]) => (await briefing()).service.testCalendar(id),

    // The prompt is written here from the agenda and tasks this process reads: the window only asks.
    'briefing:brief': async (_args, event) => {
      const b = await briefing()
      const { buildBriefingPrompt } = await import('../ai/prompts')
      // With Herman on, he is the one who answers ("Ask Herman about today"): the same request, in his voice.
      return (await ai()).runPrompt(
        (language, voice) => buildBriefingPrompt(b.service.promptData(), { defaultLanguage: language, voice }),
        event.sender
      )
    }
  }

  return {
    handlers,
    stored: async () => (await briefing()).service.build(),
    promptData: async () => (await briefing()).service.promptData(),
    calendarSync: async () => (await briefing()).calendarSync,
    upcoming: async (from, to) => (await briefing()).service.upcoming(from, to),
    occurrence: async (uid, start) => (await briefing()).service.occurrence(uid, start)
  }
}
