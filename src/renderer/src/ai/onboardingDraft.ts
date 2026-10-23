// What the persona's introduction (0.8.0 A1) builds without AI: the context drafted from the
// answers to its questions, merged into what is already written (never over it), the projects of
// Tasks it suggests, and the pages it offers to pin. Pure: no React, no DOM.
import { AI_CONTEXT_CAPS } from '@shared/aiContext'
import { privateProjects } from '@shared/aiPrivate'
import { isPlainObject, optionsOf, propOf } from '@shared/database/values'
import { TASK_PROPS } from '@shared/tasks'
import type { Block } from '@shared/types'
import type { HomeLocale } from '@/home/copy'

export type AnswerLength = 'short' | 'detailed' | null
export type AnswerLanguage = 'same' | 'pt-BR' | 'en' | null
export type AnswerTone = 'direct' | 'warm' | 'formal' | null

/** The answers to the persona's questions; every one may stay empty. */
export interface ContextAnswers {
  who: string
  work: string
  /** Names of projects ticked among those of Tasks. */
  projects: string[]
  /** Other projects, written in. */
  otherProjects: string
  length: AnswerLength
  language: AnswerLanguage
  tone: AnswerTone
}

export const EMPTY_ANSWERS: ContextAnswers = {
  who: '',
  work: '',
  projects: [],
  otherProjects: '',
  length: null,
  language: null,
  tone: null
}

const WORDS: Record<
  HomeLocale,
  {
    who: string
    work: string
    projects: string
    answers: string
    length: Record<'short' | 'detailed', string>
    language: Record<'same' | 'pt-BR' | 'en', string>
    tone: Record<'direct' | 'warm' | 'formal', string>
  }
> = {
  en: {
    who: 'About me',
    work: 'My work',
    projects: 'My projects',
    answers: 'How I like answers',
    length: { short: 'short and to the point', detailed: 'detailed, with the reasoning' },
    language: { same: 'in the language I write in', 'pt-BR': 'in Portuguese (Brazil)', en: 'in English' },
    tone: { direct: 'in a direct tone', warm: 'in a warm tone', formal: 'in a formal tone' }
  },
  'pt-BR': {
    who: 'Sobre mim',
    work: 'Meu trabalho',
    projects: 'Meus projetos',
    answers: 'Como gosto das respostas',
    length: { short: 'curtas e objetivas', detailed: 'detalhadas, com o raciocínio' },
    language: { same: 'no idioma em que eu escrever', 'pt-BR': 'em português', en: 'em inglês' },
    tone: { direct: 'num tom direto', warm: 'num tom caloroso', formal: 'num tom formal' }
  }
}

/** One line of text, tidied, ending with a full stop unless it already ends a sentence. */
function sentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return ''
  return /[.!?…:;)"”]$/.test(line) ? line : `${line}.`
}

/** The projects named, ticked first, then those written in (split on commas), each once. */
export function projectList(answers: Pick<ContextAnswers, 'projects' | 'otherProjects'>): string[] {
  const out: string[] = []
  for (const name of [...answers.projects, ...answers.otherProjects.split(/[,;\n]/)]) {
    const clean = name.replace(/\s+/g, ' ').trim()
    if (clean && !out.some((kept) => kept.toLowerCase() === clean.toLowerCase())) out.push(clean)
  }
  return out
}

/**
 * The context the answers make, one line per question answered, in the language of the screen:
 * "About me: Ana, product designer." … "How I like answers: short and to the point, in English."
 * Empty when nothing was answered.
 */
export function composeContext(answers: ContextAnswers, locale: HomeLocale): string {
  const words = WORDS[locale]
  const lines: string[] = []
  const who = sentence(answers.who)
  if (who) lines.push(`${words.who}: ${who}`)
  const work = sentence(answers.work)
  if (work) lines.push(`${words.work}: ${work}`)
  const projects = projectList(answers)
  if (projects.length) lines.push(`${words.projects}: ${projects.join(', ')}.`)
  const how = [
    answers.length ? words.length[answers.length] : '',
    answers.language ? words.language[answers.language] : '',
    answers.tone ? words.tone[answers.tone] : ''
  ].filter(Boolean)
  if (how.length) lines.push(`${words.answers}: ${how.join(', ')}.`)
  return lines.join('\n')
}

/**
 * The context to save: what was there, then the draft after a blank line. What was written stays
 * as it is; a draft it already holds adds nothing. `fits` is false when both together pass the cap.
 */
export function mergeContext(
  existing: string,
  draft: string,
  cap: number = AI_CONTEXT_CAPS.text
): { text: string; fits: boolean; changed: boolean } {
  const before = existing.replace(/\s+$/, '')
  const add = draft.trim()
  if (!add || before.includes(add)) return { text: existing, fits: existing.length <= cap, changed: false }
  const text = before.trim() ? `${before}\n\n${add}` : add
  return { text, fits: text.length <= cap, changed: true }
}

/** The projects of Tasks to suggest, by name, leaving out those private from the AI. */
export function suggestedProjects(tasksDatabase: Pick<Block, 'props'> | null | undefined): string[] {
  if (!tasksDatabase) return []
  const schema = isPlainObject(tasksDatabase.props.schema) ? tasksDatabase.props.schema : undefined
  const hidden = privateProjects(tasksDatabase)
  const out: string[] = []
  for (const option of optionsOf(propOf(schema, TASK_PROPS.project))) {
    const name = typeof option?.name === 'string' ? option.name.trim() : ''
    if (name && option && !hidden.includes(option.id) && !out.includes(name)) out.push(name)
  }
  return out.slice(0, 12)
}

/**
 * The pages to offer for pinning: those you come back to most (the activity log's `returning`),
 * then the ones edited last, each once, private ones left out.
 */
export function rankPages(
  returning: readonly { pageId: string; days: number; opens: number }[],
  recent: readonly string[],
  isPrivate: (id: string) => boolean,
  limit = 6
): string[] {
  const ordered = [...returning].sort((a, b) => b.days - a.days || b.opens - a.opens).map((entry) => entry.pageId)
  const out: string[] = []
  for (const id of [...ordered, ...recent]) {
    if (out.length >= limit) break
    if (!out.includes(id) && !isPrivate(id)) out.push(id)
  }
  return out
}
