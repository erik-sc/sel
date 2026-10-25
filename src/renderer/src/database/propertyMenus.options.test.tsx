// @vitest-environment happy-dom
// A select's options in its property menu (0.9.0, B3): listed under the name, added from a field,
// opened in the cell picker's edit pane with Back, moved with Alt+arrows or a drag, deleted as the
// cell picker deletes them; and the whole menu in the home's language.
import { act } from 'react'
import type { JSX } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_PROPS, TASKS_DATABASE_ID, tasksDatabaseProps } from '@shared/tasks'
import type { Block, DatabaseView, PropertySchema, SelectOption } from '@shared/types'
import { cleanup, fakeApi, press, render, seriousViolations, settle } from '@/a11y/testing'
import { useHome } from '@/home/store'
import { getBlock, putBlocks, useBlock } from '@/store/blocks'

vi.mock('./lazyParts', () => ({
  PartFallback: () => null,
  RelationTargetPicker: () => null,
  FormulaEditor: () => null
}))

import { PropertyMenu } from './propertyMenus'
import { dropIndex } from './optionList'
import * as L from './logic'

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi({ 'blocks.apply': [] })
})

const view: DatabaseView = { id: 'db-view', name: 'Table', type: 'table', visibleProperties: ['title', 'pri'], filters: [], sorts: [] }

const PRIORITY: SelectOption[] = [
  { id: 'high', name: 'High', color: 'red' },
  { id: 'medium', name: 'Medium', color: 'yellow' },
  { id: 'low', name: 'Low', color: 'gray' }
]

function database(options: SelectOption[] = PRIORITY, content: string[] = []): Block {
  return {
    id: 'db',
    type: 'database',
    parentId: null,
    content,
    props: {
      title: [['Chores']],
      schema: {
        title: { id: 'title', name: 'Task', type: 'title' },
        pri: { id: 'pri', name: 'Priority', type: 'select', options },
        tags: { id: 'tags', name: 'Tags', type: 'multi_select', options: [] },
        rel: { id: 'rel', name: 'Linked', type: 'relation', relation: { databaseId: 'db' } },
        sum: { id: 'sum', name: 'Count', type: 'rollup', rollup: { function: 'count', relationId: 'rel' } },
        num: { id: 'num', name: 'Cost', type: 'number' }
      },
      views: [view]
    },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }
}

function row(id: string, values: Record<string, unknown>): Block {
  return {
    id,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: [[id]], values: values as never },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }
}

const propNow = (id = 'pri', db = 'db'): PropertySchema => L.normalizeDatabase(getBlock(db)).schema[id]
const names = (id = 'pri', db = 'db'): string[] => L.optionsOf(propNow(id, db)).map((o) => o.name)

/** The menu as a table header draws it: its property read from the store on every change. */
function Header({ propertyId, databaseId, onClose }: { propertyId: string; databaseId: string; onClose: () => void }): JSX.Element | null {
  const block = useBlock(databaseId)
  const { schema, views } = L.normalizeDatabase(block)
  const prop = schema[propertyId]
  const anchor = document.getElementById('anchor')
  if (!prop) return null
  return <PropertyMenu databaseId={databaseId} prop={prop} view={views[0]} anchor={anchor} onClose={onClose} onFilter={() => undefined} />
}

async function openMenu(propertyId = 'pri', databaseId = 'db'): Promise<ReturnType<typeof vi.fn>> {
  const anchor = document.createElement('button')
  anchor.id = 'anchor'
  anchor.textContent = 'Priority'
  document.body.append(anchor)
  const onClose = vi.fn()
  await render(<Header propertyId={propertyId} databaseId={databaseId} onClose={onClose} />)
  await settle()
  return onClose
}

const addField = (): HTMLInputElement => document.querySelector('.db-option-add input') as HTMLInputElement
const optionButton = (name: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('.db-option-button')].find((el) => el.textContent === name) as HTMLButtonElement
const shownOptions = (): string[] => [...document.querySelectorAll('.db-option-button')].map((el) => el.textContent ?? '')
const paneName = (): HTMLInputElement => document.querySelector('.db-option-edit-head input') as HTMLInputElement
const button = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.textContent === label || el.getAttribute('aria-label') === label
  ) as HTMLButtonElement
const said = (): Promise<void> => act(() => new Promise<void>((resolve) => setTimeout(resolve, 80)))
const announced = (): string | null | undefined => document.querySelector('[data-announcer]')?.textContent

async function type(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  useHome.setState({ locale: 'en' })
  putBlocks([database()])
})

afterEach(cleanup)

