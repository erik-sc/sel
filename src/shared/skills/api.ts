// What the Skills screen asks the main process (see ./index.ts). The shapes are what the
// renderer shows: nothing here is the app's internals.
import type { CommandSpec } from '../commands'
import type { InvokeChannels } from '../ipc'

export interface SkillView {
  name: string
  description: string
  /** One of sel's own: read-only. */
  builtIn: boolean
  /** The page the skill is, to open it. Null for a built-in one. */
  id: string | null
  /** When it last changed, in milliseconds. Null for a built-in one. */
  updatedAt: number | null
}

export interface SkillsApi {
  /** Every skill: the user's, newest first, then sel's own. */
  list(): Promise<SkillView[]>
  /** A skill whole, as the file other tools keep skills in (`SKILL.md`). */
  file(name: string): Promise<string>
  /** Makes a skill with that name and description, with nothing in it yet. Returns its page's id. */
  create(name: string, description: string): Promise<string>
  /** Changes a skill's description. */
  describe(name: string, description: string): Promise<void>
  /** Moves a skill to the trash. */
  remove(name: string): Promise<void>
}

/** The invoke channels of `api.skills` (see `INVOKE` in ../api.ts). */
export const SKILLS_INVOKE = {
  'skills:list': true,
  'skills:file': true,
  'skills:create': true,
  'skills:describe': true,
  'skills:remove': true
} as const satisfies Record<InvokeChannels<{ skills: SkillsApi }>, true>

/** The way to the screen (see ../commands.ts). */
export const SKILLS_COMMANDS = [
  {
    id: 'open-skills',
    menu: { submenu: 'view', label: 'Skills', order: 256 },
    palette: { title: 'Skills', keywords: ['skill', 'skills', 'habilidades', 'procedimentos', 'playbook', 'mcp', 'claude'], order: 114 }
  }
] as const satisfies readonly CommandSpec[]
