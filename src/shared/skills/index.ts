/**
 * The Skills block: the user's own skills, kept in sel instead of in an assistant's account. A
 * skill is a procedure written once ("how I close the month", "how I refine a task") that an
 * assistant connected over MCP lists, loads and follows: a name, one line saying what it is for
 * and when to use it, and its instructions in Markdown.
 *
 * Each skill is a row of one ordinary database with a fixed id: the row's title is the skill's
 * name, a text property holds the description, and the page's own text is the instructions. So a
 * skill is edited as any page is, its history keeps every version of it, and sync, export, search
 * and "Private from AI" apply with nothing added. Like the Finance page, the database stays out
 * of the sidebar's tree (renderer store/tree.ts): the Skills screen stands for it.
 *
 * Besides the user's, sel has skills of its own (`BUILT_IN_SKILLS`, ./builtin.ts): how to make a
 * skill, and how to work each block. They are in the code, listed with the user's, and cannot be
 * changed or replaced.
 *
 * Pure: no Electron, Node or React.
 */
import type { BlockProps, PropertySchema } from '../types'

export const SKILLS_DATABASE_ID = '5e1d0000-0000-4000-8000-5b1115000001'

export const SKILL_PROPS = {
  title: 'title',
  description: 'skl.description'
} as const

const record = (properties: readonly PropertySchema[]): Record<string, PropertySchema> =>
  Object.fromEntries(properties.map((property) => [property.id, property]))

/** The database as it is created. A function: callers may change what they are given. */
export function skillsDatabaseProps(): BlockProps {
  return {
    title: [['Skills']],
    icon: '🧩',
    schema: record([
      { id: SKILL_PROPS.title, name: 'Name', type: 'title' },
      { id: SKILL_PROPS.description, name: 'Description', type: 'text' }
    ]),
    views: [
      {
        id: 'skl.all',
        name: 'All',
        type: 'table',
        visibleProperties: [SKILL_PROPS.title, SKILL_PROPS.description],
        filters: [],
        sorts: []
      }
    ]
  }
}

export const SKILL_LIMITS = { name: 64, description: 1024, instructions: 100_000, skills: 500 } as const

/** A skill's name: lowercase words joined by hyphens, as an assistant asks for it. */
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** The name as it is kept, or null when it is not one. */
export function cleanSkillName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().toLowerCase()
  return name.length <= SKILL_LIMITS.name && NAME_RE.test(name) ? name : null
}

/** Whatever was typed as a name, made into one: "Fechar o mês!" is `fechar-o-mes`. Empty when nothing of it can be. */
export function slugSkillName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, SKILL_LIMITS.name)
    .replace(/-+$/u, '')
}

/** The description as it is kept: one line. Null when empty or too long. */
export function cleanSkillDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/gu, ' ').trim()
  return text && text.length <= SKILL_LIMITS.description ? text : null
}

export interface Skill {
  name: string
  description: string
  instructions: string
}

/**
 * A skill as the file other tools keep skills in (`SKILL.md`): the name and the description
 * between two lines of dashes, then the instructions.
 */
export function skillFile(skill: Skill): string {
  // The description is one line; quoted, so that a colon in it is text.
  const description = JSON.stringify(skill.description)
  return `---\nname: ${skill.name}\ndescription: ${description}\n---\n\n${skill.instructions.trim()}\n`
}
