import { defineFeature } from '@/feature'
import { focusQuickAdd, openTasks } from './gate'

export const tasksFeature = defineFeature({
  id: 'tasks',
  menu: {
    'open-tasks': { run: () => openTasks() },
    'add-task': {
      run: () => {
        openTasks()
        focusQuickAdd()
      }
    }
  }
})
