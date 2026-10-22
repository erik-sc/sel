import { lazy } from 'react'
import { defineFeature } from '@/feature'
import { initUpdates } from './store'

export const updatesFeature = defineFeature({
  id: 'updates',
  // What the main process knows about a new version, for the notice and Settings. Reading it asks nothing of the network.
  init: () => initUpdates(),
  overlays: [{ slot: 'content', order: 40, Overlay: lazy(() => import('./Notice').then((module) => ({ default: module.UpdateNotice }))) }]
})
