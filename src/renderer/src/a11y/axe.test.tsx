// @vitest-environment happy-dom
// axe on the shared dialogs and menus, Quick find, Settings and the database table: nothing
// serious or critical. Also what the table and the popovers say to a screen reader.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Modal } from '@/ui/Modal'
import { Menu } from '@/ui/Menu'
import { Popover } from '@/ui/Popover'
import { cleanup, fakeApi, press, render, seriousViolations, settle } from './testing'

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi({ 'pages.listRecent': [], 'pages.search': [] })
})

afterEach(cleanup)

/** The first import of a screen's whole module graph, on a cold CI runner. */
const COLD = 60_000

describe('Modal', () => {
  it('is named by its visible title', async () => {
    await render(
      <Modal open onClose={() => undefined} labelledBy="t">
        <h2 id="t">Rename speakers</h2>
        <button type="button">Save</button>
      </Modal>
    )
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.getAttribute('aria-labelledby')).toBe('t')
    expect(dialog.hasAttribute('aria-label')).toBe(false)
    expect(await seriousViolations()).toEqual([])
  })

  it('is named by its label when nothing on it says what it is', async () => {
    await render(
      <Modal open onClose={() => undefined} label="Quick find">
        <input aria-label="Search" />
      </Modal>
    )
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Quick find')
    expect(await seriousViolations()).toEqual([])
  })
})

describe('Menu', () => {
  const items = [
    { header: 'Page' },
    { id: 'open', label: 'Open', onSelect: () => undefined },
    { id: 'off', label: 'Unavailable', disabled: true },
    { separator: true as const },
    { id: 'more', label: 'More', submenu: [{ id: 'a', label: 'A' }] },
    { id: 'delete', label: 'Delete', danger: true }
  ]

  it('in a popover that is only its box', async () => {
    const anchor = document.createElement('button')
    anchor.textContent = 'Options'
    document.body.append(anchor)
    await render(
      <Popover open anchor={anchor} role="none" onClose={() => undefined}>
        <Menu items={items} autoFocus />
      </Popover>
    )
    expect(document.querySelector('[data-popover]')?.hasAttribute('role')).toBe(false)
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    expect(document.activeElement).toBe(menu)
    expect(menu.getAttribute('aria-activedescendant')).toBe(menu.querySelector('[role="menuitem"]')?.id)
    await press(menu, 'ArrowDown')
    // Past the disabled one, to the submenu's item.
    expect(document.getElementById(menu.getAttribute('aria-activedescendant') ?? '')?.textContent).toContain('More')
    expect(await seriousViolations()).toEqual([])
  })

  it('a popover that is a dialog has a name', async () => {
    const anchor = document.createElement('button')
    anchor.textContent = 'Options'
    document.body.append(anchor)
    await render(
      <Popover open anchor={anchor} label="Cover" onClose={() => undefined}>
        <button type="button">Remove</button>
      </Popover>
    )
    const popover = document.querySelector('[data-popover]') as HTMLElement
    expect(popover.getAttribute('role')).toBe('dialog')
    expect(popover.getAttribute('aria-label')).toBe('Cover')
    expect(await seriousViolations()).toEqual([])
  })
})

describe('Quick find', () => {
  it('has nothing serious', { timeout: COLD }, async () => {
    const { setQuickFindOpen } = await import('@/store/ui')
    const { QuickFind } = await import('@/shell/QuickFind')
    // The dialog's body is lazy: fetched first, so that it is there to check.
    await import('@/shell/QuickFindBody')
    setQuickFindOpen(true)
    await render(<QuickFind />)
    await settle(10)
    expect(document.querySelector('[role="combobox"], input')).not.toBeNull()
    expect(await seriousViolations()).toEqual([])
  })
})

describe('Quick find, with recent pages', () => {
  it('lists them as options of a named listbox', { timeout: COLD }, async () => {
    const page = {
      id: 'p1',
      type: 'page',
      parentId: null,
      content: [],
      props: { title: [['Field notes']] },
      createdAt: 0,
      updatedAt: 0,
      trashedAt: null
    }
    ;(window as unknown as { api: unknown }).api = fakeApi({ 'pages.listRecent': [page], 'pages.search': [] })
    const { setQuickFindOpen } = await import('@/store/ui')
    const { QuickFind } = await import('@/shell/QuickFind')
    await import('@/shell/QuickFindBody')
    setQuickFindOpen(true)
    await render(<QuickFind />)
    await settle(10)
    const input = document.querySelector('[role="combobox"]') as HTMLElement
    const list = document.getElementById(input.getAttribute('aria-controls') ?? '')
    expect(list?.getAttribute('role')).toBe('listbox')
    expect(document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent).toContain('Field notes')
    expect(await seriousViolations()).toEqual([])
    setQuickFindOpen(false)
  })
})

describe('Settings', () => {
  it('is named by its title and has nothing serious', { timeout: COLD }, async () => {
    const { setSettingsOpen } = await import('@/store/ui')
    const { SettingsDialog } = await import('@/shell/SettingsDialog')
    setSettingsOpen(true)
    await render(<SettingsDialog />)
    await settle(10)
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
    expect(title?.textContent?.trim()).toBe('Settings')
    expect(await seriousViolations()).toEqual([])
  })
})
