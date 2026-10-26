import { defineFeature } from '@/feature'
import { tabPage, activeTab } from '@/store/tabs'
import { focusQuickAdd, isTasksRoute, openTasks, selectAllTasks, startRefine, useTasksGate } from './gate'
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
    'refine-tasks': { run: () => startRefine('refine') },
    // Only where there is a list of tasks to select from: the Tasks screen, on one of its lists.
    'select-all-tasks': {
      run: () => selectAllTasks(),
      when: () => isTasksRoute(tabPage(activeTab())) && useTasksGate.getState().list.kind !== 'view' && !useTasksGate.getState().refining
    }
  }
})
