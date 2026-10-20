import { defineFeature } from '@/feature'
import { openCalendar, openToday } from './route'

export const briefingFeature = defineFeature({
  id: 'briefing',
  menu: {
    'open-today': { run: () => openToday() },
    'open-calendar': { run: () => openCalendar() }
  }
})
