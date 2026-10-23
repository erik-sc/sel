import { defineFeature } from '@/feature'
import { initActivity } from './tracker'

export const activityFeature = defineFeature({
  id: 'activity',
  // Which screen or page this window shows goes to the local activity log (never synced, never sent to AI).
  init: () => initActivity()
})
