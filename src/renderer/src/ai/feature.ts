import { defineFeature } from '@/feature'
import { showOrHideAssistant } from '@/shell/panels'
import { aiEnabled } from './gate'

export const aiFeature = defineFeature({
  id: 'ai',
  // The palette lists Herman while AI is on; the shortcut opens his panel regardless.
  menu: { 'toggle-assistant': { run: () => showOrHideAssistant(), when: aiEnabled } }
})
