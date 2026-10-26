import type { Page } from '@playwright/test'
import type { Scenario } from '../registry'
import { SEED_NAMES } from '../seed'
import { openFromSidebar, see } from '../ui'

/** The Tasks screen, on one of the database's views (listed under "Views"). */
async function openView(page: Page, view: string): Promise<void> {
  await openFromSidebar(page, 'Tasks')
  await page.locator('.tasks-nav-item').filter({ hasText: view }).first().click()
}

/** The Tasks screen on its Today list, three rows picked with Shift+Down from the first. */
async function pickThree(page: Page): Promise<void> {
  // Today is the list the screen opens on; the sidebar and the list names are in the home's language.
  await openFromSidebar(page, '(?:Tasks|Tarefas)')
  await see(page, 'Write the launch post')
  await page.locator('.tasks-list [data-task-row]').first().focus()
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
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
  },
  {
    id: 'tasks-selection',
    description: 'The Tasks list Today with three rows selected (Shift+Down twice)',
    run: async (page) => {
      await pickThree(page)
    }
  },
  {
    id: 'tasks-selection-date',
    description: 'The same three rows with D pressed: the day menu that sets all three',
    run: async (page) => {
      await pickThree(page)
      await page.keyboard.press('d')
      await page.getByRole('menuitem', { name: 'Tomorrow' }).first().waitFor({ state: 'visible', timeout: 20_000 })
    }
  },
  {
    id: 'tasks-selected',
    description: 'The Tasks list Today with three rows selected and the strip at the foot ("3 selected")',
    run: async (page) => {
      await pickThree(page)
      await page.getByRole('group', { name: 'Selected tasks' }).waitFor({ state: 'visible', timeout: 20_000 })
    }
  },
  {
    id: 'tasks-selected-pt',
    description: 'The same selection and strip in a pt-BR home ("3 selecionadas", "Deixar ir")',
    locale: 'pt-BR',
    run: async (page) => {
      await pickThree(page)
      await page.getByRole('group', { name: 'Tarefas selecionadas' }).waitFor({ state: 'visible', timeout: 20_000 })
    }
  },
  {
    id: 'tasks-let-go',
    description: 'Let go pressed on the strip: the "Let go of 3 tasks?" question',
    run: async (page) => {
      await pickThree(page)
      await page.getByRole('group', { name: 'Selected tasks' }).getByRole('button', { name: 'Let go' }).click()
      await page.getByRole('dialog', { name: 'Let go of 3 tasks?' }).waitFor({ state: 'visible', timeout: 20_000 })
    }
  }
] satisfies Scenario[]
