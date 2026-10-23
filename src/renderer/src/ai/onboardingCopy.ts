// The words of the persona's introduction (0.8.0 A1), said by the persona itself, in English and in
// Brazilian Portuguese. Written in Herman's words and said of the chosen persona (shared/persona.ts);
// where a line names the other persona, the name comes in as a parameter. Pure: no React, no DOM.
import type { PersonaId } from '@shared/herman'
import { personifyCopy } from '@shared/persona'
import type { HomeLocale } from '@/home/copy'

export type OnboardingStep = 'claude' | 'persona' | 'about' | 'pages' | 'tools'
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['claude', 'persona', 'about', 'pages', 'tools']

export interface OnboardingCopy {
  title: string
  stepOf: (step: number, total: number) => string
  stepNames: Record<OnboardingStep, string>
  /** What the persona says at each step; `other` is the other persona's name. */
  say: {
    claude: string
    persona: (other: string) => string
    about: string
    pages: string
    tools: string
  }
  back: string
  next: string
  skipStep: string
  skipAll: string
  finish: string
  done: string

  checking: string
  ready: (version: string) => string
  notFound: string
  install: string
  signIn: string
  checkAgain: string
  choose: string
  checkFailed: string
  model: string
  modelHelp: string
  modelDefault: string

  persona: string
  outfit: string

  who: string
  whoHint: string
  work: string
  workHint: string
  projects: string
  projectsHelp: string
  projectsNone: string
  otherProjects: string
  otherProjectsHint: string
  length: string
  lengths: Record<'short' | 'detailed' | 'any', string>
  language: string
  languages: Record<'same' | 'pt-BR' | 'en' | 'any', string>
  tone: string
  tones: Record<'direct' | 'warm' | 'formal' | 'any', string>
  draft: string
  draftEmpty: string
  draftAfter: (chars: number) => string
  draftNew: string
  tooLong: (cap: number) => string
  saveContext: string
  contextSaved: string
  contextSame: string
  saveFailed: string

  suggested: string
  suggestedHelp: (cap: number) => string
  noSuggestions: string
  loading: string
  pin: (title: string) => string
  pinned: string
  pinFull: (cap: number) => string
  pinPrivate: string
  pinFailed: string

  noServers: string
  serversHelp: string
  readOnly: string
  scan: string
  scanning: string
  scanFailed: string
  openSettings: string
  serversFailed: string

  /** Settings → AI: the way back to the introduction. */
  introLabel: string
  introHelp: string
  redo: string
}

