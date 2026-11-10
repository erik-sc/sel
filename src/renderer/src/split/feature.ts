import { defineFeature } from '@/feature'
import { openSplit } from './route'

export const splitFeature = defineFeature({
  id: 'split',
  // What is shared with the person the user lives with (see shared/finance/household.ts).
  menu: { 'open-split': { run: () => openSplit() } }
})
