/**
 * The words of the app that name the assistant, for the persona chosen in Settings → Herman
 * (`herman.persona`, shared/herman.ts). The copy is written once, in Herman's words: "Herman",
 * "he", "him", "o Herman", "ao Herman". `personify` rewrites it for Hermine ("Hermine", "she",
 * "her", "a Hermine", "à Hermine"); for Herman it gives the text back untouched.
 *
 * Only text that speaks of the assistant goes through it: copy tables and labels about him, never
 * what the user wrote. The rules are few and whole-word, and a test runs them over every string
 * of the app that names him (renderer/src/herman/persona.test.ts), so a sentence they would get wrong
 * shows up there.
 * Pure: no React, no DOM, no Electron.
 */
import { PERSONA_NAMES, PERSONAS, type PersonaId } from './herman'

/** The languages the app's copy is written in. */
export type PersonaLocale = 'en' | 'pt-BR'

/** A whole word (or phrase): not inside another word. */
const word = (text: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])${text}(?![\\p{L}\\p{N}_])`, 'gu')

/**
 * Herman's words → Hermine's, in order: the phrases first, then the name, then the pronouns. In
 * English "he", "him" and "his" in the app's copy are always the assistant; in Portuguese "ele" and
 * "dele" are as often the briefing or the day, so they change only in a text that names him.
 */
const HERMINE_RULES: Record<PersonaLocale, readonly (readonly [RegExp, string])[]> = {
  en: [
    [word('an old man'), 'a young woman'],
    [word('Herman'), 'Hermine'],
    [word('himself'), 'herself'],
    [word('him'), 'her'],
    [word('his'), 'her'],
    [word('His'), 'Her'],
    [word('he'), 'she'],
    [word('He'), 'She']
  ],
  'pt-BR': [
    [word('um velho'), 'uma jovem'],
    [word('pelo Herman'), 'pela Hermine'],
    [word('Pelo Herman'), 'Pela Hermine'],
    [word('ao Herman'), 'à Hermine'],
    [word('Ao Herman'), 'À Hermine'],
    [word('do Herman'), 'da Hermine'],
    [word('no Herman'), 'na Hermine'],
    [word('o Herman'), 'a Hermine'],
    [word('O Herman'), 'A Hermine'],
    [word('Herman'), 'Hermine']
  ]
}
const NAMED_PT_RULES: readonly (readonly [RegExp, string])[] = [
  [word('dele'), 'dela'],
  [word('ele'), 'ela'],
  [word('Ele'), 'Ela']
]

/** A stored `herman.persona`, or Herman when nothing valid is stored. */
export function personaOf(stored: unknown): PersonaId {
  return typeof stored === 'string' && (PERSONAS as readonly string[]).includes(stored) ? (stored as PersonaId) : 'herman'
}

/** The persona's name: "Herman" or "Hermine". */
export function personaName(persona: PersonaId): string {
  return PERSONA_NAMES[persona]
}

/** Text written in Herman's words, said of the chosen persona. */
export function personify(text: string, persona: PersonaId, locale: PersonaLocale = 'en'): string {
  if (persona === 'herman') return text
  const pt = locale === 'pt-BR'
  let out = text
  for (const [pattern, replacement] of HERMINE_RULES[pt ? 'pt-BR' : 'en']) out = out.replace(pattern, replacement)
  if (pt && out !== text) for (const [pattern, replacement] of NAMED_PT_RULES) out = out.replace(pattern, replacement)
  return out
}

/**
 * A copy table (strings, lists, records, and functions that return strings) with every string said
 * of the chosen persona. Herman's table is returned as it is.
 */
export function personifyCopy<T>(copy: T, persona: PersonaId, locale: PersonaLocale = 'en'): T {
  if (persona === 'herman') return copy
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return personify(value, persona, locale)
    if (typeof value === 'function') return (...args: unknown[]) => walk((value as (...a: unknown[]) => unknown)(...args))
    if (Array.isArray(value)) return value.map(walk)
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, walk(item)]))
    return value
  }
  return walk(copy) as T
}
