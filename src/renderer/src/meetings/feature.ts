import { lazy } from 'react'
import { defineFeature } from '@/feature'
import { initMeetings, newMeeting } from './gate'

export const meetingsFeature = defineFeature({
  id: 'meetings',
  init: () => initMeetings(),
  overlays: [{ slot: 'window', order: 80, Overlay: lazy(() => import('./slot').then((module) => ({ default: module.MeetingSetup }))) }],
  menu: { 'new-meeting': { run: () => void newMeeting() } }
})
