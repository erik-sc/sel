import type { Page } from '@playwright/test'
import type { Repository } from '../../../src/main/db/repository'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../../src/shared/tasks'
import type { BlockProps, BlockType, Op } from '../../../src/shared/types'
import type { Scenario } from '../registry'
import { openPage, see } from '../ui'

/** Columns on a page (0.9.0 A1a): blocks placed beside the block before them. */

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
    description: 'The two-column row hovered: the thin line in the middle of the gap',
    workspace: columnsPage(TWO),
    run: async (page) => {
      await openPage(page, PAGE)
      await see(page, 'The cheese stall closes at eleven. Go there first.')
      // The middle of the row is the gap between its columns: the line shows, no block's handles do.
      await page.locator('.blk-beside').first().hover()
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
  }
] satisfies Scenario[]
