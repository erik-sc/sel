import { defineFeature } from '@/feature'
import { goHome, initHome } from './store'

export const homeFeature = defineFeature({
  id: 'home',
  // The home (synced) and what start-up does on this device, for the Home button and Settings.
  init: () => initHome(),
  menu: { 'go-home': { run: () => goHome() } }
})
