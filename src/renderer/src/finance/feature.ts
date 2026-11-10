import { defineFeature } from '@/feature'
import { openFinance } from './route'

export const financeFeature = defineFeature({
  id: 'finance',
  // The user's own month: accounts, bills, cards, budget, boxes (see shared/finance).
  menu: { 'open-finance': { run: () => openFinance() } }
})
