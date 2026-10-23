// The words of the conversation balloon, its "Earlier" list and the log of what the AI applied,
// in English and in Brazilian Portuguese, chosen like the home's. The persona's name comes in
// as a parameter. Pure: no React, no DOM.
import type { PersonaId } from '@shared/herman'
import { personifyCopy } from '@shared/persona'
import type { HomeLocale } from '@/home/copy'

export interface BalloonCopy {
  assistant: string
  dialogLabel: (name: string) => string
  emptyTitle: { persona: string; today: string; page: string; none: string }
  emptyHelp: { today: string; page: string; none: string }
  suggestions: string
  /** `persona` is in Herman's words: `balloonCopy` says it of the chosen persona. */
  placeholder: { persona: string; today: string; page: string; none: string }
  message: string
  send: string
  stop: string
  newConversation: string
  earlier: string
  applied: string
  expand: string
  shrink: string
  close: string
  back: string
  inScope: string
  noPage: string
  todayChip: string
  selection: string
  leaveSelectionOut: string
  insertBelow: string
  replaceSelection: string
  copy: string
  retry: string
  howToSignIn: string
  openPageToInsert: string
  selectFirst: string
  copied: string
  copyFailed: string
  nothingToInsert: string
  writingActions: string
  unreadable: (name: string, count: number) => string
  truncated: string
  proposed: string
  apply: string
  dismiss: string
  open: string
  undoAll: string
  undoneToast: string
  applyFailed: string
  undoFailed: string
  earlierEmpty: string
  earlierNote: (cap: number) => string
  deleteAll: string
  confirmDeleteAll: (count: number) => string
  cancel: string
  deleted: string
  logEmpty: string
  logNote: string
  logPages: string
  changedSince: (count: number) => string
  undoAnyway: string
  undone: string
  tooLargeToUndo: string
  clearLog: string
  conversationsLabel: string
  conversationsHelp: (count: number, cap: number) => string
  logLabel: string
  logHelp: string
}

