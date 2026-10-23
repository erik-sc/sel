import { describe, expect, it } from 'vitest'
import {
  addFacts,
  AI_MEMORY_CAPS,
  applyMemoryOp,
  cleanMemory,
  cleanMemoryInput,
  cleanMemoryOp,
  countUses,
  findSecret,
  memoryEnabled,
  memoryForPrompt,
  parseMemoryReply,
  sameFact,
  worthRemembering,
  type MemoryFact
} from './aiMemory'

const fact = (id: string, text: string, at: number, uses = 0): MemoryFact => ({ id, text, at, source: 'c1', uses })

describe('the secret filter', () => {
  it('turns away passwords, keys, tokens, documents and card numbers', () => {
    const secrets = [
      'My password is hunter2',
      'A senha do banco é 1234abcd',
      'The Wi-Fi passphrase: correct horse',
      'The PIN code of the office door',
      'o PIN é 4821',
      'Uses the API key sk-ant-api03-abcdefghijklmnop',
      'GitHub token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'token = abc',
      'Slack bot xoxb-1234567890-abcdefghij',
      'AWS AKIAIOSFODNN7EXAMPLE is the key id',
      'Session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
      'Hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      'CPF 123.456.789-09',
      'O CNPJ da empresa é 12.345.678/0001-95',
      'Seu RG é 12345678',
      'SSN 123-45-6789',
      'IBAN DE89 3704 0044 0532 0130 00',
      'Card 4111 1111 1111 1111 for the team',
      'Phone 11987654321',
      'Its build id is A1b2C3d4E5f6G7h8I9j0K1',
      'Credenciais do servidor ficam com a Ana',
      'Keeps the private key in a drawer'
    ]
    for (const text of secrets) expect(findSecret(text), text).not.toBeNull()
  })

  it('keeps ordinary facts about the user and their work', () => {
    const fine = [
      'Prefers short answers, in lists when they help',
      'O projeto Auxiliadora é do banco X',
      'Works on the design tokens of the app',
      'Pins the release page to keep it in view',
      'Writes in Portuguese with clients and English in code',
      'The launch moved to 2026-05-04',
      'Release 0.8.0 ships in November with 3 epics',
      'Lives in São Paulo and works remotely',
      'Uses https://github.com/erik-sc/sel for the code'
    ]
    for (const text of fine) expect(findSecret(text), text).toBeNull()
  })
})

describe('picking facts out of a reply', () => {
  it('reads strict JSON, a fence around it at most', () => {
    expect(parseMemoryReply('{"facts":["Prefers short answers"]}')).toEqual(['Prefers short answers'])
    expect(parseMemoryReply('```json\n{"facts":["A", "B"]}\n```')).toEqual(['A', 'B'])
    expect(parseMemoryReply('{"facts":[]}')).toEqual([])
    for (const text of ['Prefers short answers', 'Sure! {"facts":["x"]}', '["x"]', '{"facts":"x"}', '', 'null'])
      expect(parseMemoryReply(text), text).toEqual([])
  })

  it('keeps three at most, drops the long, the empty, the repeated and the secret ones', () => {
    const long = 'x'.repeat(AI_MEMORY_CAPS.text + 1)
    const reply = JSON.stringify({
      facts: ['  One\nfact ', long, '', 42, 'one FACT.', 'My password is x', 'Two', 'Three', 'Four']
    })
    expect(parseMemoryReply(reply)).toEqual(['One fact', 'Two', 'Three'])
  })

  it('runs only for a turn that says something about the user, with a real answer', () => {
    const answer = 'A real answer that is long enough to count as one.'
    expect(worthRemembering({ question: 'I prefer short answers in Portuguese', answer })).toBe(true)
    expect(worthRemembering({ question: 'Eu trabalho no projeto Auxiliadora do banco X', answer })).toBe(true)
    expect(worthRemembering({ question: 'Summarize this page', answer })).toBe(false)
    expect(worthRemembering({ question: 'What is on the agenda today?', answer })).toBe(false)
    // A command speaks to the assistant, not of the user.
    expect(worthRemembering({ question: 'Give me a short status of the day please', answer })).toBe(false)
    expect(worthRemembering({ question: 'Nós usamos Notion para tudo no time', answer })).toBe(true)
    expect(worthRemembering({ question: 'Trabalho com crédito imobiliário há anos', answer })).toBe(true)
    expect(worthRemembering({ question: 'I prefer short answers in Portuguese', answer: 'Ok.' })).toBe(false)
    expect(worthRemembering({ question: 'hi', answer })).toBe(false)
  })

  it('cleans what the window sends', () => {
    expect(cleanMemoryInput(null)).toBeNull()
    expect(cleanMemoryInput({ conversationId: 'bad id!', messageId: 1, question: 'q', answer: 'a' })).toBeNull()
    expect(
      cleanMemoryInput({
        conversationId: 'c1',
        messageId: 3,
        question: 'q'.repeat(9000),
        answer: 'a',
        history: [{ role: 'user', text: 'x' }, { role: 'system', text: 'y' }, 'z'],
        pageIds: ['p1', '../x', 7, 'p2']
      })
    ).toEqual({
      conversationId: 'c1',
      messageId: 3,
      question: 'q'.repeat(AI_MEMORY_CAPS.question),
      answer: 'a',
      history: [{ role: 'user', text: 'x' }],
      pageIds: ['p1', 'p2']
    })
  })
})

