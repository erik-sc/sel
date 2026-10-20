import { lazy } from 'react'
import { defineFeature } from '@/feature'
import { activeTab, isBlockId, tabPage } from '@/store/tabs'
import { openTemplates } from './gate'

export const templatesFeature = defineFeature({
  id: 'templates',
  overlays: [{ slot: 'window', order: 100, Overlay: lazy(() => import('./Host').then((module) => ({ default: module.TemplatesHost }))) }],
  menu: {
    'new-from-template': {
      run: () => {
        // The page in front is offered as a place for it; the workspace root stays the default.
        const pageId = tabPage(activeTab())
        openTemplates({ pageId: pageId && isBlockId(pageId) ? pageId : null })
      }
    }
  }
})