describe('the options of a select in its property menu', () => {
  it('lists the options under the name, then the add field, then the menu, and axe finds nothing serious', async () => {
    await openMenu()
    const section = document.querySelector('.db-option-section') as HTMLElement
    expect(section.querySelector('.ui-menu-header')?.textContent).toBe('Options')
    const list = section.querySelector('[role="list"]') as HTMLElement
    expect(list.getAttribute('aria-labelledby')).toBe(section.querySelector('.ui-menu-header')?.id)
    expect(shownOptions()).toEqual(['High', 'Medium', 'Low'])
    const items = [...list.querySelectorAll('[role="listitem"]')]
    expect(items.map((el) => [el.getAttribute('aria-posinset'), el.getAttribute('aria-setsize')])).toEqual([
      ['1', '3'],
      ['2', '3'],
      ['3', '3']
    ])
    // One Tab stop: the first option until another is focused; the handles are for the pointer.
    expect([...list.querySelectorAll('.db-option-button')].map((el) => (el as HTMLElement).tabIndex)).toEqual([0, -1, -1])
    expect(button('Move Low').tabIndex).toBe(-1)
    expect(optionButton('Low').title).toBe('Low')
    expect(addField().placeholder).toBe('Add an option')
    // The name field keeps the focus it had before options were listed.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Property name')
    expect(await seriousViolations()).toEqual([])
  })

  it('adds "Groceries", renames it, moves it to the top with Alt+ArrowUp and deletes it, checking the schema each time', async () => {
    await openMenu()

    // Add: Enter adds it with the next colour, the field clears and keeps the focus.
    addField().focus()
    await type(addField(), 'Groceries')
    await press(addField(), 'Enter')
    expect(names()).toEqual(['High', 'Medium', 'Low', 'Groceries'])
    expect(addField().value).toBe('')
    expect(document.activeElement).toBe(addField())
    expect(shownOptions()).toEqual(['High', 'Medium', 'Low', 'Groceries'])
    await said()
    expect(announced()).toBe('Groceries added')
    const id = L.optionsOf(propNow()).find((o) => o.name === 'Groceries')?.id as string

    // Rename: Enter opens the pane, Enter in its name field saves and goes Back.
    await act(async () => optionButton('Groceries').click())
    expect(paneName().value).toBe('Groceries')
    expect(document.activeElement).toBe(paneName())
    expect(button('Back')).toBeTruthy()
    await type(paneName(), 'Shopping')
    await press(paneName(), 'Enter')
    await settle()
    expect(names()).toEqual(['High', 'Medium', 'Low', 'Shopping'])
    expect(L.findOption(propNow(), id)?.name).toBe('Shopping')
    // Back on the list, on the option it opened.
    expect(document.activeElement).toBe(optionButton('Shopping'))

    // Move: Alt+ArrowUp three times takes it to the top; the focus stays on it.
    for (let i = 0; i < 3; i++) {
      await press(document.activeElement as Element, 'ArrowUp', { altKey: true })
      await settle(1)
    }
    expect(names()).toEqual(['Shopping', 'High', 'Medium', 'Low'])
    expect(L.optionsOf(propNow())[0].id).toBe(id)
    expect(shownOptions()).toEqual(['Shopping', 'High', 'Medium', 'Low'])
    expect(document.activeElement).toBe(optionButton('Shopping'))
    await said()
    expect(announced()).toBe('Shopping, position 1 of 4')
    // At the top, another Alt+ArrowUp changes nothing.
    await press(optionButton('Shopping'), 'ArrowUp', { altKey: true })
    expect(names()).toEqual(['Shopping', 'High', 'Medium', 'Low'])

    // Delete: from the pane; the list comes back on the next option.
    await press(optionButton('Shopping'), 'Enter')
    await act(async () => optionButton('Shopping').click())
    await act(async () => button('Delete option').click())
    await settle()
    expect(names()).toEqual(['High', 'Medium', 'Low'])
    expect(L.findOption(propNow(), id)).toBeUndefined()
    expect(document.activeElement).toBe(optionButton('High'))
  })

  it('moves among options with the arrows, without wrapping, and Alt+ArrowDown moves one down', async () => {
    await openMenu()
    optionButton('High').focus()
    await press(optionButton('High'), 'ArrowUp')
    expect(document.activeElement).toBe(optionButton('High'))
    await press(optionButton('High'), 'ArrowDown')
    expect(document.activeElement).toBe(optionButton('Medium'))
    expect(optionButton('Medium').tabIndex).toBe(0)
    expect(optionButton('High').tabIndex).toBe(-1)
    await press(optionButton('Medium'), 'End')
    expect(document.activeElement).toBe(optionButton('Low'))
    await press(optionButton('Low'), 'Home')
    await press(optionButton('High'), 'ArrowDown', { altKey: true })
    await settle(1)
    expect(names()).toEqual(['Medium', 'High', 'Low'])
    expect(document.activeElement).toBe(optionButton('High'))
    await said()
    expect(announced()).toBe('High, position 2 of 3')
  })

  it('adds nothing for an empty field or a name that exists already, and clears the field', async () => {
    await openMenu()
    addField().focus()
    await press(addField(), 'Enter')
    expect(names()).toEqual(['High', 'Medium', 'Low'])
    await type(addField(), ' medium ')
    await press(addField(), 'Enter')
    expect(names()).toEqual(['High', 'Medium', 'Low'])
    expect(addField().value).toBe('')
  })

  it('goes Back on Escape in the pane instead of closing, and closes on Escape from the list', async () => {
    const onClose = await openMenu()
    await act(async () => optionButton('Medium').click())
    expect(paneName()).toBeTruthy()
    await press(paneName(), 'Escape')
    expect(onClose).not.toHaveBeenCalled()
    expect(paneName()).toBeNull()
    expect(document.activeElement).toBe(optionButton('Medium'))
    await press(optionButton('Medium'), 'Escape')
    expect(onClose).toHaveBeenCalled()
  })

  it('reorders by dragging a handle onto another row', async () => {
    await openMenu()
    const rowOf = (name: string): HTMLElement => optionButton(name).closest('.db-option-row') as HTMLElement
    const drag = (type: string, target: Element, clientY = 0): Promise<void> =>
      act(async () => {
        const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown; clientY: number }
        Object.defineProperty(event, 'dataTransfer', {
          value: { setData: () => undefined, setDragImage: () => undefined, effectAllowed: '', dropEffect: '' }
        })
        Object.defineProperty(event, 'clientY', { value: clientY })
        target.dispatchEvent(event)
      })
    await drag('dragstart', button('Move Low'))
    expect(rowOf('Low').classList.contains('is-dragging')).toBe(true)
    // happy-dom lays nothing out: every box is at 0, so any pointer is in a row's lower half.
    await drag('dragover', rowOf('High'), -1)
    expect(rowOf('High').classList.contains('drop-before')).toBe(true)
    await drag('drop', rowOf('High'), -1)
    expect(names()).toEqual(['Low', 'High', 'Medium'])
    expect(document.querySelector('.drop-before, .drop-after, .is-dragging')).toBeNull()
  })

  it('works out where a dragged option lands', () => {
    expect(dropIndex(0, 3)).toBe(2)
    expect(dropIndex(2, 0)).toBe(0)
    expect(dropIndex(1, 1)).toBe(1)
    expect(dropIndex(1, 2)).toBe(1)
  })

  it('deletes an option as the cell picker does: rows that used it lose the value', async () => {
    putBlocks([database(PRIORITY, ['r1', 'r2']), row('r1', { pri: 'low' }), row('r2', { pri: 'high' })])
    await openMenu()
    await act(async () => optionButton('Low').click())
    await act(async () => button('Delete option').click())
    await settle()
    expect(names()).toEqual(['High', 'Medium'])
    expect(L.valuesOf(getBlock('r1') as Block).pri ?? null).toBeNull()
    expect(L.valuesOf(getBlock('r2') as Block).pri).toBe('high')
    // It was the last: the focus goes to the one before it.
    expect(document.activeElement).toBe(optionButton('Medium'))
  })

  it('shows only the add field when there are no options, and a multi-select the same way', async () => {
    await openMenu('tags')
    const section = document.querySelector('.db-option-section') as HTMLElement
    expect(section.querySelector('[role="list"]')).toBeNull()
    expect(section.textContent).toBe('Options')
    expect(addField()).toBeTruthy()
    addField().focus()
    await type(addField(), 'Errand')
    await press(addField(), 'Enter')
    expect(names('tags')).toEqual(['Errand'])
    // The last one deleted: the focus goes to the add field.
    await act(async () => optionButton('Errand').click())
    await act(async () => button('Delete option').click())
    await settle()
    expect(names('tags')).toEqual([])
    expect(document.activeElement).toBe(addField())
    expect(await seriousViolations()).toEqual([])
  })

  it('lists no options for a property that is not a select', async () => {
    await openMenu('num')
    expect(document.querySelector('.db-option-section')).toBeNull()
  })

  it('keeps Tab inside the menu: name, options, add field, the menu, and round again', async () => {
    await openMenu()
    const name = document.activeElement as HTMLElement
    const menu = document.querySelector('.db-prop-menu [role="menu"]') as HTMLElement
    // The browser moves the focus on Tab; only the wrap at the ends is the menu's.
    menu.focus()
    await press(menu, 'Tab')
    expect(document.activeElement).toBe(name)
    await press(name, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(menu)
    expect(menu.tabIndex).toBe(0)
    // ArrowUp on the first entry goes back to the add field.
    await press(menu, 'ArrowDown')
    await press(menu, 'ArrowUp')
    expect(document.activeElement).toBe(addField())
  })
})

