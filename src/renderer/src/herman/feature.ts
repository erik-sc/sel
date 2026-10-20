import { lazy } from 'react'
import { defineFeature } from '@/feature'
import { initHerman } from './gate'

/** Whether Herman, the assistant's face, is on (`herman.enabled`): his figure is fetched when the app is idle. */
let ready: Promise<void> | null = null

export const hermanFeature = defineFeature({
  id: 'herman',
  init: () => {
    ready = initHerman()
  },
  idle: () => {
    void ready?.then(() => import('./Host')).then((module) => module.preloadHerman())
  },
  overlays: [{ slot: 'content', order: 10, Overlay: lazy(() => import('./Host').then((module) => ({ default: module.HermanHost }))) }]
})
