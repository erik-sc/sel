import type { Scenario } from '../registry'
import { SEED_NAMES } from '../seed'
import { openPage, see } from '../ui'

export default [
  {
    id: 'page-notes',
    description: 'The demo Notes page: headings, text, to-dos, a callout and an open toggle',
    run: async (page) => {
      await openPage(page, SEED_NAMES.notes)
      await see(page, 'Weekly notes')
      await see(page, 'A small newsletter, once a month, with what grew and what did not.')
    }
  }
] satisfies Scenario[]