describe('the Tasks database’s priorities', () => {
  beforeEach(() => {
    putBlocks([
      {
        id: TASKS_DATABASE_ID,
        type: 'database',
        parentId: null,
        content: [],
        props: { ...tasksDatabaseProps(), title: [['Tasks']] },
        createdAt: 0,
        updatedAt: 0,
        trashedAt: null
      }
    ])
  })

  it('can be renamed but not moved or deleted from the menu', async () => {
    await openMenu(TASK_PROPS.priority, TASKS_DATABASE_ID)
    expect(shownOptions()).toEqual(['P1', 'P2', 'P3', 'P4'])
    expect(document.querySelector('.db-option-handle')).toBeNull()
    optionButton('P2').focus()
    await press(optionButton('P2'), 'ArrowUp', { altKey: true })
    expect(names(TASK_PROPS.priority, TASKS_DATABASE_ID)).toEqual(['P1', 'P2', 'P3', 'P4'])
    await act(async () => optionButton('P2').click())
    expect(button('Delete option')).toBeUndefined()
    await type(paneName(), 'Soon')
    await press(paneName(), 'Enter')
    await settle()
    expect(names(TASK_PROPS.priority, TASKS_DATABASE_ID)).toEqual(['P1', 'Soon', 'P3', 'P4'])
  })

  it('keeps the move handles on the user’s own selects there (Project)', async () => {
    putBlocks([
      {
        ...(getBlock(TASKS_DATABASE_ID) as Block),
        props: {
          ...tasksDatabaseProps(),
          schema: {
            ...(tasksDatabaseProps().schema as Record<string, PropertySchema>),
            [TASK_PROPS.project]: {
              id: TASK_PROPS.project,
              name: 'Project',
              type: 'select',
              options: [{ id: 'garden', name: 'Garden', color: 'green' }]
            }
          }
        }
      }
    ])
    await openMenu(TASK_PROPS.project, TASKS_DATABASE_ID)
    expect(button('Move Garden')).toBeTruthy()
  })
})

