import type { ToolSpec } from '../ai/toolspecs'
import { definePack, scoped } from '../tools/pack'

/**
 * The Skills block's tools as the MCP servers list them (see ./tools.ts for what they do, and
 * shared/skills for what a skill is). Plain data: the server script bundles this file.
 */

const NAME = {
  type: 'string',
  description: 'The skill\'s name, as list_skills gives it: lowercase words joined by hyphens, "fechar-o-mes".'
}

const READ: readonly ToolSpec[] = [
  {
    name: 'list_skills',
    description:
      "The user's skills, kept in sel: procedures they wrote once so as not to explain them again, each with a name and one line saying what it is for and when to use it; and sel's own, on how to work its blocks and how to make a skill. Call it at the start of a conversation that will do something in sel or something the user may have a way of doing, and load the one that fits with get_skill before acting.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_skill',
    description:
      "A skill whole: its name, its description and its instructions. Follow the instructions as the user's own way of doing that job.",
    inputSchema: { type: 'object', properties: { name: NAME }, required: ['name'], additionalProperties: false }
  }
]

const WRITE: readonly ToolSpec[] = [
  {
    name: 'save_skill',
    description:
      'Saves a skill in sel: a new one, or over the one of that name, whose previous version stays in its history. Before writing one, load the skill "skill-creator" with get_skill and follow it: it says what to ask the user and how a skill is written. The names of sel\'s own skills cannot be used.',
    inputSchema: {
      type: 'object',
      properties: {
        name: NAME,
        description: {
          type: 'string',
          description:
            'One sentence, in the third person: what the skill does, then when to use it, with the words the user would say. It is all a conversation sees when deciding whether to load the skill.'
        },
        instructions: {
          type: 'string',
          description: 'The instructions, in Markdown: what the job is, the steps, the rules, the shape of the result.'
        }
      },
      required: ['name', 'description', 'instructions'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_skill',
    description:
      "Moves one of the user's skills to the trash; restore_page with its id brings it back. sel's own skills cannot be deleted.",
    inputSchema: { type: 'object', properties: { name: NAME }, required: ['name'], additionalProperties: false }
  }
]

export const SKILLS_PACK = definePack({
  id: 'skills',
  title: 'Skills',
  summary:
    'The user\'s own skills, kept and versioned in sel: procedures to load and follow (list_skills, get_skill) and to write with them (save_skill, after loading "skill-creator"). sel\'s own skills say how to work each block.',
  tools: [...scoped('read', READ), ...scoped('write', WRITE)]
})
