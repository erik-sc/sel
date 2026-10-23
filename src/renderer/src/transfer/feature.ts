import { lazy } from 'react'
import { defineFeature } from '@/feature'
// The gate registers the palette's commands (import from Notion or Obsidian, export as a zip).
import './gate'

export const transferFeature = defineFeature({
  id: 'transfer',
  overlays: [{ slot: 'window', order: 95, Overlay: lazy(() => import('./Host').then((module) => ({ default: module.TransferHost }))) }]
})
