import { BUILT_IN_SKILLS } from '../../shared/skills/builtin'
import { cleanSkillDescription, cleanSkillName, SKILL_LIMITS } from '../../shared/skills'
import type { SkillView } from '../../shared/skills/api'
import { defineFeature, type Registered } from '../feature'
import * as arg from '../validate'
import { asUser, storedSkills } from './store'

/**
 * The `skills:*` channels: what the Skills screen asks (shared/skills/api.ts). Everything runs as
 * the user (`asUser`): "Private from AI" does not close a skill to the screen that lists them.
 * What is written goes through the same code the MCP tools use (./tools.ts).
 */

function nameOf(value: unknown): string {
  const name = cleanSkillName(arg.text(value, 'name', SKILL_LIMITS.name))
  if (!name) throw new Error('Invalid name')
  return name
}

function descriptionOf(value: unknown): string {
  const text = arg.text(value, 'description', SKILL_LIMITS.description)
  // A skill may be made before it is described: the screen asks for it next.
  return text.trim() ? (cleanSkillDescription(text) ?? '') : ''
}

export const skillsFeature = defineFeature({
  namespace: 'skills',
  register: (ctx): Registered<'skills'> => ({
    handlers: {
      'skills:list': async () =>
        asUser((): SkillView[] => [
          ...storedSkills(ctx.repo).map((skill) => ({ ...skill, builtIn: false })),
          ...BUILT_IN_SKILLS.map((skill) => ({
            name: skill.name,
            description: skill.description,
            builtIn: true,
            id: null,
            updatedAt: null
          }))
        ]),
      'skills:file': async ([name]) => {
        const markdown = await import('../markdown')
        const { skillText } = await import('./tools')
        return asUser(() => skillText({ repo: ctx.repo, markdown }, nameOf(name)))
      },
      'skills:create': async ([name, description]) => {
        const markdown = await import('../markdown')
        const { saveSkill } = await import('./tools')
        const wanted = nameOf(name)
        return asUser(() => {
          if (storedSkills(ctx.repo).some((skill) => skill.name === wanted)) throw new Error('There is already a skill with that name.')
          return saveSkill({ repo: ctx.repo, markdown }, wanted, descriptionOf(description), null).id
        })
      },
      'skills:describe': async ([name, description]) => {
        const markdown = await import('../markdown')
        const { saveSkill } = await import('./tools')
        const wanted = nameOf(name)
        asUser(() => {
          if (!storedSkills(ctx.repo).some((skill) => skill.name === wanted)) throw new Error('There is no skill with that name.')
          saveSkill({ repo: ctx.repo, markdown }, wanted, descriptionOf(description), null)
        })
      },
      'skills:remove': async ([name]) => {
        const { removeSkill } = await import('./tools')
        asUser(() => void removeSkill(ctx.repo, nameOf(name)))
      }
    }
  })
})
