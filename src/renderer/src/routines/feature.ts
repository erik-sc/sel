import { defineFeature } from '@/feature'
import { aiEnabled } from '@/ai/gate'
import { initRoutines, runRoutine } from './client'

/** The persona's routines (shared/routines.ts): what they prepared is said at quiet moments; the palette runs one now. */
export const routinesFeature = defineFeature({
  id: 'routines',
  init: () => initRoutines(),
  // "Run routine now", one per routine, listed while AI is on.
  menu: {
    'routine-morning': { run: () => void runRoutine('morning'), when: aiEnabled },
    'routine-midday': { run: () => void runRoutine('midday'), when: aiEnabled },
    'routine-evening': { run: () => void runRoutine('evening'), when: aiEnabled },
    'routine-weekly': { run: () => void runRoutine('weekly') },
    'routine-stalled': { run: () => void runRoutine('stalled'), when: aiEnabled }
  }
})
