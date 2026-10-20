// The words of the template gallery, in English and in Brazilian Portuguese, chosen like the
// home's: the language set for AI answers when it is one of the two, else the system's. The
// templates are made in the same language. Pure: no React, no DOM.
import type { TemplateLocale } from '../../../shared/templates/model'
import type { ViewType } from '../../../shared/types'

export interface TemplatesCopy {
  title: string
  intro: string
  /** The gallery's list of templates, for screen readers. */
  listLabel: string
  withExamples: string
  withExamplesHelp: string
  empty: string
  emptyHelp: string
  where: string
  atRoot: string
  /** Inside the page the gallery was opened from. */
  inside: (title: string) => string
  cancel: string
  use: string
  making: string
  failed: string
  untitled: string
  /** The outline: what a database holds. */
  views: Record<ViewType, string>
  rows: (n: number) => string
  properties: (n: number) => string
  linkedView: (source: string) => string
  page: string
  /** Menus and buttons that open the gallery. */
  open: string
  openInside: string
  /** The command palette entry. */
  command: string
}

export const TEMPLATES_COPY: Record<TemplateLocale, TemplatesCopy> = {
  en: {
    title: 'Templates',
    intro: 'A page that is ready to use, with its databases and views already linked. Everything in it is yours to change.',
    listLabel: 'Templates',
    withExamples: 'With examples',
    withExamplesHelp: 'Example rows show how it works; delete them when you are ready.',
    empty: 'Empty',
    emptyHelp: 'The same pages, databases and views, without rows.',
    where: 'Where',
    atRoot: 'In the sidebar, at the top level',
    inside: (title) => `Inside "${title}"`,
    cancel: 'Cancel',
    use: 'Use template',
    making: 'Making…',
    failed: 'make the page from the template',
    untitled: 'Untitled',
    views: { table: 'table', board: 'board', list: 'list', gallery: 'gallery', calendar: 'calendar', chart: 'chart', calc: 'calculations' },
    rows: (n) => (n === 1 ? '1 example' : `${n} examples`),
    properties: (n) => (n === 1 ? '1 property' : `${n} properties`),
    linkedView: (source) => `view of ${source}`,
    page: 'page',
    open: 'New page from a template…',
    openInside: 'Add a template inside…',
    command: 'Templates'
  },
  'pt-BR': {
    title: 'Templates',
    intro: 'Uma página pronta para usar, com as bases e as visões já ligadas. Tudo nela é seu para mudar.',
    listLabel: 'Templates',
    withExamples: 'Com exemplos',
    withExamplesHelp: 'Linhas de exemplo mostram como funciona; apague quando quiser.',
    empty: 'Vazio',
    emptyHelp: 'As mesmas páginas, bases e visões, sem linhas.',
    where: 'Onde',
    atRoot: 'Na barra lateral, no primeiro nível',
    inside: (title) => `Dentro de "${title}"`,
    cancel: 'Cancelar',
    use: 'Usar template',
    making: 'Criando…',
    failed: 'make the page from the template',
    untitled: 'Sem título',
    views: {
      table: 'tabela',
      board: 'quadro',
      list: 'lista',
      gallery: 'galeria',
      calendar: 'calendário',
      chart: 'gráfico',
      calc: 'cálculos'
    },
    rows: (n) => (n === 1 ? '1 exemplo' : `${n} exemplos`),
    properties: (n) => (n === 1 ? '1 propriedade' : `${n} propriedades`),
    linkedView: (source) => `visão de ${source}`,
    page: 'página',
    open: 'Nova página a partir de template…',
    openInside: 'Adicionar um template dentro…',
    command: 'Templates'
  }
}
