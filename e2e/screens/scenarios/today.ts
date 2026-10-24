import type { Scenario } from '../registry'
import { see } from '../ui'

export default [
  {
    id: 'today',
    description: 'The Today screen with tasks due today, overdue and done',
    run: async (page) => {
      // The app opens on Today; its task list is below the fold at 1280×800.
      const tasks = page.locator('#today-tasks').locator('xpath=..')
      await see(page, 'Write the launch post')
      await tasks.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    }
  }
] satisfies Scenario[]
