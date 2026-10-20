import { lazy } from 'react'
import { defineFeature } from '@/feature'
import { openFeedback } from './gate'

export const feedbackFeature = defineFeature({
  id: 'feedback',
  overlays: [{ slot: 'window', order: 90, Overlay: lazy(() => import('./Host').then((module) => ({ default: module.FeedbackHost }))) }],
  menu: { 'send-feedback': { run: () => openFeedback() } }
})