export const BALLOON_COPY: Record<HomeLocale, BalloonCopy> = {
  en: {
    assistant: 'Assistant',
    dialogLabel: (name) => `Conversation with ${name}`,
    emptyTitle: { persona: 'What is on your mind?', today: 'Ask about your day', page: 'Ask about this page', none: 'Ask anything' },
    emptyHelp: {
      today: "The assistant is given today's agenda and open tasks.",
      page: 'The assistant reads this page and what is around it. Nothing changes unless you insert an answer or apply what it proposes.',
      none: 'Open a page to ask about what is in it.'
    },
    suggestions: 'Suggestions',
    placeholder: { persona: 'Ask Herman…', today: 'Ask about your day…', page: 'Ask about this page…', none: 'Ask anything…' },
    message: 'Message',
    send: 'Send',
    stop: 'Stop',
    newConversation: 'New conversation',
    earlier: 'Earlier conversations',
    applied: 'What the AI applied',
    expand: 'Make larger',
    shrink: 'Make smaller',
    close: 'Close',
    back: 'Back to the conversation',
    inScope: 'In scope',
    noPage: 'No page open',
    todayChip: 'Today: agenda and open tasks',
    selection: 'Selection',
    leaveSelectionOut: 'Leave the selection out',
    insertBelow: 'Insert below',
    replaceSelection: 'Replace selection',
    copy: 'Copy',
    retry: 'Retry',
    howToSignIn: 'How to sign in',
    openPageToInsert: 'Open a page to insert into',
    selectFirst: 'Select text in the page first',
    copied: 'Copied.',
    copyFailed: 'Could not copy the answer.',
    nothingToInsert: 'There was nothing to insert.',
    writingActions: 'Writing down what to build…',
    unreadable: (name, count) => `${name} proposed changes I couldn't read (${count})`,
    truncated: 'The answer was cut off because it got too long.',
    proposed: 'Proposed',
    apply: 'Apply',
    dismiss: 'Dismiss',
    open: 'Open',
    undoAll: 'Undo all of this',
    undoneToast: 'Undone.',
    applyFailed: 'That could not be applied.',
    undoFailed: 'That could not be undone. Each page keeps a version from before, in its history.',
    earlierEmpty: 'No earlier conversations yet.',
    earlierNote: (cap) => `The last ${cap}, kept on this device only.`,
    deleteAll: 'Delete all',
    confirmDeleteAll: (count) => `Delete all ${count} for good?`,
    cancel: 'Cancel',
    deleted: 'Conversations deleted.',
    logEmpty: 'Nothing applied yet.',
    logNote: 'Every Apply, with what it changed. Undoing puts the pages back as they were just before it.',
    logPages: 'Pages',
    changedSince: (count) =>
      `${count === 1 ? 'One block was' : `${count} blocks were`} changed after this. Undoing puts ${count === 1 ? 'it' : 'them'} back as before the AI, and those changes are lost.`,
    undoAnyway: 'Undo anyway',
    undone: 'Undone',
    tooLargeToUndo: 'Too large to undo from here: each page kept a version from before, in its history.',
    clearLog: 'Clear the log',
    conversationsLabel: 'Earlier conversations',
    conversationsHelp: (count, cap) =>
      `${count === 0 ? 'None kept' : `${count} kept`}, the last ${cap} at most. On this device only, never synced.`,
    logLabel: 'What the AI applied',
    logHelp: 'Each Apply, with the pages it changed and a way to undo it. On this device only.'
  },
  'pt-BR': {
    assistant: 'Assistente',
    dialogLabel: (name) => `Conversa com ${name}`,
    emptyTitle: {
      persona: 'No que você está pensando?',
      today: 'Pergunte sobre o seu dia',
      page: 'Pergunte sobre esta página',
      none: 'Pergunte qualquer coisa'
    },
    emptyHelp: {
      today: 'O assistente recebe a agenda de hoje e as tarefas abertas.',
      page: 'O assistente lê esta página e o que está em volta. Nada muda a não ser que você insira uma resposta ou aplique o que ele propõe.',
      none: 'Abra uma página para perguntar sobre o que tem nela.'
    },
    suggestions: 'Sugestões',
    placeholder: {
      persona: 'Pergunte ao Herman…',
      today: 'Pergunte sobre o seu dia…',
      page: 'Pergunte sobre esta página…',
      none: 'Pergunte qualquer coisa…'
    },
    message: 'Mensagem',
    send: 'Enviar',
    stop: 'Parar',
    newConversation: 'Nova conversa',
    earlier: 'Conversas anteriores',
    applied: 'O que a AI aplicou',
    expand: 'Aumentar',
    shrink: 'Diminuir',
    close: 'Fechar',
    back: 'Voltar à conversa',
    inScope: 'No contexto',
    noPage: 'Nenhuma página aberta',
    todayChip: 'Hoje: agenda e tarefas abertas',
    selection: 'Seleção',
    leaveSelectionOut: 'Deixar a seleção de fora',
    insertBelow: 'Inserir abaixo',
    replaceSelection: 'Substituir a seleção',
    copy: 'Copiar',
    retry: 'Tentar de novo',
    howToSignIn: 'Como entrar',
    openPageToInsert: 'Abra uma página para inserir',
    selectFirst: 'Selecione um texto na página antes',
    copied: 'Copiado.',
    copyFailed: 'Não deu para copiar a resposta.',
    nothingToInsert: 'Não havia nada para inserir.',
    writingActions: 'Anotando o que montar…',
    unreadable: (name, count) => `${name} propôs mudanças que não consegui ler (${count})`,
    truncated: 'A resposta foi cortada porque ficou longa demais.',
    proposed: 'Proposta',
    apply: 'Aplicar',
    dismiss: 'Descartar',
    open: 'Abrir',
    undoAll: 'Desfazer tudo isto',
    undoneToast: 'Desfeito.',
    applyFailed: 'Não deu para aplicar.',
    undoFailed: 'Não deu para desfazer. Cada página guarda uma versão de antes, no histórico.',
    earlierEmpty: 'Nenhuma conversa anterior ainda.',
    earlierNote: (cap) => `As últimas ${cap}, guardadas só neste aparelho.`,
    deleteAll: 'Apagar todas',
    confirmDeleteAll: (count) => `Apagar as ${count} de vez?`,
    cancel: 'Cancelar',
    deleted: 'Conversas apagadas.',
    logEmpty: 'Nada aplicado ainda.',
    logNote: 'Cada Aplicar, com o que mudou. Desfazer deixa as páginas como estavam logo antes.',
    logPages: 'Páginas',
    changedSince: (count) =>
      `${count === 1 ? 'Um bloco mudou' : `${count} blocos mudaram`} depois disto. Desfazer ${count === 1 ? 'o deixa' : 'os deixa'} como antes da AI, e essas mudanças se perdem.`,
    undoAnyway: 'Desfazer mesmo assim',
    undone: 'Desfeito',
    tooLargeToUndo: 'Grande demais para desfazer por aqui: cada página guardou uma versão de antes, no histórico.',
    clearLog: 'Limpar o registro',
    conversationsLabel: 'Conversas anteriores',
    conversationsHelp: (count, cap) =>
      `${count === 0 ? 'Nenhuma guardada' : `${count} guardada${count === 1 ? '' : 's'}`}, as últimas ${cap} no máximo. Só neste aparelho, nunca sincronizadas.`,
    logLabel: 'O que a AI aplicou',
    logHelp: 'Cada Aplicar, com as páginas que mudou e um jeito de desfazer. Só neste aparelho.'
  }
}

/** The table for a locale, said of the chosen persona (shared/persona.ts). */
export function balloonCopy(locale: HomeLocale, persona: PersonaId): BalloonCopy {
  return personifyCopy(BALLOON_COPY[locale], persona, locale)
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000]
]

/** "3 hours ago", "há 3 horas"; "now" under a minute. */
export function whenText(at: number, now: number, locale: HomeLocale): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const elapsed = Math.max(0, now - at)
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit)
  }
  return format.format(0, 'second')
}
