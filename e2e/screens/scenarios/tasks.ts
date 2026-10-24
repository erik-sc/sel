import type { Page } from '@playwright/test'
import type { Scenario } from '../registry'
import { SEED_NAMES } from '../seed'
import { openFromSidebar, see } from '../ui'

/** The Tasks screen, on one of the database's views (listed under "Views"). */
async function openView(page: Page, view: string): Promise<void> {
  await openFromSidebar(page, 'Tasks')
  await page.locator('.tasks-nav-item').filter({ hasText: view }).first().click()
}

export default [
  {
    id: 'tasks-table',
    description: 'The Tasks database as a table',
    run: async (page) => {
      await openView(page, SEED_NAMES.table)
      await see(page, 'Renew the domain')
    }
  },
  {
    id: 'tasks-board',
    description: 'The Tasks database as a board grouped by priority',
    run: async (page) => {
      await openView(page, SEED_NAMES.boardByPriority)
      await see(page, 'Renew the domain')
    }
  },
  {
    id: 'tasks-calendar',
    description: 'The Tasks database as a calendar on the current month',
    run: async (page) => {
      await openView(page, SEED_NAMES.calendar)
      await see(page, 'Write the launch post')
    }
  }
] satisfies Scenario[]
