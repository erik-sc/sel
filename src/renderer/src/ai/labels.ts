// Words for the AI actions and for the states a request can be in.
import type { AiAction, AiStatus } from '@shared/ai'
import type { RunError, RunState } from './machine'

export const ACTION_TITLES: Record<AiAction, string> = {
  summarize: 'Summary',
  continue: 'Continue writing',
  expand: 'Expanded',
  improve: 'Improved writing',
  fix: 'Spelling and grammar',
  shorten: 'Shorter',
  lengthen: 'Longer',
  simplify: 'Simplified',
  tone: 'New tone',
  translate: 'Translation',
  outline: 'Outline',
  actions: 'Action items',
  title: 'Title suggestions',
  explain: 'Explanation',
  custom: 'Draft',
  ask: 'Answer',
  consolidate: 'Meeting notes'
}

export function statusText(state: RunState): string {
  switch (state.status) {
    case 'starting':
      return 'Thinking…'
    case 'streaming':
      return 'Writing…'
    case 'cancelled':
      return 'Stopped'
    case 'error':
      return 'Could not finish'
    default:
      return ''
  }
}

/** What to say under a failed request: the message, then the program's own line when it adds something. */
export function errorLines(error: RunError): { message: string; detail?: string } {
  return error.detail && error.detail !== error.message ? { message: error.message, detail: error.detail } : { message: error.message }
}

export const INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code'

/** Why the program cannot be used, in a sentence. */
export function unavailableText(status: AiStatus | null): string {
  switch (status?.reason) {
    case 'not-executable':
      return 'A file named claude was found, but it cannot be started.'
    case 'unknown-version':
      return 'The chosen program does not answer like Claude Code.'
    case 'disabled':
      return 'AI is turned off in Settings.'
    default:
      return 'Claude Code was not found on this computer.'
  }
}
