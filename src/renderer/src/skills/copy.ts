// The words of the Skills screen, in the two languages of the app.
import type { HomeLocale } from '@/home/copy'

export interface SkillsCopy {
  kicker: string
  title: string
  lede: string
  loading: string
  failed: string
  yours: string
  none: string
  ofSel: string
  ofSelHint: string
  newSkill: string
  name: string
  namePlaceholder: string
  nameHint: (name: string) => string
  nameTaken: string
  nameInvalid: string
  description: string
  descriptionPlaceholder: string
  descriptionHint: string
  create: string
  createFailed: string
  open: string
  copyFile: string
  copied: string
  copyFailed: string
  describe: string
  save: string
  cancel: string
  saveFailed: string
  noDescription: string
  remove: string
  removed: (name: string) => string
  removeFailed: string
  read: string
  changed: (when: string) => string
  howTitle: string
  how: string[]
}

export const SKILLS_COPY: Record<HomeLocale, SkillsCopy> = {
  en: {
    kicker: 'Block',
    title: 'Skills',
    lede: 'What you do not want to explain twice, written once. Claude lists them over MCP, loads the one that fits and follows it. Each is a page: its history keeps every version.',
    loading: 'Reading the skills…',
    failed: 'The skills could not be read.',
    yours: 'Yours',
    none: 'No skill of yours yet. Make one here, or ask Claude: “use skill-creator to make a skill for…”.',
    ofSel: 'From sel',
    ofSelHint: 'How to work each block, and how to make a skill. They come with sel and cannot be changed.',
    newSkill: 'New skill',
    name: 'Name',
    namePlaceholder: 'close-the-month',
    nameHint: (name) => `It will be called ${name}.`,
    nameTaken: 'There is already a skill with that name.',
    nameInvalid: 'A name is lowercase words joined by hyphens.',
    description: 'What it does, and when to use it',
    descriptionPlaceholder: 'Closes the month in Finanças. Use when I say “close the month”.',
    descriptionHint: 'One sentence. It is all Claude sees when deciding whether to load the skill.',
    create: 'Create and write it',
    createFailed: 'The skill could not be created.',
    open: 'Open',
    copyFile: 'Copy as SKILL.md',
    copied: 'Copied.',
    copyFailed: 'The skill could not be copied.',
    describe: 'Description',
    save: 'Save',
    cancel: 'Cancel',
    saveFailed: 'The description could not be saved.',
    noDescription: 'No description yet: Claude cannot tell when to use it.',
    remove: 'Delete',
    removed: (name) => `${name} went to the trash.`,
    removeFailed: 'The skill could not be deleted.',
    read: 'Read it',
    changed: (when) => `changed ${when}`,
    howTitle: 'In Claude',
    how: [
      '“What skills do I have in sel?”',
      '“Use skill-creator: I want a skill for my weekly review.”',
      '“Use the skill close-the-month.”'
    ]
  },
  'pt-BR': {
    kicker: 'Bloco',
    title: 'Skills',
    lede: 'O que você não quer explicar duas vezes, escrito uma vez. O Claude lista pelo MCP, carrega a que serve e segue. Cada uma é uma página: o histórico guarda todas as versões.',
    loading: 'Lendo as skills…',
    failed: 'Não foi possível ler as skills.',
    yours: 'Suas',
    none: 'Nenhuma skill sua ainda. Crie aqui, ou peça ao Claude: “use a skill-creator para criar uma skill de…”.',
    ofSel: 'Do sel',
    ofSelHint: 'Como operar cada bloco, e como criar uma skill. Vêm com o sel e não podem ser alteradas.',
    newSkill: 'Nova skill',
    name: 'Nome',
    namePlaceholder: 'fechar-o-mes',
    nameHint: (name) => `Vai se chamar ${name}.`,
    nameTaken: 'Já existe uma skill com esse nome.',
    nameInvalid: 'Um nome são palavras minúsculas unidas por hífen.',
    description: 'O que faz, e quando usar',
    descriptionPlaceholder: 'Fecha o mês nas Finanças. Use quando eu disser “fechar o mês”.',
    descriptionHint: 'Uma frase. É tudo o que o Claude vê para decidir se carrega a skill.',
    create: 'Criar e escrever',
    createFailed: 'Não foi possível criar a skill.',
    open: 'Abrir',
    copyFile: 'Copiar como SKILL.md',
    copied: 'Copiado.',
    copyFailed: 'Não foi possível copiar a skill.',
    describe: 'Descrição',
    save: 'Salvar',
    cancel: 'Cancelar',
    saveFailed: 'Não foi possível salvar a descrição.',
    noDescription: 'Sem descrição ainda: o Claude não sabe quando usar.',
    remove: 'Excluir',
    removed: (name) => `${name} foi para a lixeira.`,
    removeFailed: 'Não foi possível excluir a skill.',
    read: 'Ler',
    changed: (when) => `alterada ${when}`,
    howTitle: 'No Claude',
    how: [
      '“Quais skills eu tenho no sel?”',
      '“Use a skill-creator: quero uma skill para a minha revisão semanal.”',
      '“Use a skill fechar-o-mes.”'
    ]
  }
}
