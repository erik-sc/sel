import { defineFeature } from '@/feature'
import { openFeedback } from './gate'

export const feedbackFeature = defineFeature({
  id: 'feedback',
  menu: { 'send-feedback': { run: () => openFeedback() } }
})
