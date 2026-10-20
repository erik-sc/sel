import { defineFeature } from '@/feature'
import { newMeeting } from './gate'

export const meetingsFeature = defineFeature({
  id: 'meetings',
  menu: { 'new-meeting': { run: () => void newMeeting() } }
})
