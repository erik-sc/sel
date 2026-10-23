import { describe, expect, it, vi } from 'vitest'
import { COMMANDS } from '@shared/commands'

// The commands' modules read the platform and listen for changes as they load.
vi.stubGlobal('window', { api: { clientId: 'w', onChange: () => () => {}, app: { platform: 'win32' } } })
const { BUILTIN_COMMANDS } = await import('./builtin')

describe('the built-in commands', () => {
  it('list the commands with a palette entry and the shell’s own, in this order with no query', () => {
    expect(BUILTIN_COMMANDS.map((command) => command.id)).toEqual([
      'new-page',
      'new-from-template',
      'quick-find',
      'find-in-page',
      'go-home',
      'open-today',
      'open-calendar',
      'open-tasks',
      'add-task',
      'refine-tasks',
      'week-review',
      'open-notebook',
      'open-sky',
      'open-flows',
      'close-day',
      'new-meeting',
      'toggle-assistant',
      'ai-onboarding',
      'new-tab',
      'close-tab',
      'reopen-tab',
      'next-tab',
      'prev-tab',
      'go-back',
      'go-forward',
      'new-window',
      'toggle-sidebar',
      'customize-sidebar',
      'open-trash',
      'open-archive',
      'toggle-focus-mode',
      'leave-focus-mode',
      'focus-dim',
      'focus-no-dim',
      'toggle-theme',
      'theme-light',
      'theme-dark',
      'theme-system',
      'page-history',
      'page-export-markdown',
      'import-markdown',
      'page-duplicate',
      'page-favorite',
      'page-unfavorite',
      'page-archive',
      'page-unarchive',
      'page-full-width',
      'page-normal-width',
      'page-new-window',
      'page-ai-summarize',
      'page-ai-title',
      'open-settings',
      'settings-general',
      'settings-sidebar',
      'settings-history',
      'settings-ai',
      'settings-herman',
      'settings-notifications',
      'settings-sync',
      'settings-today',
      'settings-meetings',
      'settings-pomodoro',
      'settings-mcp',
      'keyboard-shortcuts',
      'send-feedback'
    ])
  })

  it('give each command with a palette entry its spec’s title and its shortcut', () => {
    const byId = new Map(BUILTIN_COMMANDS.map((command) => [command.id, command]))
    for (const spec of COMMANDS) {
      if (!('palette' in spec)) continue
      expect(byId.get(spec.id)?.title, spec.id).toBe(spec.palette.title)
      expect(byId.get(spec.id)?.shortcut, spec.id).toBe('shortcut' in spec ? spec.shortcut.accelerator : undefined)
    }
  })
})
