// The words of Settings → AI → Context and Claude's tools, of the page menu's "pin as context"
// and of the line under an answer that says what went along, in English and in Brazilian
// Portuguese, chosen like the home's. Pure: no React, no DOM.
import type { AiSent, McpAccess, McpScope } from '@shared/aiContext'
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

  sentLabel: string
  sentContext: string
  sentPages: (count: number) => string
  sentServers: (names: string) => string
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

    sentLabel: 'Sent along',
    sentContext: 'your context',
    sentPages: (count) => (count === 1 ? '1 pinned page' : `${count} pinned pages`),
    sentServers: (names) => `tools: ${names}`
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

    sentLabel: 'Foi junto',
    sentContext: 'seu contexto',
    sentPages: (count) => (count === 1 ? '1 página fixada' : `${count} páginas fixadas`),
    sentServers: (names) => `ferramentas: ${names}`
  }
}

/** "Sent along: your context · 2 pinned pages · tools: Veleiro", or null when nothing went along. */
export function sentLine(sent: AiSent | undefined, copy: ContextCopy): string | null {
  if (!sent) return null
  const parts: string[] = []
  if (sent.context) parts.push(copy.sentContext)
  if (sent.pages.length) parts.push(copy.sentPages(sent.pages.length))
  if (sent.servers.length) parts.push(copy.sentServers(sent.servers.join(', ')))
  return parts.length ? `${copy.sentLabel}: ${parts.join(' · ')}` : null
}
