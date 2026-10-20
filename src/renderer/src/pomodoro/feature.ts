import { defineFeature } from '@/feature'
import { startOrShowPomodoro } from './gate'

export const pomodoroFeature = defineFeature({
  id: 'pomodoro',
  menu: { 'start-pomodoro': { run: () => startOrShowPomodoro() } }
})
