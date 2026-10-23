// The words of the persona's memory (0.8.0 A3): the line under an answer ("Remembered: …" with
// "Undo") and Settings → AI → Memory, in English and in Brazilian Portuguese. Written in Herman's
// words and said of the chosen persona (shared/persona.ts). Pure: no React, no DOM.
import type { PersonaId } from '@shared/herman'
import { personifyCopy } from '@shared/persona'
import type { HomeLocale } from '@/home/copy'

export interface MemoryCopy {
  /** The line under an answer. */
  remembered: (text: string) => string
  undo: string
  undoFailed: string
  title: string
  intro: string
  switchLabel: string
  switchOn: string
  switchOff: string
  on: string
  off: string
  count: (facts: number, cap: number) => string
  none: string
  factLabel: string
  remove: string
  removeLabel: (text: string) => string
  removeAll: string
  removeAllConfirm: string
  removedAll: string
  saved: string
  refused: Record<'too-long' | 'secret' | 'missing', string>
  failed: string
  note: string
}

export const MEMORY_COPY: Record<HomeLocale, MemoryCopy> = {
  en: {
    remembered: (text) => `Remembered: ${text}`,
    undo: 'Undo',
    undoFailed: 'That could not be forgotten.',
    title: 'Memory',
    intro:
      'What Herman keeps from your conversations by himself: short facts about you and your work, such as who a project is for or how you like answers. They go along with every request, and each new one shows under its answer with "Undo". Never from a page private from the AI, and never a password, key, or document or card number.',
    switchLabel: 'Remember',
    switchOn:
      'On: after a turn that says something about you, one small extra request to Claude (a light model, no tools) picks out what to keep.',
    switchOff: 'Off: nothing new is kept, and nothing kept goes along.',
    on: 'On',
    off: 'Off',
    count: (facts, cap) => `${facts} of ${cap} facts`,
    none: 'Nothing remembered yet.',
    factLabel: 'Remembered fact',
    remove: 'Delete',
    removeLabel: (text) => `Delete “${text}”`,
    removeAll: 'Delete all',
    removeAllConfirm: 'Delete all now',
    removedAll: 'Memory cleared.',
    saved: 'Saved.',
    refused: {
      'too-long': 'At most 200 characters.',
      secret: 'That looks like a password, key, or document or card number: it was not kept.',
      missing: 'That fact is no longer kept.'
    },
    failed: 'The memory could not be changed.',
    note: 'Kept on this device only, never synced. At most 50 facts are kept, and as many as fit go along with a request: the oldest and least used drop out first. An empty fact is deleted.'
  },
  'pt-BR': {
    remembered: (text) => `Lembrei: ${text}`,
    undo: 'Desfazer',
    undoFailed: 'Não foi possível esquecer.',
    title: 'Memória',
    intro:
      'O que o Herman guarda das suas conversas por conta própria: fatos curtos sobre você e seu trabalho, como para quem é um projeto ou como você gosta das respostas. Vão junto em todo pedido, e cada novo aparece embaixo da resposta com "Desfazer". Nunca de uma página privada para a AI, e nunca uma senha, chave, ou número de documento ou de cartão.',
    switchLabel: 'Lembrar',
    switchOn:
      'Ligada: depois de uma conversa que diz algo sobre você, um pedido extra e pequeno ao Claude (um modelo leve, sem ferramentas) escolhe o que guardar.',
    switchOff: 'Desligada: nada novo é guardado, e nada guardado vai junto.',
    on: 'Ligada',
    off: 'Desligada',
    count: (facts, cap) => `${facts} de ${cap} fatos`,
    none: 'Nada guardado ainda.',
    factLabel: 'Fato guardado',
    remove: 'Apagar',
    removeLabel: (text) => `Apagar “${text}”`,
    removeAll: 'Apagar tudo',
    removeAllConfirm: 'Apagar tudo agora',
    removedAll: 'Memória apagada.',
    saved: 'Salvo.',
    refused: {
      'too-long': 'No máximo 200 caracteres.',
      secret: 'Parece uma senha, chave, ou número de documento ou de cartão: não foi guardado.',
      missing: 'Esse fato não está mais guardado.'
    },
    failed: 'Não foi possível mudar a memória.',
    note: 'Fica só neste dispositivo, nunca sincroniza. São guardados no máximo 50 fatos, e vão junto num pedido quantos couberem: os mais antigos e menos usados saem primeiro. Um fato vazio é apagado.'
  }
}

/** The copy said of the chosen persona. */
export function memoryCopy(locale: HomeLocale, persona: PersonaId): MemoryCopy {
  return personifyCopy(MEMORY_COPY[locale], persona, locale)
}
