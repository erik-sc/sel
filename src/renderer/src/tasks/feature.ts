import { defineFeature } from '@/feature'
import { focusQuickAdd, openTasks, startRefine } from './gate'
import { initRefining } from './refining'

export const tasksFeature = defineFeature({
  id: 'tasks',
  // The count of tasks to refine: the sidebar's mark and the line on Today.
  idle: () => initRefining(),
  menu: {
    'open-tasks': { run: () => openTasks() },
    'add-task': {
      run: () => {
        openTasks()
        focusQuickAdd()
      }
    },
    'refine-tasks': { run: () => startRefine('refine') }
  }
})
