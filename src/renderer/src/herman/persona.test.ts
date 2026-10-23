/// <reference types="node" />
// With Hermine chosen, no screen still says "Herman" (or "he", "him", "his", "o Herman"): every copy
// table that names the assistant, and every string of the window's code that does, is said of her.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AI_COMMANDS } from '@shared/ai'
import { HERMAN_VOICE_LABELS } from '@shared/herman'
import { personaOf, personify, personifyCopy, type PersonaLocale } from '@shared/persona'
import { alarmsCopy } from '@/alarms/copy'
import { balloonCopy } from '@/ai/balloonCopy'
import { CONTEXT_COPY, contextCopy } from '@/ai/contextCopy'
import { memoryCopy } from '@/ai/memoryCopy'
import { ONBOARDING_COPY, onboardingCopy } from '@/ai/onboardingCopy'
import { SHORTCUT_GROUPS } from '@/shortcuts/catalog'
import { personaTitle, useHerman } from './gate'

const LOCALES: PersonaLocale[] = ['en', 'pt-BR']
/** What must not be left in her copy: his name, and the words that make the assistant a man. */
const HIS: Record<PersonaLocale, RegExp> = {
  en: /\bHerman\b|\b(he|He|him|his|His|himself)\b|old man/,
  'pt-BR': /\bHerman\b|\bum velho\b/
}

