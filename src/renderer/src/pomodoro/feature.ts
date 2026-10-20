import { lazy } from 'react'
import { defineFeature } from '@/feature'
import { initPomodoro, startOrShowPomodoro } from './gate'

export const pomodoroFeature = defineFeature({
  id: 'pomodoro',
  // The pomodoro the main process keeps: the widget shows it while one is on (and after a reload).
  init: () => initPomodoro(),
  overlays: [{ slot: 'content', order: 20, Overlay: lazy(() => import('./Host').then((module) => ({ default: module.PomodoroHost }))) }],
  menu: { 'start-pomodoro': { run: () => startOrShowPomodoro() } }
})
