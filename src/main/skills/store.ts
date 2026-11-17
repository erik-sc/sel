// The Skills block's data in the workspace (shared/skills): one database, a row a skill. It is
// made the first time a skill is saved, never at start-up and never on a read.
import { AI_PRIVATE_MESSAGE, isPrivateForAi, privacyChecker } from '../../shared/aiPrivate'
import { plainText } from '../../shared/richtext'
import {
  cleanSkillDescription,
  cleanSkillName,
  SKILL_PROPS,
  SKILLS_DATABASE_ID,
  skillsDatabaseProps,
  slugSkillName
} from '../../shared/skills'
import type { Block, PropertyValue } from '../../shared/types'
import { ToolError } from '../ai/tools'
import type { Repository } from '../db/repository'

/**
 * True while the user is the one asking, in their own window: "Private from AI" closes a skill to
 * an assistant, not to the screen that lists the user's own skills.
 */
let user = false

/** Runs `fn` as the user in their own window. */
export function asUser<T>(fn: () => T): T {
  const before = user
  user = true
  try {
    return fn()
  } finally {
    user = before
  }
}

const closed = (repo: Repository, id: string): boolean => !user && isPrivateForAi(repo, id)

/** The database, if it is there and was not thrown away. */
function database(repo: Repository): Block | null {
  const block = repo.get(SKILLS_DATABASE_ID)
  return block && block.type === 'database' && block.trashedAt === null ? block : null
}

/** The database, made or put back when it is missing. For a write. */
export function ensureSkills(repo: Repository): Block {
  repo.transaction(() => {
    const existing = repo.get(SKILLS_DATABASE_ID)
    if (!existing) {
      repo.create({ id: SKILLS_DATABASE_ID, type: 'database', parentId: null, props: skillsDatabaseProps() })
      return
    }
    if (existing.trashedAt !== null) repo.restore(SKILLS_DATABASE_ID)
    if (existing.type !== 'database') return
    const current = existing.props.schema ?? {}
    const wanted = skillsDatabaseProps().schema ?? {}
    const missing = Object.values(wanted).filter((property) => current[property.id]?.type !== property.type)
    if (missing.length)
      repo.update(SKILLS_DATABASE_ID, { props: { schema: { ...current, ...Object.fromEntries(missing.map((p) => [p.id, p])) } } })
  })
  const block = database(repo)
  if (!block) throw new ToolError('The Skills block could not be set up.')
  if (closed(repo, block.id)) throw new ToolError(AI_PRIVATE_MESSAGE)
  return block
}

export interface StoredSkill {
  id: string
  name: string
  description: string
  updatedAt: number
}

/** The user's skills that can be read, newest first. A row with no title that makes a name is not a skill yet. */
export function storedSkills(repo: Repository): StoredSkill[] {
  const block = database(repo)
  if (!block || closed(repo, block.id)) return []
  const hidden = user ? () => false : privacyChecker(repo)
  const seen = new Set<string>()
  const out: StoredSkill[] = []
  const rows = (repo.children(block.id) as Block[]).filter((row) => row.type === 'page' && row.trashedAt === null)
  for (const row of rows.sort((a, b) => b.updatedAt - a.updatedAt)) {
    // The title is the name, however it was typed: "Fechar o mês" is the skill fechar-o-mes.
    const name = cleanSkillName(slugSkillName(plainText(row.props.title)))
    // Two rows of one name: the one changed last is the skill.
    if (!name || seen.has(name) || hidden(row.id)) continue
    seen.add(name)
    const values = (row.props.values ?? {}) as Record<string, PropertyValue>
    const description = Object.hasOwn(values, SKILL_PROPS.description) ? cleanSkillDescription(values[SKILL_PROPS.description]) : null
    out.push({ id: row.id, name, description: description ?? '', updatedAt: row.updatedAt })
  }
  return out
}

/** The user's skill of that name. */
export const storedSkill = (repo: Repository, name: string): StoredSkill | undefined =>
  storedSkills(repo).find((skill) => skill.name === name)
