import { defineFeature } from '@/feature'
import { openWeekReview } from './route'

export const reviewFeature = defineFeature({
  id: 'review',
  menu: {
    'week-review': { run: () => openWeekReview() }
  }
})
