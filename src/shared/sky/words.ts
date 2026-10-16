// Names the Sky shares between the main process (Herman's lines) and the windows (the captions).

import type { NotebookLocale } from '../notebook'
import type { MeteorShower } from './events'

export const SHOWER_NAMES: Record<NotebookLocale, Record<MeteorShower, string>> = {
  en: {
    quadrantids: 'Quadrantids',
    lyrids: 'Lyrids',
    'eta-aquariids': 'Eta Aquariids',
    'delta-aquariids': 'Delta Aquariids',
    perseids: 'Perseids',
    orionids: 'Orionids',
    leonids: 'Leonids',
    geminids: 'Geminids'
  },
  'pt-BR': {
    quadrantids: 'Quadrântidas',
    lyrids: 'Líridas',
    'eta-aquariids': 'Eta Aquáridas',
    'delta-aquariids': 'Delta Aquáridas',
    perseids: 'Perseidas',
    orionids: 'Oriônidas',
    leonids: 'Leônidas',
    geminids: 'Geminídeas'
  }
}

const MONTHS: Record<NotebookLocale, readonly string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  'pt-BR': ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
}

/** "Outubro" / "October" for 'YYYY-10', capitalised to start a sentence. */
export function monthName(month: string, locale: NotebookLocale): string {
  return MONTHS[locale][Number(month.slice(5, 7)) - 1] ?? ''
}