describe('the property menu in pt-BR', () => {
  it('reads every entry in Portuguese, with no English left', async () => {
    useHome.setState({ locale: 'pt-BR' })
    await openMenu()
    const entries = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    expect(entries).toEqual([
      'Tipo: Seleção única',
      'Ordenar crescente',
      'Ordenar decrescente',
      'Filtrar',
      'Ocultar na visualização',
      'Excluir propriedade'
    ])
    expect(document.querySelector('.db-option-section .ui-menu-header')?.textContent).toBe('Opções')
    expect(addField().placeholder).toBe('Adicionar uma opção')
    expect(button('Mover Low')).toBeTruthy()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Nome da propriedade')
    const english = /\b(Type|Sort|Filter|Hide|Delete|Options|Add|Move|Property)\b/
    expect(document.querySelector('.db-prop-menu')?.textContent).not.toMatch(english)
    await act(async () => optionButton('Low').click())
    expect(button('Voltar')).toBeTruthy()
    await press(paneName(), 'Escape')
    await press(optionButton('Low'), 'ArrowUp', { altKey: true })
    await said()
    expect(announced()).toBe('Low, posição 2 de 3')
    expect(await seriousViolations()).toEqual([])
  })

  it('reads the number, relation and rollup entries in Portuguese', async () => {
    useHome.setState({ locale: 'pt-BR' })
    await openMenu('num')
    expect([...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)).toContain('Formato do número')
    await cleanup()
    await openMenu('rel')
    const relation = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    // Outside a database block nothing resolves the related database: it reads as untitled.
    expect(relation).toContain('Relacionada a: Sem título')
    expect(relation).toContain('Limite: sem limite')
    expect(relation.some((t) => t?.startsWith('Duas vias:'))).toBe(true)
    await cleanup()
    await openMenu('sum')
    const rollup = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    expect(rollup).toContain('Relação: nenhuma')
    expect(rollup).toContain('Propriedade: nenhuma')
    expect(rollup).toContain('Calcular: Contar todos')
    expect(rollup.some((t) => t?.startsWith('Linhas: '))).toBe(true)
  })
})
