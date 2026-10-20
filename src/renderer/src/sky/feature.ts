import { defineFeature } from '@/feature'
import { openSky, skyIsEnabled } from './route'

export const skyFeature = defineFeature({
  id: 'sky',
  // Turned off, the shortcut does nothing and the palette leaves it out.
  menu: { 'open-sky': { run: () => openSky(), when: skyIsEnabled } }
})