/** Every string in a copy table, functions called with sample arguments. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'function') {
    // Called with numbers: every function of these tables takes counts, or text it only interpolates.
    const fn = value as (...args: unknown[]) => unknown
    return strings(fn(2, 2, 2, 2))
  }
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

const root = fileURLToPath(new URL('..', import.meta.url))
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}
/** The quoted strings and the JSX text of a source file that name Herman, comments left out. */
function namingHerman(code: string): string[] {
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found = [
    ...bare.matchAll(/'((?:[^'\\\n]|\\.)*)'/g),
    ...bare.matchAll(/"((?:[^"\\\n]|\\.)*)"/g),
    ...bare.matchAll(/`((?:[^`\\]|\\.)*)`/g),
    ...bare.matchAll(/>([^<>{}]*)</g)
  ].map((match) => match[1])
  return found.filter((text) => /\bHerman\b/.test(text))
}

/**
 * The window's files whose strings name Herman, each of which says them through the persona
 * (`usePersona`, `personaTitle`, `personifyCopy`). A new one fails here until it does too.
 */
const SAID_OF_THE_PERSONA = [
  'ai/applyActions.ts',
  'ai/balloonCopy.ts',
  'ai/contextCopy.ts',
  'ai/memoryCopy.ts',
  'ai/onboardingCopy.ts',
  'alarms/AlarmSettings.tsx',
  'alarms/copy.ts',
  'herman/HermanSettings.tsx',
  'herman/gate.ts',
  'herman/settingsSection.ts',
  'shortcuts/catalog.ts'
]

describe('the copy, with Hermine chosen', () => {
  it('is the same with Herman chosen', () => {
    for (const locale of LOCALES) {
      expect(contextCopy(locale, 'herman')).toBe(CONTEXT_COPY[locale])
      expect(personify('Ask Herman; he will answer.', 'herman', locale)).toBe('Ask Herman; he will answer.')
    }
  })

  it('names her, and calls her she, in every table that speaks of the assistant', () => {
    for (const locale of LOCALES) {
      const tables = [
        contextCopy(locale, 'hermine'),
        alarmsCopy(locale, 'hermine'),
        balloonCopy(locale, 'hermine'),
        memoryCopy(locale, 'hermine'),
        onboardingCopy(locale, 'hermine'),
        personifyCopy(HERMAN_VOICE_LABELS, 'hermine', locale)
      ]
      for (const text of tables.flatMap(strings)) expect(text, text).not.toMatch(HIS[locale])
    }
    expect(balloonCopy('en', 'hermine').placeholder.persona).toBe('Ask Hermine…')
    expect(balloonCopy('pt-BR', 'hermine').placeholder.persona).toBe('Pergunte à Hermine…')
    expect(alarmsCopy('pt-BR', 'hermine').refineHerman).toBe('Pela Hermine')
    expect(alarmsCopy('pt-BR', 'hermine').refineHermanHelp).toContain('a Hermine oferece refinar')
    expect(contextCopy('pt-BR', 'hermine').allWarning).toBe(
      'A Hermine pode mudar coisas neste serviço quando você pedir. Ela sempre diz o que mudou.'
    )
    expect(contextCopy('pt-BR', 'hermine').contextHelp).toMatch(/^Vai junto em toda pergunta à Hermine/)
    // The introduction is said by the persona; its line about the other one names the other one.
    expect(onboardingCopy('pt-BR', 'hermine').say.claude).toMatch(/^Olá, eu sou a Hermine\./)
    expect(onboardingCopy('en', 'hermine').title).toBe('Meet Hermine')
    expect(ONBOARDING_COPY['pt-BR'].say.persona('Herman')).toMatch(/comigo ou com o Herman\?/)
    expect(ONBOARDING_COPY['pt-BR'].say.persona('Hermine')).toMatch(/comigo ou com a Hermine\?/)
    expect(memoryCopy('pt-BR', 'hermine').intro).toMatch(/^O que a Hermine guarda/)
    expect(contextCopy('en', 'hermine').allWarning).toBe(
      'Hermine may change things in this service when you ask her to. She still says what she changed.'
    )
  })

  it('names her in the commands and the shortcuts', () => {
    useHerman.setState({ persona: 'hermine' })
    try {
      for (const spec of AI_COMMANDS) {
        expect(personaTitle(spec.palette.title)).toBe('Hermine, the assistant')
        expect(personaTitle(spec.catalog.label)).toBe('Talk to Hermine, the assistant')
      }
      const group = SHORTCUT_GROUPS.find((candidate) => candidate.id === 'herman')
      for (const text of [group?.title ?? '', ...(group?.entries.map((entry) => entry.label) ?? [])])
        expect(personify(text, 'hermine'), text).not.toMatch(HIS.en)
      expect(personaTitle('Settings: Herman')).toBe('Settings: Hermine')
      expect(personaTitle('Settings: Appearance')).toBe('Settings: Appearance')
    } finally {
      useHerman.setState({ persona: 'herman' })
    }
  })

  // It reads every source file of the window: slow on a cold disk, hence its own timeout.
  it('leaves no string of the window that names Herman outside the persona, nor one that it would get wrong', () => {
    const naming = sources(root)
      .map((path) => ({ file: relative(root, path).replaceAll('\\', '/'), texts: namingHerman(readFileSync(path, 'utf8')) }))
      .filter(({ texts }) => texts.length > 0)
    expect(naming.map(({ file }) => file).sort()).toEqual(SAID_OF_THE_PERSONA)
    // A text that names both is the choice between them (Settings → Persona): it says "Herman" for either.
    for (const { texts } of naming)
      for (const text of texts.filter((candidate) => !candidate.includes('Hermine'))) {
        const locale: PersonaLocale = /\b(o|ao|do|no|pelo|Pelo) Herman\b|ção|ê/.test(text) ? 'pt-BR' : 'en'
        expect(personify(text, 'hermine', locale), text).not.toMatch(HIS[locale])
      }
  }, 30_000)
})

describe('the persona setting', () => {
  it('is Herman unless Hermine is stored', () => {
    expect(personaOf('hermine')).toBe('hermine')
    expect(personaOf('herman')).toBe('herman')
    for (const stored of [null, undefined, '', 'Hermione', 'HERMINE', 1, { persona: 'hermine' }]) expect(personaOf(stored)).toBe('herman')
  })

  it('rewrites whole words only', () => {
    expect(personify('Herman64 and Hermann, the theme, these, hiss, ship', 'hermine')).toBe(
      'Herman64 and Hermann, the theme, these, hiss, ship'
    )
    expect(personify('Tell him his name; he is Herman. He knows.', 'hermine')).toBe('Tell her her name; she is Hermine. She knows.')
    expect(personify('Perguntar ao Herman, do Herman, no Herman, pelo Herman. Ele diz.', 'hermine', 'pt-BR')).toBe(
      'Perguntar à Hermine, da Hermine, na Hermine, pela Hermine. Ela diz.'
    )
    // In Portuguese "ele" is as often the briefing: it changes only where the text names him.
    expect(personify('O briefing, nos horários dele, diz quantas tarefas esperam.', 'hermine', 'pt-BR')).toBe(
      'O briefing, nos horários dele, diz quantas tarefas esperam.'
    )
  })
})
