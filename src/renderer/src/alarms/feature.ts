import { defineFeature } from '@/feature'
import { initAlarms } from './gate'

export const alarmsFeature = defineFeature({
  id: 'alarms',
  // What the alarms' clock in the main process has to say (a briefing at one of its times, a reminder).
  init: () => initAlarms()
})
