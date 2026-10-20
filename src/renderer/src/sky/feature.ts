import { defineFeature } from '@/feature'
import { initSky, openSky, skyIsEnabled } from './route'

export const skyFeature = defineFeature({
  id: 'sky',
  // Whether the Sky is on: its button, command and shortcut follow.
  init: () => initSky(),
  // Turned off, the shortcut does nothing and the palette leaves it out.
  menu: { 'open-sky': { run: () => openSky(), when: skyIsEnabled } }
})
