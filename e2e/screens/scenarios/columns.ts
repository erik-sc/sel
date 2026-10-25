import type { Page } from '@playwright/test'
import type { Repository } from '../../../src/main/db/repository'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../../src/shared/tasks'
import type { BlockProps, BlockType, Op } from '../../../src/shared/types'
import type { Scenario } from '../registry'
import { openPage, see } from '../ui'

/**
 * Columns on a page: blocks placed beside the block before them (0.9.0 A1a), by dragging a block
 * to the side of another or with the slash items "2 columns" and "3 columns" (A1b).
 */

const PAGE = 'Columns'
const PAGE_ID = 'screens-columns'

interface Node {
  type: BlockType
  text?: string
  props?: BlockProps
  beside?: boolean
  children?: Node[]
}

/** Writes a page named "Columns" holding `nodes`, ids `screens-col-<n>` in order. */
function columnsPage(nodes: Node[]): (repo: Repository) => void {
  return (repo) => {
    const ops: Op[] = [{ op: 'create', input: { id: PAGE_ID, type: 'page', parentId: null, props: { title: [[PAGE]], icon: '🧱' } } }]
    let n = 0
    const add = (node: Node, parentId: string): void => {
      const id = `screens-col-${String(++n).padStart(2, '0')}`
      const props: BlockProps = { ...(node.text !== undefined ? { title: [[node.text]] } : {}), ...node.props }
      if (node.beside) props.beside = true
      ops.push({ op: 'create', input: { id, type: node.type, parentId, props } })
      for (const child of node.children ?? []) add(child, id)
    }
    for (const node of nodes) add(node, PAGE_ID)
    repo.apply(ops)
  }
}

const TWO: Node[] = [
  { type: 'heading_1', text: 'Saturday market' },
  {
    type: 'text',
    text: 'What to bring',
    children: [
      { type: 'bulleted_list', text: 'Two cloth bags and the cool box' },
      { type: 'bulleted_list', text: 'Coins for the bread stall' }
    ]
  },
  {
    type: 'callout',
    beside: true,
    text: 'The cheese stall closes at eleven. Go there first.',
    props: { icon: '💡', color: 'yellow_background' }
  },
  { type: 'heading_2', text: 'After' },
  { type: 'text', text: 'Coffee at the corner, then home before the rain.' }
]

const FOUR: Node[] = [
  { type: 'heading_1', text: 'The week at a glance' },
  { type: 'text', text: 'Monday and Tuesday: the launch post, start to finish.' },
  { type: 'heading_3', text: 'Wednesday is for the garden', beside: true },
  { type: 'to_do', text: 'Call the plumber back', beside: true, props: { checked: false } },
  { type: 'callout', text: 'Friday afternoon stays free.', beside: true, props: { icon: '🌿' } }
]

const BESIDE_DATABASE: Node[] = [
  { type: 'heading_1', text: 'This week' },
  { type: 'text', text: 'Three things matter this week: the launch post, the plumber and the tomatoes.' },
  {
    type: 'database',
    beside: true,
    props: {
      sourceId: TASKS_DATABASE_ID,
      views: [
        {
          id: 'screens.columns.view',
          name: 'Open tasks',
          type: 'list',
          visibleProperties: [TASK_PROPS.title, TASK_PROPS.due],
          filters: [],
          sorts: []
        }
      ]
    }
  }
]

/** A heading and the paragraph under it, to drag beside it (0.9.0 A1b). */
const HEADING = 'Saturday market'
const PARAGRAPH = 'Two cloth bags, the cool box and coins for the bread stall.'
const LAST = 'Coffee at the corner, then home before the rain.'
const DRAG: Node[] = [
  { type: 'heading_2', text: HEADING },
  { type: 'text', text: PARAGRAPH },
  { type: 'text', text: LAST }
]

