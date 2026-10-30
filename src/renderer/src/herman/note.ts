// The shape of a note (a nudge on screen): observation, effect, a verb and "Not now". The little
// logic the shape needs lives here, away from the component, so that a test can hold it.
import type { HermanCommand, HermanNudge } from '@shared/herman'

/**
 * The verb a note offers. A question for the conversation has nowhere to go while AI is turned
 * off, so it is not offered then (the note keeps its other buttons).
 */
export function offeredVerb(action: HermanNudge['action'], aiOn: boolean): HermanNudge['action'] {
  if (!action) return undefined
  return action.command.type === 'ask' && !aiOn ? undefined : action
}

/** The tasks a "date" verb names, as far as `known` accepts them, once each. Empty when it is another command. */
export function datedTasks(command: HermanCommand, known: (id: string) => boolean): string[] {
  if (command.type !== 'date-tasks') return []
  return [...new Set(command.pageIds)].filter(known)
}

/** The verb as the note draws it: "[ Verb ]". */
export const bracketed = (label: string): string => `[ ${label} ]`
