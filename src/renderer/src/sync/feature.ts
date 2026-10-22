import { defineFeature } from '@/feature'
import { initSync } from './store'

export const syncFeature = defineFeature({
  id: 'sync',
  // The state of sync, for the indicator in the sidebar (nothing is loaded for it unless this device syncs).
  init: () => void initSync()
})