/** Where the handle (⋮⋮) of the block `text` is, and a point in the right side zone of the block `target`. */
async function dragPoints(
  page: Page,
  text: string,
  target: string
): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  const row = page.locator('.blk > .blk-row').filter({ hasText: text }).first()
  await row.hover()
  const handle = await row.getByRole('button', { name: 'Drag to move, click for options' }).boundingBox()
  const goal = await page.locator('.blk > .blk-row').filter({ hasText: target }).first().boundingBox()
  if (!handle || !goal) throw new Error('nothing to drag')
  return {
    from: { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    to: { x: goal.x + goal.width - 24, y: goal.y + goal.height / 2 }
  }
}

/** Drags the block `text` by its handle with the mouse to the right side of the block `target` and drops it there. */
async function dropToRightOf(page: Page, text: string, target: string): Promise<void> {
  const { from, to } = await dragPoints(page, text, target)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y - 8, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.locator('.blk.drop-right').first().waitFor({ state: 'attached', timeout: 20_000 })
  await page.mouse.up()
}

/**
 * Holds the block `text` mid-drag over the right side of the block `target`. The capture moves
 * the mouse off the window first, which would end a drag made with it, so this one is made of
 * the drag events the window gets from a real drag (dragstart on the handle, dragover on the
 * target); the editor handles them as it handles a real drag.
 */
async function holdOnRightOf(page: Page, text: string, target: string): Promise<void> {
  const { from, to } = await dragPoints(page, text, target)
  await page.evaluate(
    ({ from, to }) => {
      const handle = document.elementFromPoint(from.x, from.y)?.closest('.blk-drag')
      const over = document.elementFromPoint(to.x, to.y)
      if (!handle || !over) throw new Error('nothing to drag')
      const dataTransfer = new DataTransfer()
      const at = { bubbles: true, cancelable: true, dataTransfer }
      handle.dispatchEvent(new DragEvent('dragstart', { ...at, clientX: from.x, clientY: from.y }))
      over.dispatchEvent(new DragEvent('dragenter', { ...at, clientX: to.x, clientY: to.y }))
      over.dispatchEvent(new DragEvent('dragover', { ...at, clientX: to.x, clientY: to.y }))
    },
    { from, to }
  )
  await page.locator('.blk.drop-right').first().waitFor({ state: 'attached', timeout: 20_000 })
}

