import { beforeEach, describe, expect, it } from 'vitest'
import { AI_PRIVATE_MESSAGE } from '../../shared/aiPrivate'
import { cleanSkillDescription, cleanSkillName, skillFile, SKILLS_DATABASE_ID, slugSkillName } from '../../shared/skills'
import { BUILT_IN_SKILLS } from '../../shared/skills/builtin'
import { ToolError } from '../ai/tools'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import * as markdown from '../markdown'
import { EXTERNAL_TOOL_SPECS } from '../tools/catalog'
import { createToolRunner } from '../tools/run'
import { asUser, storedSkills } from './store'
import { callSkillTool } from './tools'

describe('a skill as it is named and described', () => {
  it('has a name of lowercase words joined by hyphens', () => {
    expect(cleanSkillName(' Fechar-O-Mes ')).toBe('fechar-o-mes')
    for (const bad of ['fechar o mês', 'a--b', '-a', 'a-', '', 'x'.repeat(65), 7]) expect(cleanSkillName(bad), String(bad)).toBeNull()
    expect(slugSkillName('  Fechar o mês! ')).toBe('fechar-o-mes')
    expect(slugSkillName('Revisão / semanal (v2)')).toBe('revisao-semanal-v2')
    expect(slugSkillName('!!!')).toBe('')
    expect(cleanSkillName(slugSkillName(`${'a'.repeat(63)} b`))).not.toBeNull()
  })

  it('has a description of one line', () => {
    expect(cleanSkillDescription('  Fecha o mês.\n Use quando…  ')).toBe('Fecha o mês. Use quando…')
    expect(cleanSkillDescription('   ')).toBeNull()
    expect(cleanSkillDescription('x'.repeat(1025))).toBeNull()
  })

  it('is written out as a SKILL.md', () => {
    expect(skillFile({ name: 'fechar-o-mes', description: 'Fecha o mês: "tudo".', instructions: '\n# Fechar\n\n1. Revisar.\n\n' })).toBe(
      '---\nname: fechar-o-mes\ndescription: "Fecha o mês: \\"tudo\\"."\n---\n\n# Fechar\n\n1. Revisar.\n'
    )
  })
})

describe("sel's own skills", () => {
  it('have names, descriptions that say when to use them, and instructions', () => {
    const names = BUILT_IN_SKILLS.map((skill) => skill.name)
    expect(names).toEqual(['skill-creator', 'sel-tasks', 'sel-finances', 'sel-shared-bills'])
    for (const skill of BUILT_IN_SKILLS) {
      expect(cleanSkillName(skill.name)).toBe(skill.name)
      expect(cleanSkillDescription(skill.description)).toBe(skill.description)
      expect(skill.description).toMatch(/Use (when|before)/)
      expect(skill.instructions.startsWith('# ')).toBe(true)
    }
  })

  it('name only tools that exist', () => {
    const tools = new Set(EXTERNAL_TOOL_SPECS.map((spec) => spec.name))
    for (const skill of BUILT_IN_SKILLS) {
      const named = [...skill.instructions.matchAll(/`([a-z]+(?:_[a-z]+)+)`/gu)].map((match) => match[1])
      expect(named.length).toBeGreaterThan(0)
      // What reads like a tool's name and is not one: an argument, or a family of tools ("split_*").
      const known = new Set(['closing_day', 'due_day', 'as_of'])
      for (const name of named) expect(tools.has(name) || known.has(name), `${skill.name} names ${name}`).toBe(true)
    }
  })
})

