import { defineFeature } from '@/feature'
import { openCloseDay, openNotebook } from './route'

export const notebookFeature = defineFeature({
  id: 'notebook',
  menu: {
    'open-notebook': { run: () => openNotebook() },
    'close-day': { run: () => openCloseDay() }
  }
})
