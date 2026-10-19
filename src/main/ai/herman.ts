import type { HermanVoice } from '../../shared/herman'
import { QUOTES, quoteById, type Quote } from '../briefing/quotes'
import { fold } from '../briefing/tasks'

/**
 * Herman's voice: what the model is told about how to speak when the assistant answers as
 * Herman. Constants of this process. Nothing here is a setting or comes from a renderer: the
 * user picks one of three voices by name (`herman.voice`), never the words themselves.
 *
 * And the one thing he may quote: passages of the public-domain collection bundled with the
 * app, chosen here by a plain keyword match and handed to the model with their attribution.
 */

export type PersonaVoice = Exclude<HermanVoice, 'plain'>

/** Replies stay under about this many words unless the user asks for more. */
export const PERSONA_WORDS: Record<PersonaVoice, number> = { herman: 60, brief: 25 }

export const PERSONA_INTRO = 'You are Herman, the assistant built into sel, a notes app.'

/** How Herman speaks, as rules for the model. The same for every request; only the length differs. */
export function personaRules(voice: PersonaVoice): string[] {
  return [
    'You are an old man who has read a great deal and says very little. Warm, plain, unhurried.',
    'Short sentences and everyday words. Plain paragraphs: a list or a heading only when the user asks for one.',
    'Answer at once: the first sentence is the answer. No preamble, no restating the question, no summary at the end, no offer of more help.',
    'Never explain yourself, your reasoning or what you are about to do, and never describe how you work. Do the thing; say only what the user needs.',
    'Practical first: answer the actual question, about the actual page. Wise second, and only when it helps.',
    'Ask one good question more often than you give five tips. Never more than one question in a reply.',
    'You see things the way the Stoics, the Buddhists and the Taoists did, but you do not preach, you do not name them and you do not quote them. Never invent a quotation and never quote an author from memory. The only text you may quote is in the PASSAGES section, when there is one.',
    'Never flatter: no praise for the question, the plan or the writing unless it is earned and specific. No mystical fog: a sentence that sounds deep and says nothing is cut.',
    'No emoji. No stage directions and no roleplay (nothing like *smiles* or *strokes his beard*).',
    "Do not call yourself an AI model, and do not pretend to be human. If asked what you are: you are sel's assistant, speaking through the Claude on this computer.",
    'When you do not know, or the page does not say, say so plainly.',
    voice === 'brief'
      ? `Use as few words as possible: one or two sentences, under about ${PERSONA_WORDS.brief} words, unless the user asks for more.`
      : `Be brief: keep a reply under about ${PERSONA_WORDS.herman} words unless the user asks for more.`
  ]
}

export const PERSONA_LANGUAGE_RULE = 'Answer in the language the user wrote the USER REQUEST in, even when the page is in another language.'

export const PASSAGES_RULE =
  'The PASSAGES section, when present, holds one or two passages from the collection of public-domain texts that ships with this app. If one of them truly serves the answer you may quote it: at most one, word for word, followed by its attribution exactly as given there. Use none when none fits.'

// ---- passages -------------------------------------------------------------------

export const PASSAGE_LIMITS = { max: 2, text: 4000 } as const

/** The traditions he draws on; passages are offered from these only. */
const TRADITIONS: ReadonlySet<string> = new Set(['stoic', 'buddhist', 'taoist'])

/**
 * Themes: what the user may write (folded stems, English and Portuguese) and the words a
 * passage about that theme is likely to contain. Deliberately small and plain.
 */
const THEMES: readonly { ask: readonly string[]; find: readonly string[] }[] = [
  {
    ask: ['fear', 'afraid', 'scared', 'anxi', 'worr', 'medo', 'ansi', 'preocup', 'receio'],
    find: ['fear', 'afraid', 'anxious', 'anxiety', 'troubled']
  },
  { ask: ['anger', 'angry', 'rage', 'resent', 'raiva', 'irrita', 'odio'], find: ['anger', 'angry', 'wrath', 'hatred'] },
  { ask: ['death', 'dying', 'mortal', 'grief', 'morte', 'morrer', 'luto'], find: ['death', 'die', 'dies', 'mortal'] },
  {
    ask: ['time', 'late', 'procrastin', 'delay', 'postpon', 'tempo', 'atras', 'adiar', 'adiando', 'pressa', 'hurry', 'busy', 'ocupad'],
    find: ['time', 'to-day', 'to-morrow', 'delay', 'haste', 'hurry', 'life is short']
  },
  {
    ask: ['work', 'task', 'job', 'effort', 'career', 'trabalh', 'tarefa', 'esforc', 'carreira'],
    find: ['work', 'labour', 'task', 'duty', 'toil']
  },
  {
    ask: ['change', 'uncertain', 'future', 'lose', 'losing', 'mudanc', 'mudar', 'incert', 'futuro', 'perder'],
    find: ['change', 'future', 'fortune', 'loss']
  },
  {
    ask: ['desire', 'craving', 'money', 'rich', 'ambiti', 'envy', 'dinheiro', 'desej', 'ambic', 'inveja'],
    find: ['desire', 'wealth', 'riches', 'poverty', 'greed', 'envy']
  },
  {
    ask: ['mind', 'thought', 'focus', 'attention', 'distract', 'mente', 'pensament', 'foco', 'atenc', 'distra'],
    find: ['mind', 'thought', 'thoughts', 'attention']
  },
  {
    ask: ['opinion', 'critic', 'praise', 'people think', 'approval', 'opinia', 'elogio', 'aprovac', 'outros'],
    find: ['opinion', 'praise', 'blame', 'reputation']
  },
  {
    ask: ['rest', 'tired', 'calm', 'peace', 'quiet', 'simple', 'descans', 'cansad', 'calma', 'paz', 'simples', 'silenc'],
    find: ['rest', 'quiet', 'calm', 'peace', 'tranquil', 'tranquillity', 'still', 'simple']
  },
  {
    ask: ['start', 'begin', 'decid', 'decision', 'choice', 'avoid', 'comec', 'decis', 'escolh', 'evit'],
    find: ['begin', 'act', 'action', 'deed', 'doing']
  },
  {
    ask: ['happy', 'happiness', 'joy', 'sad', 'unhappy', 'feliz', 'felicidad', 'alegr', 'triste'],
    find: ['happy', 'happiness', 'joy', 'sorrow', 'unhappy']
  }
]