describe('the skills tools', () => {
  let repo: Repository
  const call = (name: string, args: Record<string, unknown> = {}): string => callSkillTool({ repo, markdown }, name, args)
  const SKILL = {
    name: 'fechar-o-mes',
    description: 'Fecha o mês nas Finanças. Use quando o usuário disser "fechar o mês".',
    instructions: '# Fechar o mês\n\n1. Rodar `finance_review`.\n2. Pagar as faturas.\n\n## Regras\n\n- Nunca apagar sem perguntar.'
  }

  beforeEach(() => {
    repo = openTestRepository()
  })

  it('lists sel’s own without making anything, and says how to make the first', () => {
    const text = call('list_skills')
    expect(text).toContain('no skills of their own yet')
    expect(text).toContain('- skill-creator: ')
    expect(text).toContain('- sel-finances: ')
    expect(repo.get(SKILLS_DATABASE_ID)).toBeNull()
    expect(call('get_skill', { name: 'skill-creator' })).toMatch(
      /^---\nname: skill-creator\ndescription: ".+"\n---\n\n# Making a skill in sel/u
    )
    expect(repo.get(SKILLS_DATABASE_ID)).toBeNull()
  })

  it('saves a skill as a page of the Skills database and gives it back whole', () => {
    const saved = call('save_skill', SKILL)
    expect(saved).toContain('Saved the new skill fechar-o-mes')
    const database = repo.get(SKILLS_DATABASE_ID)
    expect(database).toMatchObject({ type: 'database', parentId: null })
    const [stored] = storedSkills(repo)
    expect(stored).toMatchObject({ name: 'fechar-o-mes', description: SKILL.description })
    expect(saved).toContain(`[${stored.id}]`)
    expect(repo.get(stored.id)?.parentId).toBe(SKILLS_DATABASE_ID)
    expect(call('list_skills')).toContain(`- fechar-o-mes: ${SKILL.description} [${stored.id}]`)
    const file = call('get_skill', { name: 'Fechar-o-Mes' })
    expect(file.startsWith(`---\nname: fechar-o-mes\ndescription: ${JSON.stringify(SKILL.description)}\n---\n\n# Fechar o mês`)).toBe(true)
    expect(file).toContain('1. Rodar `finance_review`.')
    expect(file).toContain('- Nunca apagar sem perguntar.')
  })

  it('saves over a skill in the same page, which keeps what it said', () => {
    call('save_skill', SKILL)
    const [before] = storedSkills(repo)
    const again = call('save_skill', { ...SKILL, description: 'Fecha o mês.', instructions: '# Fechar o mês\n\nSó revisar.' })
    expect(again).toContain('Saved over the skill fechar-o-mes')
    expect(again).toContain('history')
    const all = storedSkills(repo)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: before.id, description: 'Fecha o mês.' })
    const file = call('get_skill', { name: 'fechar-o-mes' })
    expect(file).toContain('Só revisar.')
    expect(file).not.toContain('Pagar as faturas')
  })

  it('checks everything before it touches the workspace', () => {
    for (const bad of [
      { ...SKILL, name: 'Fechar o mês' },
      { ...SKILL, description: '  ' },
      { ...SKILL, description: 'x'.repeat(2000) },
      { ...SKILL, instructions: '' },
      { ...SKILL, instructions: 'x'.repeat(100_001) },
      { ...SKILL, name: 'skill-creator' }
    ])
      expect(() => call('save_skill', bad)).toThrow(ToolError)
    expect(repo.get(SKILLS_DATABASE_ID)).toBeNull()
    expect(() => call('get_skill', { name: 'nope' })).toThrow(/no skill called nope/)
    expect(() => call('delete_skill', { name: 'sel-tasks' })).toThrow(/cannot be deleted/)
    expect(() => call('rename_skill', {})).toThrow(ToolError)
  })

  it('deletes to the trash, and a restored skill is back', () => {
    call('save_skill', SKILL)
    const [stored] = storedSkills(repo)
    expect(call('delete_skill', { name: 'fechar-o-mes' })).toContain(`[${stored.id}] to the trash`)
    expect(storedSkills(repo)).toEqual([])
    expect(() => call('get_skill', { name: 'fechar-o-mes' })).toThrow(ToolError)
    repo.restore(stored.id)
    expect(storedSkills(repo).map((skill) => skill.name)).toEqual(['fechar-o-mes'])
  })

  it('keeps a skill that is private from the AI to the user’s own window', () => {
    call('save_skill', SKILL)
    const [stored] = storedSkills(repo)
    repo.apply([{ op: 'update', id: stored.id, patch: { props: { aiPrivate: true } } }])
    expect(call('list_skills')).not.toContain('fechar-o-mes')
    expect(() => call('get_skill', { name: 'fechar-o-mes' })).toThrow(ToolError)
    expect(asUser(() => storedSkills(repo)).map((skill) => skill.name)).toEqual(['fechar-o-mes'])
    // The whole block closed: nothing of the user's is listed, and nothing is written into it.
    repo.apply([{ op: 'update', id: SKILLS_DATABASE_ID, patch: { props: { aiPrivate: true } } }])
    expect(call('list_skills')).toContain('no skills of their own yet')
    expect(() => call('save_skill', { ...SKILL, name: 'outra' })).toThrow(AI_PRIVATE_MESSAGE)
  })

  it('takes a row whose title is a name as a skill, however it was made', () => {
    call('save_skill', SKILL)
    // Written by hand in the page, as the screen's "New skill" leaves it: no description, no text yet.
    repo.create({ type: 'page', parentId: SKILLS_DATABASE_ID, props: { title: [['revisao-semanal']] } })
    // Renamed in its page, as one types: the name is what the title makes.
    repo.create({ type: 'page', parentId: SKILLS_DATABASE_ID, props: { title: [['Plano da Viagem!']] } })
    repo.create({ type: 'page', parentId: SKILLS_DATABASE_ID, props: { title: [['???']] } })
    repo.create({ type: 'page', parentId: SKILLS_DATABASE_ID, props: {} })
    expect(
      storedSkills(repo)
        .map((skill) => skill.name)
        .sort()
    ).toEqual(['fechar-o-mes', 'plano-da-viagem', 'revisao-semanal'])
    expect(call('list_skills')).toContain('- revisao-semanal: (no description yet)')
    expect(call('get_skill', { name: 'revisao-semanal' })).toBe('---\nname: revisao-semanal\ndescription: ""\n---\n\n\n')
  })

  it('is reached through the one runner of every block', () => {
    const run = createToolRunner(repo, markdown)
    expect(run('save_skill', SKILL)).toContain('Saved the new skill')
    expect(run('list_skills', {})).toContain('fechar-o-mes')
  })
})