describe('keeping facts', () => {
  let n = 0
  const newId = (): string => `m${++n}`

  it('adds what it does not hold yet, written alike or not', () => {
    const { list, added } = addFacts([fact('a', 'Prefers short answers', 1)], ['prefers short answers!', 'Works at bank X'], {
      source: 'c2',
      now: 5,
      newId
    })
    expect(list.map((entry) => entry.text)).toEqual(['Prefers short answers', 'Works at bank X'])
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ text: 'Works at bank X', at: 5, source: 'c2', uses: 0 })
    expect(sameFact('Olá, João', 'ola joao')).toBe(true)
  })

  it('past the cap, lets the least used and then the oldest go, never this turn’s', () => {
    const full = Array.from({ length: AI_MEMORY_CAPS.facts }, (_, i) => fact(`f${i}`, `Fact ${i}`, 100 + i, i < 3 ? 0 : 5))
    const { list, added } = addFacts(full, ['New one', 'Newer one'], { source: 'c', now: 999, newId })
    expect(list).toHaveLength(AI_MEMORY_CAPS.facts)
    expect(added.map((entry) => entry.text)).toEqual(['New one', 'Newer one'])
    // f0 and f1: unused and the oldest; f2 stays (unused, but younger).
    expect(list.some((entry) => entry.id === 'f0' || entry.id === 'f1')).toBe(false)
    expect(list.some((entry) => entry.id === 'f2')).toBe(true)
  })

  it('sends the most used and newest within the cap, oldest first, and counts the uses', () => {
    const list = [fact('a', 'a'.repeat(100), 1, 0), fact('b', 'b'.repeat(100), 2, 4), fact('c', 'c'.repeat(100), 3, 0)]
    expect(memoryForPrompt(list, 220).map((entry) => entry.id)).toEqual(['b', 'c'])
    expect(memoryForPrompt(list).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(countUses(list, ['a', 'c']).map((entry) => entry.uses)).toEqual([1, 4, 1])
  })

  it('edits, deletes one, deletes all; refuses a secret or a fact too long', () => {
    const list = [fact('a', 'One', 1), fact('b', 'Two', 2)]
    expect(applyMemoryOp(list, { op: 'edit', id: 'a', text: ' Uno ' }, 9).list[0]).toMatchObject({ text: 'Uno', at: 9 })
    expect(applyMemoryOp(list, { op: 'edit', id: 'a', text: '  ' }, 9).list.map((entry) => entry.id)).toEqual(['b'])
    expect(applyMemoryOp(list, { op: 'edit', id: 'a', text: 'senha 123' }, 9)).toMatchObject({ refused: 'secret' })
    expect(applyMemoryOp(list, { op: 'edit', id: 'a', text: 'x'.repeat(201) }, 9)).toMatchObject({ refused: 'too-long' })
    expect(applyMemoryOp(list, { op: 'edit', id: 'z', text: 'x' }, 9)).toMatchObject({ refused: 'missing' })
    expect(applyMemoryOp(list, { op: 'remove', ids: ['b'] }, 9).list.map((entry) => entry.id)).toEqual(['a'])
    expect(applyMemoryOp(list, { op: 'clear' }, 9).list).toEqual([])
    expect(cleanMemoryOp({ op: 'edit', id: 'a', text: 'x' })).toEqual({ op: 'edit', id: 'a', text: 'x' })
    expect(cleanMemoryOp({ op: 'drop' })).toBeNull()
  })

  it('reads back only what is valid, and is on unless turned off', () => {
    const stored = [fact('a', 'One', 1), { id: 'b', text: 'My password is x', at: 1, uses: 0 }, { id: 'a', text: 'dup' }, 'junk']
    expect(cleanMemory(stored).map((entry) => entry.id)).toEqual(['a'])
    expect(cleanMemory('nope')).toEqual([])
    expect(memoryEnabled(undefined)).toBe(true)
    expect(memoryEnabled(null)).toBe(true)
    expect(memoryEnabled(false)).toBe(false)
  })
})
