// The window's half of adding a feature (the main half, and why, is src/main/fake/fake.test.ts):
// the feature that does not exist joins each list with one line and gets its screen, its command's
// handler, its palette entry and its line on the shortcuts screen from that alone.
import { describe, expect, it, vi } from 'vitest'
import { COMMANDS } from '@shared/commands'
import { FAKE_COMMANDS, FAKE_ROUTE } from '@shared/fake'

vi.stubGlobal('window', { api: { clientId: 'w', onChange: () => () => {}, app: { platform: 'win32' } } })
const { BUILTIN_COMMANDS, paletteCommand } = await import('@/commands/builtin')
const { routeTitle, SCREENS, screenOf } = await import('@/screens')
const { menuHandlers } = await import('@/shell/menuCommands')
const { SHORTCUT_GROUPS, withCommands } = await import('@/shortcuts/catalog')
const { activeTab, tabPage } = await import('@/store/tabs')
const { FAKE_SCREENS, fakeFeature } = await import('./feature')

// The one line the feature adds to each list.
const screens = [...SCREENS, ...FAKE_SCREENS]
const handlers = { ...menuHandlers(), ...fakeFeature.menu }
const [spec] = FAKE_COMMANDS

describe('a new feature in a window', () => {
  it('has its screen shown in a tab, named on it', () => {
    expect(screenOf(FAKE_ROUTE)).toBeNull()
    expect(screenOf(FAKE_ROUTE, screens)?.title).toBe('Fake')
    expect(routeTitle('_today')).toBe('Today')
  })

  it('has a handler for its command, as every command does', () => {
    for (const command of [...COMMANDS, ...FAKE_COMMANDS]) expect(command.id in handlers, command.id).toBe(true)
    handlers['open-fake'].run()
    expect(tabPage(activeTab())).toBe(FAKE_ROUTE)
  })

  it('is in the palette, with its shortcut, where its order puts it', () => {
    const [order, command] = paletteCommand(spec, handlers['open-fake'])
    expect(command).toMatchObject({ id: 'open-fake', title: 'Fake', keywords: ['pretend'], shortcut: 'CmdOrCtrl+Alt+Y' })
    const ids = BUILTIN_COMMANDS.map((c) => c.id)
    // 125: between the closing of the day (120) and a new meeting (130).
    expect(order).toBeGreaterThan(120)
    expect(ids.indexOf('new-meeting') - ids.indexOf('close-day')).toBe(1)
  })

  it('has its line on the shortcuts screen, after the pomodoro', () => {
    const navigation = withCommands(SHORTCUT_GROUPS, FAKE_COMMANDS).find((group) => group.id === 'navigation')?.entries ?? []
    const at = navigation.findIndex((entry) => entry.id === 'start-pomodoro')
    expect(navigation[at + 1]).toMatchObject({ id: 'open-fake', label: 'Fake', command: 'open-fake' })
  })
})
