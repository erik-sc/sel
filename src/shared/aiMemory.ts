/**
 * The persona's memory (0.8.0 A3): short, durable facts about the user and their work that the
 * persona picks out of a finished conversation by itself ("the Auxiliadora project is for bank
 * X", "prefers short answers"), keeps without asking, and hands to every later request as a
 * fenced MEMORY section. Settings → AI → Memory lists them: edit, delete one, delete all, and a
 * switch that stops both the keeping and the sending at once.
 *
 * Kept on this device only (`ai.memory`, written by the main process alone; never synced). Never
 * from a conversation about a page private from the AI, and never a secret: `findSecret` turns a
 * fact away before it is stored (passwords, tokens, keys, document and card numbers).
 *
 * Pure: no Electron, Node or React. Both sides and the tests import it.
 */
import type { AiTurn } from './ai'

/** The facts, written by main only. */
export const AI_MEMORY_KEY = 'ai.memory'
/** The switch in Settings → AI → Memory; on unless turned off. */
export const AI_MEMORY_ENABLED_KEY = 'ai.memoryEnabled'

export const AI_MEMORY_CAPS = {
  /** Facts kept; past it, the least used and then the oldest go first. */
  facts: 50,
  /** Characters of one fact. */
  text: 200,
  /** Facts one conversation turn may add. */
  perTurn: 3,
  /** Characters of all the facts that go into one prompt. */
  promptChars: 2400,
  /** Characters of the exchange read to pick facts out of. */
  question: 4000,
  answer: 6000,
  history: 6000
} as const

/** One remembered fact. */
export interface MemoryFact {
  id: string
  text: string
  /** When it was remembered (or last edited). */
  at: number
  /** The conversation it came from; null when the user wrote it. */
  source: string | null
  /** How many requests it went along with. */
  uses: number
}

