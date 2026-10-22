/**
 * The menu bar as main builds it from the command specs (src/shared/commands.ts): every item, its
 * shortcut and the separators, on Windows and Linux and on macOS. Electron is replaced by a recorder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const built = vi.hoisted(() => ({ template: [] as unknown[] }))

vi.mock('electron', () => ({
  app: { name: 'sel', isPackaged: false },
  BrowserWindow: class {},
  Menu: {
    buildFromTemplate: (template: unknown[]) => {
      built.template = template
      return template
    },
    setApplicationMenu: () => undefined
  }
}))

interface Item {
  label?: string
  role?: string
  type?: string
  accelerator?: string
  visible?: boolean
  submenu?: Item[]
}

/** A menu as lines: `label (keys)`, a role by name, `—` for a separator; a hidden item ends in `, hidden`. */
function lines(items: Item[]): string[] {
  return items.map((item) =>
    item.type === 'separator'
      ? '—'
      : item.role
        ? `[${item.role}]${item.accelerator ? ` (${item.accelerator})` : ''}`
        : `${item.label}${item.accelerator ? ` (${item.accelerator})` : ''}${item.visible === false ? ', hidden' : ''}`
  )
}

async function menuOn(platform: NodeJS.Platform): Promise<Record<string, string[]>> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    vi.resetModules()
    const { buildMenu } = await import('./menu')
    buildMenu()
  } finally {
    Object.defineProperty(process, 'platform', { value: original })
  }
  return Object.fromEntries((built.template as Item[]).map((menu) => [menu.label, lines(menu.submenu ?? [])]))
}

afterEach(() => vi.resetModules())

const VIEW = [
  'Command Palette… (CmdOrCtrl+K)',
  '—',
  'Home (CmdOrCtrl+Alt+H)',
  'Today (CmdOrCtrl+Alt+T)',
  'Calendar (CmdOrCtrl+Alt+C)',
  'Tasks (CmdOrCtrl+Alt+K)',
  'Add a Task… (CmdOrCtrl+Alt+A)',
  'Meditations (CmdOrCtrl+Alt+N)',
  'Sky (CmdOrCtrl+Alt+G)',
  'Close the Day',
  'Start a Pomodoro (CmdOrCtrl+Alt+P)',
  '—',
  'Toggle Sidebar (CmdOrCtrl+\\)',
  'Toggle Assistant (CmdOrCtrl+J)',
  'Toggle Light/Dark Theme (CmdOrCtrl+Shift+L)',
  'Toggle Focus Mode (CmdOrCtrl+Shift+F)',
  '—',
  'Back (Alt+Left)',
  'Forward (Alt+Right)',
  '—',
  'Next Tab (Control+Tab)',
  'Previous Tab (Control+Shift+Tab)',
  '—',
  '[reload]',
  '[forceReload]',
  '[toggleDevTools]',
  '—',
  // Remembered per device (zoom.ts); the hidden ones are the other keys that mean the same.
  'Actual Size (CmdOrCtrl+0)',
  'Actual Size (CmdOrCtrl+num0), hidden',
  'Zoom In (CmdOrCtrl+Plus)',
  'Zoom In (CmdOrCtrl+=), hidden',
  'Zoom In (CmdOrCtrl+numadd), hidden',
  'Zoom Out (CmdOrCtrl+-)',
  'Zoom Out (CmdOrCtrl+numsub), hidden',
  '—',
  '[togglefullscreen]'
]

const EDIT = [
  '[undo]',
  '[redo]',
  '—',
  '[cut]',
  '[copy]',
  '[paste]',
  '[pasteAndMatchStyle]',
  '[delete]',
  '—',
  '[selectAll]',
  '—',
  'Find in Page… (CmdOrCtrl+F)'
]

const HELP = ['Keyboard Shortcuts (CmdOrCtrl+/)', 'Report a Bug or Suggest a Feature…']

describe('the menu bar', () => {
  it('on Windows and Linux', async () => {
    expect(await menuOn('win32')).toEqual({
      File: [
        'New Page (CmdOrCtrl+N)',
        'New Page from Template…',
        'New Tab (CmdOrCtrl+T)',
        'New Meeting (CmdOrCtrl+Alt+M)',
        '—',
        'Quick Find… (CmdOrCtrl+P)',
        'Version History… (CmdOrCtrl+Alt+Shift+H)',
        '—',
        'Close Tab (CmdOrCtrl+W)',
        '—',
        'Settings… (CmdOrCtrl+,)',
        '—',
        '[quit]'
      ],
      Edit: EDIT,
      View: VIEW,
      Window: ['[minimize]'],
      Help: HELP
    })
  })

  it('on macOS, with Settings in the application menu and its own Back and Forward keys', async () => {
    const menu = await menuOn('darwin')
    expect(menu.sel).toEqual([
      '[about]',
      '—',
      'Settings… (CmdOrCtrl+,)',
      '—',
      '[services]',
      '—',
      '[hide]',
      '[hideOthers]',
      '[unhide]',
      '—',
      '[quit]'
    ])
    expect(menu.File).toEqual([
      'New Page (CmdOrCtrl+N)',
      'New Page from Template…',
      'New Tab (CmdOrCtrl+T)',
      'New Meeting (CmdOrCtrl+Alt+M)',
      '—',
      'Quick Find… (CmdOrCtrl+P)',
      'Version History… (CmdOrCtrl+Alt+Shift+H)',
      '—',
      'Close Tab (CmdOrCtrl+W)',
      '[close] (Cmd+Shift+W)'
    ])
    expect(menu.Edit).toEqual(EDIT)
    expect(menu.View).toEqual(
      VIEW.map((line) => line.replace('Back (Alt+Left)', 'Back (Cmd+[)').replace('Forward (Alt+Right)', 'Forward (Cmd+])'))
    )
    expect(menu.Window).toEqual(['[minimize]', '[zoom]', '—', '[front]'])
    expect(menu.Help).toEqual(HELP)
  })
})