/** Starts a new line after the paragraph `after` and types `typed` there (a slash and a query). */
async function slash(page: Page, after: string, typed: string): Promise<void> {
  await see(page, after)
  await page.getByText(after, { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(typed)
}

/** Opens a block's menu with its handle, as a pointer would: hover the block, click ⋮⋮. */
async function openBlockMenu(page: Page, text: string): Promise<void> {
  const row = page.locator('.blk > .blk-row').filter({ hasText: text }).first()
  await row.hover()
  await row.getByRole('button', { name: 'Drag to move, click for options' }).click()
}

async function menuOnBeside(page: Page, label: string): Promise<void> {
  await openBlockMenu(page, 'Coffee at the corner')
  const item = page.getByRole('menuitem', { name: label })
  await item.waitFor({ state: 'visible', timeout: 20_000 })
  await item.hover()
}

export default [
  {
    id: 'columns-two',
    description: 'A text block with two child blocks beside a callout, the row at the text width',
    workspace: columnsPage(TWO),
    run: async (page) => {
      await openPage(page, PAGE)
      await see(page, 'The cheese stall closes at eleven. Go there first.')
      await page.locator('.blk-beside').first().waitFor({ state: 'visible', timeout: 20_000 })
    }
  },
  {
    id: 'columns-hover',
    description: 'The caret in a column of the two-column row: the thin line in the middle of the gap',
    workspace: columnsPage(TWO),
    run: async (page) => {
      await openPage(page, PAGE)
      await see(page, 'The cheese stall closes at eleven. Go there first.')
      // The capture moves the pointer off the window first, so a hover would not show: the line
      // shows as well while the row holds the focus.
      await page.getByText('What to bring', { exact: true }).click()
      await page.locator('.blk-beside:focus-within').first().waitFor({ state: 'attached', timeout: 20_000 })
    }
  },
  {
    id: 'columns-four',
    description: 'Four blocks in one row (text, heading, to-do, callout) at the database width',
    workspace: columnsPage(FOUR),
    run: async (page) => {
      await openPage(page, PAGE)
      await see(page, 'Friday afternoon stays free.')
      await page.locator('.blk-beside.is-wide').first().waitFor({ state: 'visible', timeout: 20_000 })
    }
  },
  {
    id: 'columns-beside-database',
    description: 'A text block beside a view of the Tasks database, the row at the database width',
    workspace: columnsPage(BESIDE_DATABASE),
    run: async (page) => {
      await openPage(page, PAGE)
      await see(page, 'Renew the domain')
      await page.locator('.blk-beside.is-wide').first().waitFor({ state: 'visible', timeout: 20_000 })
    }
  },
  {
    id: 'block-menu-beside',
    description: 'A text block’s menu open on "Place beside the previous block"',
    workspace: columnsPage(TWO),
    run: async (page) => {
      await openPage(page, PAGE)
      await menuOnBeside(page, 'Place beside the previous block')
    }
  },
  {
    id: 'block-menu-beside-pt',
    description: 'The same menu in a pt-BR home: "Colocar ao lado do bloco anterior"',
    locale: 'pt-BR',
    workspace: columnsPage(TWO),
    run: async (page) => {
      await openPage(page, PAGE)
      await menuOnBeside(page, 'Colocar ao lado do bloco anterior')
    }
  },
  {
    id: 'columns-drag-right',
    description: 'Mid-drag: a paragraph dragged to the right of a heading, the vertical drop line on its right',
    workspace: columnsPage(DRAG),
    run: async (page) => {
      await openPage(page, PAGE)
      await see(page, HEADING)
      await holdOnRightOf(page, PARAGRAPH, HEADING)
    }
  },
  {
    id: 'columns-dropped',
    description: 'The same paragraph dropped there with the mouse: the heading and the paragraph in two columns',
    workspace: columnsPage(DRAG),
    run: async (page) => {
      await openPage(page, PAGE)
      await see(page, HEADING)
      await dropToRightOf(page, PARAGRAPH, HEADING)
      await page.locator('.blk-beside').filter({ hasText: PARAGRAPH }).waitFor({ state: 'visible', timeout: 20_000 })
    }
  },
  {
    id: 'slash-columns',
    description: 'The slash menu filtered by "col": "2 columns" and "3 columns"',
    workspace: columnsPage(DRAG),
    run: async (page) => {
      await openPage(page, PAGE)
      await slash(page, LAST, '/col')
      await page.getByRole('option', { name: /3 columns/ }).waitFor({ state: 'visible', timeout: 20_000 })
    }
  },
  {
    id: 'slash-columns-made',
    description: '"/col" and Enter on a new line: an empty row of two columns, the caret in the first',
    workspace: columnsPage(DRAG),
    run: async (page) => {
      await openPage(page, PAGE)
      await slash(page, LAST, '/col')
      await page.getByRole('option', { name: /2 columns/ }).waitFor({ state: 'visible', timeout: 20_000 })
      await page.keyboard.press('Enter')
      await page.locator('.blk-beside:focus-within').waitFor({ state: 'attached', timeout: 20_000 })
    }
  },
  {
    id: 'slash-columns-pt',
    description: 'The same in a pt-BR home, filtered by "colunas": "2 colunas" and "3 colunas"',
    locale: 'pt-BR',
    workspace: columnsPage(DRAG),
    run: async (page) => {
      await openPage(page, PAGE)
      await slash(page, LAST, '/colunas')
      await page.getByRole('option', { name: /3 colunas/ }).waitFor({ state: 'visible', timeout: 20_000 })
    }
  }
] satisfies Scenario[]
