// The words of Settings → AI → Context and Claude's tools, of the page menu's "pin as context"
// and "Private from AI", and of the line under an answer that says what went along, in English
// and in Brazilian Portuguese, chosen like the home's. Pure: no React, no DOM.
import type { AiSent, McpAccess, McpScope } from '@shared/aiContext'
import type { AiPrivacyReason } from '@shared/aiPrivate'
import type { ScopeKind } from '@shared/aiScope'
import type { PersonaId } from '@shared/herman'
import { personifyCopy } from '@shared/persona'
import type { HomeLocale } from '@/home/copy'

export interface ContextCopy {
  contextTitle: string
  contextIntro: string
  contextLabel: string
  contextHelp: string
  contextPlaceholder: string
  /** Characters used, of the cap. */
  contextCount: (used: number, cap: number) => string
  save: string
  saved: string
  saveFailed: string
  pinnedLabel: string
  pinnedHelp: (cap: number) => string
  pinnedNone: string
  unpin: string
  missingPage: string
  contextNote: string

  toolsTitle: string
  on: string
  off: string
  toolsIntro: string
  toolsWarning: string
  scan: string
  scanning: string
  scanHelp: (when: string | null) => string
  scanFailed: string
  loadFailed: string
  unreadable: string
  noServers: string
  scope: Record<McpScope, string>
  access: Record<McpAccess, string>
  accessHelp: Record<McpAccess, string>
  loadTools: string
  loadingTools: string
  toolsFailed: string
  toolsUnknown: string
  /** How many tools may run, of how many were found. */
  toolsCount: (allowed: number, found: number) => string
  writeTool: string
  allWarning: string
  toolsNote: string

  pin: string
  unpinPage: string
  pinFull: (cap: number) => string
  pinFailed: string
  /** Refusing to pin a page private from the AI, and why. */
  pinPrivate: string
  /** A pinned page that is private now: listed, never sent. */
  pinnedPrivate: string

  /** "Private from AI": the menu toggle, the lock's label. */
  private: string
  /** Why it is private, said on the lock (tooltip and screen readers). */
  privateWhy: Record<AiPrivacyReason, string>
  privateOn: string
  privateOff: string
  privateFailed: string
  /** A project of Tasks: the toggle and its lock. */
  projectPrivate: string
  /** The assistant panel on a private page. */
  panelPrivate: string
  panelPrivateChip: string

  sentLabel: string
  sentContext: string
  sentPages: (count: number) => string
  sentServers: (names: string) => string
  /** The persona's remembered facts that went along (0.8.0 A3). */
  sentMemory: (count: number) => string
  /** A project's or database's own context that went along (0.8.0 A4). */
  sentScope: (kind: ScopeKind, name: string, pages: number) => string

  /** A project's or database's own context (0.8.0 A4): the editor, its triggers and the list in Settings. */
  scopeTitle: (kind: ScopeKind, name: string) => string
  scopeIntro: (kind: ScopeKind) => string
  scopeTextLabel: string
  scopePlaceholder: (kind: ScopeKind) => string
  scopePagesLabel: (cap: number) => string
  scopePagesNone: string
  scopeSearch: string
  scopeSearchNone: string
  scopePinPage: (title: string) => string
  scopeUnpinPage: (title: string) => string
  scopeFull: (cap: number) => string
  scopeSaved: string
  scopeSaveFailed: string
  scopePrivate: (kind: ScopeKind) => string
  scopeKept: (kind: ScopeKind) => string
  cancel: string
  /** The database's ⋯ menu. */
  scopeMenu: string
  /** The project's head on Tasks. */
  scopeHeaderLabel: string
  scopeEdit: string
  scopeNone: string
  /** "340 characters · 2 pinned pages". */
  scopeSummary: (chars: number, pages: number) => string
  scopeListLabel: string
  scopeListHelp: string
  scopeListNone: string
  scopeKind: Record<ScopeKind, string>
  scopeOpen: (name: string) => string
}