export function memoryEnabled(stored: unknown): boolean {
  return stored !== false
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A fact's text as kept: one line, spaces tidied. Empty when nothing is left. */
export function tidyFact(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The stored facts, cleaned: the known shape, no secret, within the caps. */
export function cleanMemory(value: unknown): MemoryFact[] {
  if (!Array.isArray(value)) return []
  const out: MemoryFact[] = []
  for (const raw of value) {
    if (!isObject(raw)) continue
    const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null
    const text = typeof raw.text === 'string' ? tidyFact(raw.text) : ''
    if (!id || !text || text.length > AI_MEMORY_CAPS.text || findSecret(text) || out.some((fact) => fact.id === id)) continue
    const at = typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at >= 0 ? raw.at : 0
    const uses = typeof raw.uses === 'number' && Number.isFinite(raw.uses) && raw.uses >= 0 ? Math.floor(raw.uses) : 0
    const source = typeof raw.source === 'string' && ID_RE.test(raw.source) ? raw.source : null
    out.push({ id, text, at, source, uses })
  }
  return out.slice(-AI_MEMORY_CAPS.facts)
}

// ---- secrets ------------------------------------------------------------------------

/** Why a text is turned away, by kind; null when it holds nothing that looks secret. */
export type SecretKind = 'password' | 'token' | 'key' | 'document' | 'card' | 'number'

/** Words that name a secret: a fact that mentions one is not kept, whatever follows. */
const SECRET_WORDS =
  /\b(pass(?:word|wd|phrase|code)s?|senhas?|pwd|pin\s+(?:code|number)|c[oó]digo\s+de\s+(?:acesso|seguran[cç]a)|credenciais|credentials?|private\s+key|secret\s+key|chave\s+(?:privada|secreta|de\s+api|da\s+api)|api[\s_-]?keys?|access[\s_-]?keys?|bearer|otp|cvv|cvc)\b/i

/** Words that are a secret only with a value after them ("token: …", "o PIN é …"). */
const SECRET_LABELS = /\b(tokens?|secret|segredo|pin|c[oó]digo)(?:\s*[:=]|\s+(?:is|é|was|era)\s)\s*\S/i

/** Words that name a document, flagged when digits come with them. */
const DOCUMENT_WORDS =
  /\b(cpf|cnpj|rg|cnh|ssn|social\s+security|passport|passaporte|t[ií]tulo\s+de\s+eleitor|pis|nis|document(?:o)?\s+(?:number|n[uú]mero)|n[uú]mero\s+do\s+documento|iban|account\s+number|n[uú]mero\s+da\s+conta|ag[eê]ncia|routing)\b/i

/** Shapes of keys and tokens that are recognisable on their own. */
const TOKEN_SHAPES: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/, // OpenAI / Anthropic / Stripe-like
  /\bsk-ant-[A-Za-z0-9_-]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // a JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[a-f0-9]{32,}\b/i // a long hex secret or hash
]

/** Brazilian CPF and CNPJ, a US SSN, an IBAN: document shapes recognisable without a word. */
const DOCUMENT_SHAPES: readonly RegExp[] = [
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/
]

/** Whether a run of digits passes the Luhn check (card numbers do). */
function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let digit = digits.charCodeAt(digits.length - 1 - i) - 48
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

/**
 * What in `text` looks like a secret, or null. Made to fail closed: a fact it doubts is not kept.
 * Turned away: a word for a password, token, key or credential; a recognisable key or token; a
 * long mixed string of letters and digits; a card number (13–19 digits); a document number (CPF,
 * CNPJ, SSN, IBAN, or a document's name with digits); and any other run of 9 digits or more.
 */
export function findSecret(text: string): SecretKind | null {
  const word = SECRET_WORDS.exec(text)?.[0] ?? SECRET_LABELS.exec(text)?.[0]
  if (word) return /pass|senha|pwd|pin|c[oó]digo/i.test(word) ? 'password' : 'key'
  if (TOKEN_SHAPES.some((shape) => shape.test(text))) return 'token'
  if (DOCUMENT_SHAPES.some((shape) => shape.test(text))) return 'document'
  if (DOCUMENT_WORDS.test(text) && /\d{4,}/.test(text.replace(/[\s.\-/]/g, ''))) return 'document'
  // Runs of digits, read across the spaces, dots and dashes that group them.
  for (const match of text.matchAll(/\d[\d .-]{7,}\d/g)) {
    const digits = match[0].replace(/\D/g, '')
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return 'card'
    if (digits.length >= 9) return 'number'
  }
  // A long word mixing letters and digits (and maybe _ or -) is how keys and tokens look.
  for (const match of text.matchAll(/[A-Za-z0-9_+/=-]{20,}/g)) {
    const word = match[0]
    if (/[A-Za-z]/.test(word) && /\d/.test(word) && !/^[a-z]+(?:-[a-z]+)+$/i.test(word)) return 'token'
  }
  return null
}

// ---- picking facts out of a conversation ----------------------------------------------

/** One finished turn of the balloon, as the main process is asked to remember from it. */
export interface MemoryInput {
  conversationId: string
  messageId: number
  question: string
  answer: string
  history: AiTurn[]
  /** The pages the conversation is about: the request's page and the tab's route. */
  pageIds: string[]
}

/** The request as the window may send it, cleaned; null when it is not one. */
export function cleanMemoryInput(value: unknown): MemoryInput | null {
  if (!isObject(value)) return null
  const conversationId = typeof value.conversationId === 'string' && ID_RE.test(value.conversationId) ? value.conversationId : null
  const messageId =
    typeof value.messageId === 'number' && Number.isInteger(value.messageId) && value.messageId >= 0 ? value.messageId : null
  if (!conversationId || messageId === null || typeof value.question !== 'string' || typeof value.answer !== 'string') return null
  const history: AiTurn[] = []
  if (Array.isArray(value.history))
    for (const turn of value.history.slice(-20))
      if (isObject(turn) && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string')
        history.push({ role: turn.role, text: turn.text.slice(0, 8000) })
  const pageIds = Array.isArray(value.pageIds)
    ? value.pageIds.filter((id): id is string => typeof id === 'string' && ID_RE.test(id)).slice(0, 4)
    : []
  return {
    conversationId,
    messageId,
    question: value.question.slice(0, AI_MEMORY_CAPS.question),
    answer: value.answer.slice(0, AI_MEMORY_CAPS.answer),
    history,
    pageIds
  }
}

/** Words by which people speak of themselves, their work and how they like things. */
const SELF =
  /(?<![\p{L}\p{N}_])(i|i'm|i've|i'd|i'll|my|mine|myself|we|we're|our|ours|eu|meu|minha|meus|minhas|nós|nosso|nossa|nossos|nossas|comigo|prefiro|preferimos|trabalho|trabalhamos|sou|somos|estou|gosto|uso|usamos|prefer|prefers)(?![\p{L}\p{N}_])/iu

/**
 * Whether a turn is worth the small extra request: the user said something about themselves or
 * their work (or wrote at length), and a real answer came back. A short command ("summarize this")
 * teaches nothing durable.
 */
export function worthRemembering(input: Pick<MemoryInput, 'question' | 'answer'>): boolean {
  const question = input.question.trim()
  const answer = input.answer.trim()
  if (answer.length < 40) return false
  const words = question.split(/\s+/).filter(Boolean).length
  if (question.length < 20 || words < 4) return false
  return question.length >= 160 || SELF.test(question)
}

/**
 * The facts in the model's reply: strict JSON, `{"facts": ["…", …]}`, alone (a code fence around
 * it is tolerated). Anything else gives none. At most `AI_MEMORY_CAPS.perTurn`; a fact longer than
 * the cap, empty, or holding something that looks secret is dropped, not cut.
 */
export function parseMemoryReply(text: string): string[] {
  let body = text.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(body)
  if (fenced) body = fenced[1].trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return []
  }
  if (!isObject(parsed) || !Array.isArray(parsed.facts)) return []
  const out: string[] = []
  for (const raw of parsed.facts) {
    if (typeof raw !== 'string') continue
    const fact = tidyFact(raw)
    if (!fact || fact.length > AI_MEMORY_CAPS.text || findSecret(fact)) continue
    if (out.some((kept) => sameFact(kept, fact))) continue
    out.push(fact)
    if (out.length === AI_MEMORY_CAPS.perTurn) break
  }
  return out
}

/** Two facts that say the same thing, written alike (case, accents and punctuation aside). */
export function sameFact(a: string, b: string): boolean {
  const norm = (text: string): string =>
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  return norm(a) === norm(b)
}

// ---- keeping them -------------------------------------------------------------------

/** Which fact goes first when there are too many: the least used, then the oldest. */
function evictionOrder(a: MemoryFact, b: MemoryFact): number {
  return a.uses - b.uses || a.at - b.at
}

/**
 * The list with `texts` added (those it does not already hold), within the cap: past it, the
 * least used and then the oldest facts go. Returns the facts that were added and stayed.
 */
export function addFacts(
  list: readonly MemoryFact[],
  texts: readonly string[],
  options: { source: string | null; now: number; newId: () => string }
): { list: MemoryFact[]; added: MemoryFact[] } {
  const next = [...list]
  const added: MemoryFact[] = []
  for (const raw of texts) {
    const text = tidyFact(raw)
    if (!text || text.length > AI_MEMORY_CAPS.text || findSecret(text)) continue
    if (next.some((fact) => sameFact(fact.text, text))) continue
    const fact: MemoryFact = { id: options.newId(), text, at: options.now, source: options.source, uses: 0 }
    next.push(fact)
    added.push(fact)
  }
  while (next.length > AI_MEMORY_CAPS.facts) {
    // The newcomers of this turn stay: what goes is the least used of what was there before.
    const candidates = next.filter((fact) => !added.includes(fact))
    const pool = candidates.length ? candidates : next
    const out = [...pool].sort(evictionOrder)[0]
    next.splice(next.indexOf(out), 1)
  }
  return { list: next, added: added.filter((fact) => next.includes(fact)) }
}

/**
 * The facts that go into a prompt, within `cap` characters: the most used and then the newest
 * are kept, so the oldest and least used are the ones left out. Given back oldest first.
 */
export function memoryForPrompt(list: readonly MemoryFact[], cap: number = AI_MEMORY_CAPS.promptChars): MemoryFact[] {
  const kept: MemoryFact[] = []
  let used = 0
  for (const fact of [...list].sort((a, b) => evictionOrder(b, a))) {
    const size = fact.text.length + 3
    if (used + size > cap) continue
    kept.push(fact)
    used += size
  }
  return kept.sort((a, b) => a.at - b.at)
}

/** The list with one more use counted for each of `ids`. */
export function countUses(list: readonly MemoryFact[], ids: readonly string[]): MemoryFact[] {
  if (!ids.length) return [...list]
  return list.map((fact) => (ids.includes(fact.id) ? { ...fact, uses: fact.uses + 1 } : fact))
}

/** What the window may ask of the stored facts. */
export type MemoryOp = { op: 'edit'; id: string; text: string } | { op: 'remove'; ids: string[] } | { op: 'clear' }

export function cleanMemoryOp(value: unknown): MemoryOp | null {
  if (!isObject(value)) return null
  if (value.op === 'clear') return { op: 'clear' }
  if (value.op === 'remove' && Array.isArray(value.ids)) {
    const ids = value.ids.filter((id): id is string => typeof id === 'string' && ID_RE.test(id)).slice(0, AI_MEMORY_CAPS.facts)
    return { op: 'remove', ids }
  }
  if (value.op === 'edit' && typeof value.id === 'string' && ID_RE.test(value.id) && typeof value.text === 'string')
    return { op: 'edit', id: value.id, text: value.text.slice(0, AI_MEMORY_CAPS.text * 2) }
  return null
}

/** Why an edit is refused, or the new list. An edit to nothing deletes the fact. */
export function applyMemoryOp(
  list: readonly MemoryFact[],
  op: MemoryOp,
  now: number
): { list: MemoryFact[]; refused?: 'too-long' | 'secret' | 'missing' } {
  switch (op.op) {
    case 'clear':
      return { list: [] }
    case 'remove':
      return { list: list.filter((fact) => !op.ids.includes(fact.id)) }
    case 'edit': {
      const index = list.findIndex((fact) => fact.id === op.id)
      if (index < 0) return { list: [...list], refused: 'missing' }
      const text = tidyFact(op.text)
      if (!text) return { list: list.filter((fact) => fact.id !== op.id) }
      if (text.length > AI_MEMORY_CAPS.text) return { list: [...list], refused: 'too-long' }
      if (findSecret(text)) return { list: [...list], refused: 'secret' }
      const next = [...list]
      next[index] = { ...next[index], text, at: now }
      return { list: next }
    }
  }
}
