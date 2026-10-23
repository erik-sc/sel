import { defineFeature } from '@/feature'
import { openFlows } from './route'

export const flowsFeature = defineFeature({
  id: 'flows',
  // The heatmaps and the flows of the local activity log (see ../activity).
  menu: { 'open-flows': { run: () => openFlows() } }
})
