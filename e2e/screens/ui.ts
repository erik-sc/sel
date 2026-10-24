/** Small steps the scenarios share: what a user would click, found the way a screen reader names it. */

import type { Page } from '@playwright/test'

/** A button of the sidebar, by the start of its name ("Tasks" is "Tasks, tasks to refine" while some wait). */
export async function openFromSidebar(page: Page, name: string): Promise<void> {
  await page
    .getByRole('complementary')
    .getByRole('button', { name: new RegExp(`^${name}\\b`) })
    .first()
    .click()
}

/** A page of the sidebar's tree, by its title. */
export async function openPage(page: Page, title: string): Promise<void> {
  await page
    .getByRole('tree', { name: 'Pages' })
    .getByRole('treeitem', { name: new RegExp(`${title}$`) })
    .click()
}

/** Waits until a text is on screen. */
export async function see(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
}
