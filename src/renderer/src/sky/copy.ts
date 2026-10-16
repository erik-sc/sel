// The words of the Sky, in English and in Brazilian Portuguese, chosen the way Meditations chooses
// them (by the main process: shared/sky SkyView.locale). Pure: no React, no DOM.
// The Sky shows no number: the only digits are a date (in a tooltip, under the title) and a year.
import type { NotebookLocale } from '@shared/notebook'
import { monthName, SHOWER_NAMES, type SkyEvent } from '@shared/sky'

export interface SkyCopy {
  title: string
  kicker: string
  /** The eight phases of the moon, new first. */
  phase: readonly string[]
  empty: string
  emptyLink: string
  /** "A year ago today you wrote: “…”" */
  echo: (years: number, text: string) => string
  earlierSkies: string
  skyOf: (year: number) => string
  backToNow: string
  moreLines: string
  nameStepTitle: (month: string) => string
  nameStepAsk: string
  nameStepHint: string
  settingsShow: string
  settingsShowHelp: string
  settingsHemisphere: string
  settingsHemisphereHelp: string
  southern: string
  northern: string
  settingsEvents: string
  settingsEventsHelp: string
  loadFailed: string
  tryAgain: string
  /** What the line under the sky says on a rare night, or null when it says nothing. */
  eventCaption: (event: SkyEvent) => string | null
  /** The figure on the sky, for screen readers. */
  chartLabel: string
}

function yearsWord(years: number, locale: NotebookLocale): string {
  const en = ['a year', 'two years', 'three years', 'four years', 'five years', 'six years', 'seven years', 'eight years', 'nine years', 'ten years']
  const pt = ['um ano', 'dois anos', 'três anos', 'quatro anos', 'cinco anos', 'seis anos', 'sete anos', 'oito anos', 'nove anos', 'dez anos']
  const list = locale === 'pt-BR' ? pt : en
  return list[years - 1] ?? (locale === 'pt-BR' ? 'muitos anos' : 'many years')
}

export const COPY: Record<NotebookLocale, SkyCopy> = {
  en: {
    title: 'Sky',
    kicker: 'Star chart',
    phase: ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'],
    empty: 'Each day you write in Meditations lights a star.',
    emptyLink: 'Write today’s',
    echo: (years, text) => `${years === 1 ? 'A year ago today' : `${yearsWord(years, 'en')[0].toUpperCase()}${yearsWord(years, 'en').slice(1)} ago today`} you wrote: “${text}”`,
    earlierSkies: 'Earlier skies',
    skyOf: (year) => `The sky of ${year}`,
    backToNow: 'Tonight’s sky',
    moreLines: 'and other lines…',
    nameStepTitle: (month) => `${monthName(month, 'en')} became a constellation.`,
    nameStepAsk: 'What will you call it?',
    nameStepHint: 'Give it a name, or keep the figure’s. Enter goes on.',
    settingsShow: 'Show the Sky',
    settingsShowHelp: 'Each day written in Meditations lights a star. Off, its button, command and shortcut go away; nothing is lost.',
    settingsHemisphere: 'Hemisphere',
    settingsHemisphereHelp: 'Which side of the moon is lit, and the seasons of rare nights.',
    southern: 'Southern',
    northern: 'Northern',
    settingsEvents: 'Rare nights in the sky',
    settingsEventsHelp: 'Meteor showers, eclipses, a comet now and then. Only on the Sky’s screen.',
    loadFailed: 'The sky could not be opened.',
    tryAgain: 'Try again',
    eventCaption: (e) => {
      switch (e.kind) {
        case 'meteors':
          return SHOWER_NAMES.en[e.shower]
        case 'eclipse':
          return e.total ? 'Total eclipse of the moon' : 'Partial eclipse of the moon'
        case 'season':
          return {
            'spring-equinox': 'Spring equinox',
            'summer-solstice': 'Summer solstice · the longest day of the year',
            'autumn-equinox': 'Autumn equinox',
            'winter-solstice': 'Winter solstice · the longest night of the year'
          }[e.mark]
        case 'anniversary':
          return 'The first star’s birthday'
        case 'new-year':
          return 'New year · the sky begins empty, like a page'
        case 'comet':
          return 'A comet, passing'
        case 'halo':
          return 'A halo around the moon'
        default:
          return null
      }
    },
    chartLabel: 'The sky of this year'
  },
  'pt-BR': {
    title: 'Céu',
    kicker: 'Carta celeste',
    phase: ['Lua nova', 'Lua crescente', 'Quarto crescente', 'Lua gibosa crescente', 'Lua cheia', 'Lua gibosa minguante', 'Quarto minguante', 'Lua minguante'],
    empty: 'Cada dia escrito nas Meditações acende uma estrela.',
    emptyLink: 'Escrever a de hoje',
    echo: (years, text) => `${years === 1 ? 'Há um ano' : `Há ${yearsWord(years, 'pt-BR')}`}, neste dia, você escreveu: “${text}”`,
    earlierSkies: 'Céus anteriores',
    skyOf: (year) => `O céu de ${year}`,
    backToNow: 'O céu de agora',
    moreLines: 'e outras linhas…',
    nameStepTitle: (month) => `${monthName(month, 'pt-BR')} virou uma constelação.`,
    nameStepAsk: 'Que nome você dá a ela?',
    nameStepHint: 'Dê um nome, ou deixe o da figura. Enter continua.',
    settingsShow: 'Mostrar o Céu',
    settingsShowHelp: 'Cada dia escrito nas Meditações acende uma estrela. Desligado, somem o botão, o comando e o atalho; nada se perde.',
    settingsHemisphere: 'Hemisfério',
    settingsHemisphereHelp: 'De que lado a lua aparece acesa, e as estações das noites raras.',
    southern: 'Sul',
    northern: 'Norte',
    settingsEvents: 'Noites raras no céu',
    settingsEventsHelp: 'Chuvas de meteoros, eclipses, de vez em quando um cometa. Só na tela do Céu.',
    loadFailed: 'Não foi possível abrir o céu.',
    tryAgain: 'Tentar de novo',
    eventCaption: (e) => {
      switch (e.kind) {
        case 'meteors':
          return SHOWER_NAMES['pt-BR'][e.shower]
        case 'eclipse':
          return e.total ? 'Eclipse total da lua' : 'Eclipse parcial da lua'
        case 'season':
          return {
            'spring-equinox': 'Equinócio de primavera',
            'summer-solstice': 'Solstício de verão · o dia mais longo do ano',
            'autumn-equinox': 'Equinócio de outono',
            'winter-solstice': 'Solstício de inverno · a noite mais longa do ano'
          }[e.mark]
        case 'anniversary':
          return 'O aniversário da primeira estrela'
        case 'new-year':
          return 'Ano novo · o céu começa vazio, como uma página'
        case 'comet':
          return 'Um cometa de passagem'
        case 'halo':
          return 'Um halo em volta da lua'
        default:
          return null
      }
    },
    chartLabel: 'O céu deste ano'
  }
}

/** The day written out, for a star's tooltip and under the title: "quinta-feira, 15 de outubro de 2026". */
export function longDay(day: string, locale: NotebookLocale, withYear = true): string {
  const date = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12)
  const text = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).format(date)
  return text[0].toUpperCase() + text.slice(1)
}
