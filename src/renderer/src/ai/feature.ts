import { lazy } from 'react'
import { defineFeature } from '@/feature'
import { showOrHideAssistant } from '@/shell/panels'
import { aiEnabled, initAi } from './gate'

export const aiFeature = defineFeature({
  id: 'ai',
  // Whether the AI entry points exist at all (`ai.enabled`); they stay hidden until this answers.
  init: () => void initAi(),
  overlays: [
    // Over the page, after the persona's corner (order 10): the balloon comes out of the figure.
    { slot: 'content', order: 15, Overlay: lazy(() => import('./Host').then((module) => ({ default: module.BalloonHost }))) },
    { slot: 'window', order: 70, Overlay: lazy(() => import('./Host').then((module) => ({ default: module.AiSetup }))) },
    // A project's or database's own context (0.8.0 A4).
    {
      slot: 'window',
      order: 75,
      Overlay: lazy(() => import('./ScopeContextHost').then((module) => ({ default: module.ScopeContextHost })))
    }
  ],
  // The palette lists the conversation while AI is on; the shortcut opens the balloon regardless.
  menu: { 'toggle-assistant': { run: () => showOrHideAssistant(), when: aiEnabled } }
})
