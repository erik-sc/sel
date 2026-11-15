// The Skills block's tools (./toolspecs.ts): listing, loading, saving and deleting the user's
// skills, and reading sel's own.
import { builtInSkill, BUILT_IN_SKILLS } from '../../shared/skills/builtin'
import { cleanSkillDescription, cleanSkillName, SKILL_LIMITS, SKILL_PROPS, skillFile } from '../../shared/skills'
import type { Block, Op, PropertyValue } from '../../shared/types'
import { ToolError } from '../ai/tools'
import type { Repository } from '../db/repository'
import { ensureSkills, storedSkill, storedSkills, type StoredSkill } from './store'

export interface SkillsTarget {
  repo: Repository
  markdown: Pick<typeof import('../markdown'), 'pageToMarkdown' | 'appendMarkdownText'>
}

type Args = Record<string, unknown>

const args = (raw: unknown): Args => (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Args) : {})

function nameArg(a: Args): string {
  const name = cleanSkillName(a['name'])
  if (!name) throw new ToolError(`name is lowercase words joined by hyphens, up to ${SKILL_LIMITS.name} characters: "fechar-o-mes".`)
  return name
}

function list({ repo }: SkillsTarget): string {
  const own = storedSkills(repo)
  const lines = [
    own.length
      ? `The user's skills (${own.length}):`
      : 'The user has no skills of their own yet. To make one, load "skill-creator" with get_skill and follow it.',
    ...own.map((skill) => `- ${skill.name}: ${skill.description || '(no description yet)'} [${skill.id}]`),
    '',
    "sel's own skills:",
    ...BUILT_IN_SKILLS.map((skill) => `- ${skill.name}: ${skill.description}`),
    '',
    'Load one with get_skill before doing what it is for.'
  ]
  return lines.join('\n')
}

/** The instructions a skill's page holds. */
export function instructionsOf({ repo, markdown }: SkillsTarget, skill: StoredSkill): string {
  const page = markdown.pageToMarkdown(repo, skill.id)
  // A page written out begins with its title as a heading: the skill's name is said in its file's head, not twice.
  const head = `# ${page.title}`
  const text = page.markdown.trimStart()
  return (text.startsWith(head) && (text.length === head.length || text[head.length] === '\n') ? text.slice(head.length) : text).trim()
}

/** A skill whole, as a `SKILL.md`. */
export function skillText(target: SkillsTarget, name: string): string {
  const builtIn = builtInSkill(name)
  if (builtIn) return skillFile(builtIn)
  const skill = storedSkill(target.repo, name)
  if (!skill) throw new ToolError(`There is no skill called ${name}. list_skills gives the ones there are.`)
  return skillFile({ name: skill.name, description: skill.description, instructions: instructionsOf(target, skill) })
}

/** Saves a skill: a new row, or the description and the text of the one there is. Returns it. */
export function saveSkill(target: SkillsTarget, name: string, description: string, instructions: string | null): StoredSkill {
  const { repo, markdown } = target
  if (builtInSkill(name)) throw new ToolError(`${name} is one of sel's own skills and cannot be replaced: save yours under another name.`)
  const before = storedSkill(repo, name)
  if (!before && storedSkills(repo).length >= SKILL_LIMITS.skills) throw new ToolError(`There are already ${SKILL_LIMITS.skills} skills.`)
  const database = ensureSkills(repo)
  let id = before?.id ?? ''
  repo.transaction(() => {
    if (before) {
      const row = repo.get(before.id) as Block
      const values = { ...((row.props.values ?? {}) as Record<string, PropertyValue>), [SKILL_PROPS.description]: description }
      repo.update(row.id, { props: { values } })
    } else {
      id = repo.create({
        type: 'page',
        parentId: database.id,
        props: { title: [[name]], values: { [SKILL_PROPS.description]: description } }
      }).id
    }
    if (instructions === null) return
    // The page's own text goes (its history keeps it) and the new one takes its place.
    const going = repo.children(id).filter((child) => child.type !== 'page' && child.type !== 'database')
    if (going.length) repo.apply(going.map((child): Op => ({ op: 'delete', id: child.id })))
    if (instructions.trim()) markdown.appendMarkdownText(repo, id, instructions)
  })
  return storedSkill(repo, name) ?? { id, name, description, updatedAt: Date.now() }
}

function save(target: SkillsTarget, a: Args): string {
  // Everything is checked before the workspace is touched: a call that cannot be made creates nothing.
  const name = nameArg(a)
  const description = cleanSkillDescription(a['description'])
  if (!description)
    throw new ToolError(
      `description is one sentence, up to ${SKILL_LIMITS.description} characters: what the skill does and when to use it.`
    )
  const instructions = a['instructions']
  if (typeof instructions !== 'string' || !instructions.trim()) throw new ToolError('instructions is the skill itself, in Markdown.')
  if (instructions.length > SKILL_LIMITS.instructions)
    throw new ToolError(`instructions is too long: keep it under ${SKILL_LIMITS.instructions} characters.`)
  const existed = !!storedSkill(target.repo, name)
  const saved = saveSkill(target, name, description, instructions)
  return existed
    ? `Saved over the skill ${name} [${saved.id}]. Its previous version is in its history in sel.`
    : `Saved the new skill ${name} [${saved.id}]. It is in the Skills screen of sel, and list_skills gives it from now on.`
}

/** Moves a skill to the trash. */
export function removeSkill(repo: Repository, name: string): StoredSkill {
  if (builtInSkill(name)) throw new ToolError(`${name} is one of sel's own skills and cannot be deleted.`)
  const skill = storedSkill(repo, name)
  if (!skill) throw new ToolError(`There is no skill called ${name}. list_skills gives the ones there are.`)
  repo.delete(skill.id)
  return skill
}

export function callSkillTool(target: SkillsTarget, name: string, raw: unknown): string {
  const a = args(raw)
  switch (name) {
    case 'list_skills':
      return list(target)
    case 'get_skill':
      return skillText(target, nameArg(a))
    case 'save_skill':
      return save(target, a)
    case 'delete_skill': {
      const skill = removeSkill(target.repo, nameArg(a))
      return `Moved the skill ${skill.name} [${skill.id}] to the trash. restore_page with that id brings it back.`
    }
    default:
      throw new ToolError(`There is no tool called ${name.slice(0, 40)}.`)
  }
}