export const CONTEXT_COPY: Record<HomeLocale, ContextCopy> = {
  en: {
    contextTitle: 'Context',
    contextIntro:
      'What Claude should know about you in every request from sel: who you are, your work and projects, the names that come up, how you like answers. Like a CLAUDE.md for sel.',
    contextLabel: 'About you',
    contextHelp: 'Goes with every question to Herman and every writing tool. Your preferences here never override the task.',
    contextPlaceholder:
      'I am a product designer at… My main projects are… I write in Portuguese with clients and English in code. Keep answers short, in lists when they help.',
    contextCount: (used, cap) => `${used.toLocaleString('en')} of ${cap.toLocaleString('en')} characters`,
    save: 'Save',
    saved: 'Context saved.',
    saveFailed: 'The context could not be saved.',
    pinnedLabel: 'Pinned pages',
    pinnedHelp: (cap) =>
      `Pages that go along with every request, read fresh each time. Pin up to ${cap} from a page's ⋯ menu ("Use as context for Claude").`,
    pinnedNone: 'No page pinned.',
    unpin: 'Unpin',
    missingPage: 'Page not found (deleted or in the Trash)',
    contextNote: 'Kept on this device only, never synced. Under each answer, sel says what went along with it.',

    toolsTitle: "Claude's tools",
    on: 'On',
    off: 'Off',
    toolsIntro:
      'The MCP servers and claude.ai connectors you set up in Claude Code (such as Veleiro, Gmail or Notion). Turn one on and Herman may use it when you ask him something. All are off until you turn them on.',
    toolsWarning:
      'These tools reach other services with your accounts. With "All tools" Herman can create, change or delete things there (tickets, emails, events) when you ask him to. sel keeps only which ones are on: their addresses and keys stay in Claude Code.',
    scan: 'Find connectors',
    scanning: 'Asking Claude Code…',
    scanHelp: (when) =>
      when
        ? `claude.ai connectors last looked up ${when}. Servers from Claude Code's configuration file are read each time.`
        : 'claude.ai connectors are not listed yet: press Find connectors (it runs "claude mcp list" and takes a little while). Servers from Claude Code\'s configuration file are read each time.',
    scanFailed: 'Claude Code could not list the connectors.',
    loadFailed: 'The servers could not be read.',
    unreadable: "Claude Code's configuration file (.claude.json) could not be read.",
    noServers: 'No server found yet.',
    scope: { claudeai: 'claude.ai connector', user: 'Claude Code, all projects', local: 'Claude Code, one project' },
    access: { read: 'Read only', custom: 'Chosen tools', all: 'All tools' },
    accessHelp: {
      read: 'Only tools whose names say they look things up (get, list, search, read…). Anything else is refused.',
      custom: 'Only the tools you tick below.',
      all: 'Every tool of this server, including those that create, change or delete.'
    },
    loadTools: 'Load tools',
    loadingTools: 'Loading…',
    toolsFailed: 'The tools could not be listed.',
    toolsUnknown: 'Tools not loaded yet: press Load tools. Until then, "Read only" and "Chosen tools" allow nothing.',
    toolsCount: (allowed, found) => `${allowed} of ${found} tools allowed`,
    writeTool: 'changes things',
    allWarning: 'Herman may change things in this service when you ask him to. He still says what he changed.',
    toolsNote:
      'Only questions to Herman use these tools, never the writing tools. Loading tools starts Claude Code once with that server, which may count as one small request.',

    pin: 'Use as context for Claude',
    unpinPage: 'Stop using as context for Claude',
    pinFull: (cap) => `Up to ${cap} pages can be pinned as context. Unpin one in Settings → AI.`,
    pinFailed: 'The page could not be pinned.',
    pinPrivate: 'This page is private from the AI, so it cannot go along as context. Turn off "Private from AI" in its ⋯ menu first.',
    pinnedPrivate: 'Private from AI: kept here, never sent',

    private: 'Private from AI',
    privateWhy: {
      self: 'Private from AI: nothing of it goes to Claude, nor to the apps connected to sel.',
      ancestor: 'Private from AI: it is inside a page that is.',
      project: 'Private from AI: its project is.',
      source: 'Private from AI: it shows a database that is.'
    },
    privateOn: 'Private from AI. Nothing of it goes to Claude, nor to the apps connected to sel.',
    privateOff: 'No longer private from AI.',
    privateFailed: 'Could not change "Private from AI".',
    projectPrivate: 'Project private from AI',
    panelPrivate: 'This page is private from the AI: nothing of it is sent, not even the selection. You can still ask something general.',
    panelPrivateChip: 'Private page: not sent',

    sentLabel: 'Sent along',
    sentContext: 'your context',
    sentPages: (count) => (count === 1 ? '1 pinned page' : `${count} pinned pages`),
    sentServers: (names) => `tools: ${names}`,
    sentMemory: (count) => (count === 1 ? '1 remembered fact' : `${count} remembered facts`),
    sentScope: (kind, name, pages) =>
      `${kind === 'project' ? 'project' : 'database'} “${name}”${pages ? ` (${pages === 1 ? '1 page' : `${pages} pages`})` : ''}`,

    scopeTitle: (kind, name) => `Context for the ${kind === 'project' ? 'project' : 'database'} “${name}”`,
    scopeIntro: (kind) =>
      kind === 'project'
        ? 'Goes along with every request made from a task of this project (or a page inside one), after your general context.'
        : 'Goes along with every request made from this database or one of its rows (or a page inside one), after your general context.',
    scopeTextLabel: 'What Claude should know here',
    scopePlaceholder: (kind) =>
      kind === 'project'
        ? 'Who the client is, the names that come up, decisions already taken, how this project likes its writing…'
        : 'What this database is for, what its properties mean, how its entries are written…',
    scopePagesLabel: (cap) => `Pinned pages (up to ${cap}), read fresh with each request`,
    scopePagesNone: 'No page pinned.',
    scopeSearch: 'Find a page to pin',
    scopeSearchNone: 'No page found.',
    scopePinPage: (title) => `Pin “${title}”`,
    scopeUnpinPage: (title) => `Unpin “${title}”`,
    scopeFull: (cap) => `Up to ${cap} pages can be pinned here.`,
    scopeSaved: 'Context saved.',
    scopeSaveFailed: 'The context could not be saved.',
    scopePrivate: (kind) =>
      kind === 'project'
        ? 'This project is private from the AI: its context is kept, and never sent.'
        : 'This database is private from the AI: its context is kept, and never sent.',
    scopeKept: (kind) =>
      `Kept with the ${kind === 'project' ? 'project' : 'database'}, so it syncs with it. Pages private from the AI are never sent.`,
    cancel: 'Cancel',
    scopeMenu: 'Context for Claude…',
    scopeHeaderLabel: 'Context for Claude',
    scopeEdit: 'Edit',
    scopeNone: 'None yet',
    scopeSummary: (chars, pages) =>
      [chars ? `${chars.toLocaleString('en')} characters` : '', pages ? (pages === 1 ? '1 pinned page' : `${pages} pinned pages`) : '']
        .filter(Boolean)
        .join(' · '),
    scopeListLabel: 'Projects and databases',
    scopeListHelp:
      'A project or database can carry a context of its own, sent only with requests made from inside it. Edit it at the head of a project on Tasks, or from a database’s ⋯ menu.',
    scopeListNone: 'None has a context of its own yet.',
    scopeKind: { project: 'Project', database: 'Database' },
    scopeOpen: (name) => `Open ${name}`
  },
  'pt-BR': {
    contextTitle: 'Contexto',
    contextIntro:
      'O que o Claude deve saber sobre você em todo pedido feito pelo sel: quem você é, seu trabalho e projetos, os nomes que aparecem, como você gosta das respostas. Como um CLAUDE.md do sel.',
    contextLabel: 'Sobre você',
    contextHelp:
      'Vai junto em toda pergunta ao Herman e em toda ferramenta de escrita. Suas preferências aqui nunca passam por cima da tarefa.',
    contextPlaceholder:
      'Sou designer de produto na… Meus projetos principais são… Escrevo em português com clientes e em inglês no código. Respostas curtas, em listas quando ajudar.',
    contextCount: (used, cap) => `${used.toLocaleString('pt-BR')} de ${cap.toLocaleString('pt-BR')} caracteres`,
    save: 'Salvar',
    saved: 'Contexto salvo.',
    saveFailed: 'Não foi possível salvar o contexto.',
    pinnedLabel: 'Páginas fixadas',
    pinnedHelp: (cap) =>
      `Páginas que vão junto em todo pedido, lidas na hora. Fixe até ${cap} pelo menu ⋯ da página ("Usar como contexto para o Claude").`,
    pinnedNone: 'Nenhuma página fixada.',
    unpin: 'Desafixar',
    missingPage: 'Página não encontrada (apagada ou na lixeira)',
    contextNote: 'Fica só neste dispositivo, nunca sincroniza. Embaixo de cada resposta, o sel diz o que foi junto.',

    toolsTitle: 'Ferramentas do Claude',
    on: 'Ligado',
    off: 'Desligado',
    toolsIntro:
      'Os servidores MCP e conectores do claude.ai que você configurou no Claude Code (como Veleiro, Gmail ou Notion). Ligue um e o Herman pode usá-lo quando você perguntar algo. Todos começam desligados.',
    toolsWarning:
      'Essas ferramentas acessam outros serviços com as suas contas. Com "Todas as ferramentas" o Herman pode criar, mudar ou apagar coisas lá (tickets, e-mails, eventos) quando você pedir. O sel guarda só quais estão ligados: endereços e chaves ficam no Claude Code.',
    scan: 'Buscar conectores',
    scanning: 'Perguntando ao Claude Code…',
    scanHelp: (when) =>
      when
        ? `Conectores do claude.ai buscados pela última vez ${when}. Os servidores do arquivo de configuração do Claude Code são lidos toda vez.`
        : 'Os conectores do claude.ai ainda não foram listados: toque em Buscar conectores (roda "claude mcp list" e leva um tempinho). Os servidores do arquivo de configuração do Claude Code são lidos toda vez.',
    scanFailed: 'O Claude Code não conseguiu listar os conectores.',
    loadFailed: 'Não foi possível ler os servidores.',
    unreadable: 'Não foi possível ler o arquivo de configuração do Claude Code (.claude.json).',
    noServers: 'Nenhum servidor encontrado ainda.',
    scope: { claudeai: 'conector do claude.ai', user: 'Claude Code, todos os projetos', local: 'Claude Code, um projeto' },
    access: { read: 'Só leitura', custom: 'Ferramentas escolhidas', all: 'Todas as ferramentas' },
    accessHelp: {
      read: 'Só ferramentas cujo nome diz que consultam algo (get, list, search, read…). O resto é recusado.',
      custom: 'Só as ferramentas que você marcar abaixo.',
      all: 'Todas as ferramentas deste servidor, inclusive as que criam, mudam ou apagam.'
    },
    loadTools: 'Carregar ferramentas',
    loadingTools: 'Carregando…',
    toolsFailed: 'Não foi possível listar as ferramentas.',
    toolsUnknown:
      'Ferramentas ainda não carregadas: toque em Carregar ferramentas. Até lá, "Só leitura" e "Ferramentas escolhidas" não liberam nada.',
    toolsCount: (allowed, found) => `${allowed} de ${found} ferramentas liberadas`,
    writeTool: 'muda coisas',
    allWarning: 'O Herman pode mudar coisas neste serviço quando você pedir. Ele sempre diz o que mudou.',
    toolsNote:
      'Só as perguntas ao Herman usam essas ferramentas, nunca as ferramentas de escrita. Carregar ferramentas abre o Claude Code uma vez com aquele servidor, o que pode contar como um pedido pequeno.',

    pin: 'Usar como contexto para o Claude',
    unpinPage: 'Deixar de usar como contexto para o Claude',
    pinFull: (cap) => `Dá para fixar até ${cap} páginas como contexto. Desafixe uma em Configurações → AI.`,
    pinFailed: 'Não foi possível fixar a página.',
    pinPrivate:
      'Esta página é privada para a AI, então não pode ir junto como contexto. Desligue "Privado para a AI" no menu ⋯ dela antes.',
    pinnedPrivate: 'Privado para a AI: fica aqui, nunca é enviado',

    private: 'Privado para a AI',
    privateWhy: {
      self: 'Privado para a AI: nada disso vai para o Claude nem para os apps conectados ao sel.',
      ancestor: 'Privado para a AI: está dentro de uma página que é.',
      project: 'Privado para a AI: o projeto é.',
      source: 'Privado para a AI: mostra um database que é.'
    },
    privateOn: 'Privado para a AI. Nada disso vai para o Claude nem para os apps conectados ao sel.',
    privateOff: 'Não é mais privado para a AI.',
    privateFailed: 'Não foi possível mudar "Privado para a AI".',
    projectPrivate: 'Projeto privado para a AI',
    panelPrivate: 'Esta página é privada para a AI: nada dela é enviado, nem a seleção. Você ainda pode perguntar algo geral.',
    panelPrivateChip: 'Página privada: não vai junto',

    sentLabel: 'Foi junto',
    sentContext: 'seu contexto',
    sentPages: (count) => (count === 1 ? '1 página fixada' : `${count} páginas fixadas`),
    sentServers: (names) => `ferramentas: ${names}`,
    sentMemory: (count) => (count === 1 ? '1 fato lembrado' : `${count} fatos lembrados`),
    sentScope: (kind, name, pages) =>
      `${kind === 'project' ? 'projeto' : 'database'} “${name}”${pages ? ` (${pages === 1 ? '1 página' : `${pages} páginas`})` : ''}`,

    scopeTitle: (kind, name) => `Contexto ${kind === 'project' ? 'do projeto' : 'do database'} “${name}”`,
    scopeIntro: (kind) =>
      kind === 'project'
        ? 'Vai junto em todo pedido feito a partir de uma tarefa deste projeto (ou de uma página dentro dela), depois do seu contexto geral.'
        : 'Vai junto em todo pedido feito a partir deste database ou de uma linha dele (ou de uma página dentro dela), depois do seu contexto geral.',
    scopeTextLabel: 'O que o Claude deve saber aqui',
    scopePlaceholder: (kind) =>
      kind === 'project'
        ? 'Quem é o cliente, os nomes que aparecem, decisões já tomadas, como este projeto gosta dos textos…'
        : 'Para que serve este database, o que as propriedades querem dizer, como as entradas são escritas…',
    scopePagesLabel: (cap) => `Páginas fixadas (até ${cap}), lidas na hora a cada pedido`,
    scopePagesNone: 'Nenhuma página fixada.',
    scopeSearch: 'Buscar uma página para fixar',
    scopeSearchNone: 'Nenhuma página encontrada.',
    scopePinPage: (title) => `Fixar “${title}”`,
    scopeUnpinPage: (title) => `Desafixar “${title}”`,
    scopeFull: (cap) => `Dá para fixar até ${cap} páginas aqui.`,
    scopeSaved: 'Contexto salvo.',
    scopeSaveFailed: 'Não foi possível salvar o contexto.',
    scopePrivate: (kind) =>
      kind === 'project'
        ? 'Este projeto é privado para a AI: o contexto fica guardado e nunca é enviado.'
        : 'Este database é privado para a AI: o contexto fica guardado e nunca é enviado.',
    scopeKept: (kind) =>
      `Fica junto ${kind === 'project' ? 'do projeto' : 'do database'}, então sincroniza com ele. Páginas privadas para a AI nunca são enviadas.`,
    cancel: 'Cancelar',
    scopeMenu: 'Contexto para o Claude…',
    scopeHeaderLabel: 'Contexto para o Claude',
    scopeEdit: 'Editar',
    scopeNone: 'Nenhum ainda',
    scopeSummary: (chars, pages) =>
      [
        chars ? `${chars.toLocaleString('pt-BR')} caracteres` : '',
        pages ? (pages === 1 ? '1 página fixada' : `${pages} páginas fixadas`) : ''
      ]
        .filter(Boolean)
        .join(' · '),
    scopeListLabel: 'Projetos e databases',
    scopeListHelp:
      'Um projeto ou database pode ter um contexto próprio, enviado só nos pedidos feitos de dentro dele. Edite no topo de um projeto em Tarefas, ou pelo menu ⋯ de um database.',
    scopeListNone: 'Nenhum tem contexto próprio ainda.',
    scopeKind: { project: 'Projeto', database: 'Database' },
    scopeOpen: (name) => `Abrir ${name}`
  }
}

/** "Sent along: your context · 2 pinned pages · tools: Veleiro", or null when nothing went along. */
export function sentLine(sent: AiSent | undefined, copy: ContextCopy): string | null {
  if (!sent) return null
  const parts: string[] = []
  if (sent.context) parts.push(copy.sentContext)
  if (sent.pages.length) parts.push(copy.sentPages(sent.pages.length))
  for (const scope of sent.scopes ?? []) parts.push(copy.sentScope(scope.kind, scope.name, scope.pages.length))
  if (sent.memory) parts.push(copy.sentMemory(sent.memory))
  if (sent.servers.length) parts.push(copy.sentServers(sent.servers.join(', ')))
  return parts.length ? `${copy.sentLabel}: ${parts.join(' · ')}` : null
}

/** The copy said of the chosen persona: written in Herman's words, rewritten for Hermine (shared/persona.ts). */
export function contextCopy(locale: HomeLocale, persona: PersonaId): ContextCopy {
  return personifyCopy(CONTEXT_COPY[locale], persona, locale)
}
