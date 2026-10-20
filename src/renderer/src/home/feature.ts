import { defineFeature } from '@/feature'
import { goHome } from './store'

export const homeFeature = defineFeature({
  id: 'home',
  menu: { 'go-home': { run: () => goHome() } }
})