export const ONBOARDING_COPY: Record<HomeLocale, OnboardingCopy> = {
  en: {
    title: 'Meet Herman',
    stepOf: (step, total) => `Step ${step} of ${total}`,
    stepNames: { claude: 'Claude Code', persona: 'Persona', about: 'About you', pages: 'Pages', tools: 'Tools' },
    say: {
      claude:
        'Hello, I am Herman. I answer through Claude Code, the app on this computer signed in with your own Claude account. Let me check that everything is in place.',
      persona: (other) =>
        `Would you rather talk to me, or to ${other}? Choose an outfit too: only the look changes, the voice and the habits stay the same.`,
      about:
        'Tell me a little about yourself. I will turn it into your context, which goes along with every request. You read it, and can change it, before it is saved.',
      pages:
        'Is there a page I should always keep in mind? These are the ones you come back to and edit most. Pages private from the AI are never offered.',
      tools:
        'Last, and only if you like: the tools you set up in Claude Code, such as MCP servers and claude.ai connectors. Turned on here, I may only look things up with them.'
    },
    back: 'Back',
    next: 'Next',
    skipStep: 'Skip this step',
    skipAll: 'Skip the introduction',
    finish: 'Finish',
    done: 'All set. Ask me anything with Ctrl+J, or by clicking me.',

    checking: 'Looking for Claude Code…',
    ready: (version) => `Claude Code ${version} is ready.`,
    notFound: 'Claude Code was not found on this computer.',
    install: 'Install it with this command in a terminal (it needs Node.js):',
    signIn: 'Then run claude once in a terminal and sign in with your Claude account.',
    checkAgain: 'Check again',
    choose: 'Choose the claude program…',
    checkFailed: 'Could not check for Claude Code.',
    model: 'Model',
    modelHelp: 'Which Claude model answers. The default is the one Claude Code uses.',
    modelDefault: 'Claude Code’s default',

    persona: 'Persona',
    outfit: 'Outfit',

    who: 'Who are you?',
    whoHint: 'Your name and what you do: “Ana, product designer”',
    work: 'Your work',
    workHint: 'Where, and on what: “a fintech in São Paulo, the mobile app”',
    projects: 'Your projects',
    projectsHelp: 'From Tasks: tick the ones that matter.',
    projectsNone: 'No project in Tasks yet.',
    otherProjects: 'Other projects',
    otherProjectsHint: 'Separated by commas',
    length: 'Answers',
    lengths: { short: 'Short', detailed: 'Detailed', any: 'Either' },
    language: 'Language',
    languages: { same: 'Same as mine', 'pt-BR': 'Português', en: 'English', any: 'Either' },
    tone: 'Tone',
    tones: { direct: 'Direct', warm: 'Warm', formal: 'Formal', any: 'Either' },
    draft: 'Your context, as it will be saved',
    draftEmpty: 'Answer a question above and the text appears here.',
    draftAfter: (chars) => `It goes after the context you already have (${chars.toLocaleString('en')} characters), which stays as it is.`,
    draftNew: 'Change it as you like before saving.',
    tooLong: (cap) => `Together with what you already have, it passes ${cap.toLocaleString('en')} characters: shorten it.`,
    saveContext: 'Save and continue',
    contextSaved: 'Context saved.',
    contextSame: 'Your context already says this.',
    saveFailed: 'The context could not be saved.',

    suggested: 'Pages to pin',
    suggestedHelp: (cap) =>
      `Up to ${cap} pages, read fresh with each request. You can change them later in a page’s ⋯ menu or in Settings → AI.`,
    noSuggestions: 'No page to suggest yet.',
    loading: 'Looking…',
    pin: (title) => `Pin “${title}”`,
    pinned: 'Pinned',
    pinFull: (cap) => `Up to ${cap} pages can be pinned.`,
    pinPrivate: 'This page is private from the AI, so it cannot go along.',
    pinFailed: 'The page could not be pinned.',

    noServers: 'No tool set up in Claude Code was found.',
    serversHelp: 'Read only: only tools whose names say they look things up. To allow more, or to turn one off, go to Settings → AI.',
    readOnly: 'On, read only',
    scan: 'Find claude.ai connectors',
    scanning: 'Asking Claude Code…',
    scanFailed: 'Claude Code could not list the connectors.',
    openSettings: 'Open Settings → AI',
    serversFailed: 'The tools could not be changed.',

    introLabel: 'Introduction',
    introHelp: 'Herman’s short introduction: Claude Code, the persona, your context, pinned pages and tools. Every step can be skipped.',
    redo: 'Redo the introduction'
  },
  'pt-BR': {
    title: 'Conheça o Herman',
    stepOf: (step, total) => `Passo ${step} de ${total}`,
    stepNames: { claude: 'Claude Code', persona: 'Persona', about: 'Sobre você', pages: 'Páginas', tools: 'Ferramentas' },
    say: {
      claude:
        'Olá, eu sou o Herman. Eu respondo pelo Claude Code, o app deste computador conectado à sua conta do Claude. Deixa eu conferir se está tudo no lugar.',
      persona: (other) =>
        `Prefere conversar comigo ou com ${other === 'Hermine' ? 'a' : 'o'} ${other}? Escolha uma roupa também: só a aparência muda, a voz e os hábitos continuam os mesmos.`,
      about:
        'Me conte um pouco sobre você. Eu transformo isso no seu contexto, que vai junto em todo pedido. Você lê, e pode mudar, antes de salvar.',
      pages:
        'Tem alguma página que eu deva ter sempre em mente? Estas são as que você mais abre e edita. Páginas privadas para a AI nunca são sugeridas.',
      tools:
        'Por último, e só se você quiser: as ferramentas que você configurou no Claude Code, como servidores MCP e conectores do claude.ai. Ligadas aqui, eu só posso consultar coisas com elas.'
    },
    back: 'Voltar',
    next: 'Próximo',
    skipStep: 'Pular este passo',
    skipAll: 'Pular a apresentação',
    finish: 'Concluir',
    done: 'Tudo pronto. Me pergunte o que quiser com Ctrl+J, ou clicando em mim.',

    checking: 'Procurando o Claude Code…',
    ready: (version) => `O Claude Code ${version} está pronto.`,
    notFound: 'O Claude Code não foi encontrado neste computador.',
    install: 'Instale com este comando num terminal (precisa do Node.js):',
    signIn: 'Depois rode claude uma vez num terminal e entre com a sua conta do Claude.',
    checkAgain: 'Conferir de novo',
    choose: 'Escolher o programa claude…',
    checkFailed: 'Não foi possível procurar o Claude Code.',
    model: 'Modelo',
    modelHelp: 'Qual modelo do Claude responde. O padrão é o que o Claude Code usa.',
    modelDefault: 'O padrão do Claude Code',

    persona: 'Persona',
    outfit: 'Roupa',

    who: 'Quem é você?',
    whoHint: 'Seu nome e o que você faz: “Ana, designer de produto”',
    work: 'Seu trabalho',
    workHint: 'Onde, e no quê: “uma fintech em São Paulo, o app de celular”',
    projects: 'Seus projetos',
    projectsHelp: 'De Tarefas: marque os que importam.',
    projectsNone: 'Nenhum projeto em Tarefas ainda.',
    otherProjects: 'Outros projetos',
    otherProjectsHint: 'Separados por vírgula',
    length: 'Respostas',
    lengths: { short: 'Curtas', detailed: 'Detalhadas', any: 'Tanto faz' },
    language: 'Idioma',
    languages: { same: 'O mesmo que eu usar', 'pt-BR': 'Português', en: 'English', any: 'Tanto faz' },
    tone: 'Tom',
    tones: { direct: 'Direto', warm: 'Caloroso', formal: 'Formal', any: 'Tanto faz' },
    draft: 'Seu contexto, como vai ser salvo',
    draftEmpty: 'Responda uma pergunta acima e o texto aparece aqui.',
    draftAfter: (chars) => `Entra depois do contexto que você já tem (${chars.toLocaleString('pt-BR')} caracteres), que fica como está.`,
    draftNew: 'Mude como quiser antes de salvar.',
    tooLong: (cap) => `Junto com o que você já tem, passa de ${cap.toLocaleString('pt-BR')} caracteres: encurte.`,
    saveContext: 'Salvar e continuar',
    contextSaved: 'Contexto salvo.',
    contextSame: 'Seu contexto já diz isso.',
    saveFailed: 'Não foi possível salvar o contexto.',

    suggested: 'Páginas para fixar',
    suggestedHelp: (cap) =>
      `Até ${cap} páginas, lidas na hora a cada pedido. Dá para mudar depois pelo menu ⋯ da página ou em Configurações → AI.`,
    noSuggestions: 'Nenhuma página para sugerir ainda.',
    loading: 'Procurando…',
    pin: (title) => `Fixar “${title}”`,
    pinned: 'Fixada',
    pinFull: (cap) => `Dá para fixar até ${cap} páginas.`,
    pinPrivate: 'Esta página é privada para a AI, então não pode ir junto.',
    pinFailed: 'Não foi possível fixar a página.',

    noServers: 'Nenhuma ferramenta configurada no Claude Code foi encontrada.',
    serversHelp:
      'Só leitura: só ferramentas cujo nome diz que consultam algo. Para liberar mais, ou desligar uma, vá em Configurações → AI.',
    readOnly: 'Ligado, só leitura',
    scan: 'Buscar conectores do claude.ai',
    scanning: 'Perguntando ao Claude Code…',
    scanFailed: 'O Claude Code não conseguiu listar os conectores.',
    openSettings: 'Abrir Configurações → AI',
    serversFailed: 'Não foi possível mudar as ferramentas.',

    introLabel: 'Apresentação',
    introHelp:
      'A apresentação curta do Herman: Claude Code, a persona, seu contexto, páginas fixadas e ferramentas. Dá para pular qualquer passo.',
    redo: 'Refazer apresentação'
  }
}

/** The copy said of the chosen persona. */
export function onboardingCopy(locale: HomeLocale, persona: PersonaId): OnboardingCopy {
  return personifyCopy(ONBOARDING_COPY[locale], persona, locale)
}
