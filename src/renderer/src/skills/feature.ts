import { defineFeature } from '@/feature'
import { openSkills } from './route'

export const skillsFeature = defineFeature({
  id: 'skills',
  // The user's own skills, kept in sel for the assistants connected over MCP (see shared/skills).
  menu: { 'open-skills': { run: () => openSkills() } }
})