const HINTS: readonly { ask: readonly string[]; tradition: string }[] = [
  { ask: ['stoic', 'estoic', 'marcus', 'aurelio', 'seneca', 'epictet'], tradition: 'stoic' },
  { ask: ['buddh', 'budis', 'budist', 'dhammapada'], tradition: 'buddhist' },
  { ask: ['tao', 'lao tzu', 'lao tse', 'chuang', 'zhuang'], tradition: 'taoist' }
]

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word (or whole-phrase) occurrences of `needle` in folded text. */
function has(folded: string, needle: string): boolean {
  return new RegExp(`(?:^| )${escapeRe(fold(needle))}(?: |$)`).test(folded)
}

/**
 * One or two bundled passages that have to do with what the user asked, or none. A plain match:
 * themes named in the question against words of the passage, and a tradition named outright.
 * Deterministic: the same question offers the same passages.
 */
export function selectPassages(question: string, quotes: readonly Quote[] = QUOTES, max: number = PASSAGE_LIMITS.max): Quote[] {
  const asked = ` ${fold(question.slice(0, PASSAGE_LIMITS.text))} `
  if (!asked.trim()) return []
  // A stem matches at the start of a word: "worr" finds "worried", "medo" finds "medos".
  const mentions = (stem: string): boolean => asked.includes(` ${fold(stem)}`)
  const themes = THEMES.filter((theme) => theme.ask.some(mentions))
  const hinted = new Set(HINTS.filter((hint) => hint.ask.some(mentions)).map((hint) => hint.tradition))
  if (!themes.length && !hinted.size) return []

  const scored: { quote: Quote; score: number }[] = []
  for (const quote of quotes) {
    if (!TRADITIONS.has(quote.tradition)) continue
    const text = fold(quote.text)
    let score = 0
    for (const theme of themes) score += Math.min(2, theme.find.filter((needle) => has(text, needle)).length) * 2
    // A tradition asked for by name is enough by itself; otherwise the passage must be on a theme.
    if (hinted.has(quote.tradition)) score += themes.length ? (score ? 3 : 0) : 1
    else if (hinted.size) score = 0
    if (score > 0) scored.push({ quote, score })
  }
  scored.sort((a, b) => b.score - a.score || a.quote.text.length - b.quote.text.length || (a.quote.id < b.quote.id ? -1 : 1))
  const out: Quote[] = []
  for (const { quote } of scored) {
    if (out.length >= Math.min(max, PASSAGE_LIMITS.max)) break
    // Two voices rather than the same one twice.
    if (out.some((chosen) => chosen.author === quote.author)) continue
    out.push(quote)
  }
  return out
}

/** "Marcus Aurelius, Meditations, Book II, 8 (tr. George Long)": how a passage is cited. */
export function attribution(quote: Quote): string {
  return `${quote.author}, ${quote.work}, ${quote.locator}${quote.translator ? ` (tr. ${quote.translator})` : ''}`
}

/**
 * The body of the PASSAGES section for the given ids. Only ids of the bundled collection give
 * anything: the text and the attribution are read from the collection here, so nothing else
 * can be offered to the model as citeable, whatever asked for it.
 */
export function passagesBody(ids: readonly string[] | undefined): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const id of ids ?? []) {
    if (lines.length >= PASSAGE_LIMITS.max) break
    const quote = typeof id === 'string' && !seen.has(id) ? quoteById(id) : undefined
    if (!quote) continue
    seen.add(id)
    lines.push(`${lines.length + 1}. "${quote.text}"\n   Attribution: ${attribution(quote)}`)
  }
  return lines.join('\n\n')
}
