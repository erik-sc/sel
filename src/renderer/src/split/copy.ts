// The words of the household screen ("Divisão de contas"), in English and in Brazilian
// Portuguese (the language of the Home, see home/copy.ts). Pure: no React, no DOM.
import type { HomeLocale } from '@/home/copy'

export interface SplitCopy {
  title: string
  kicker: (partner: string) => string
  lede: string
  loading: string
  failed: string
  nav: { previous: string; next: string; current: string }
  me: string
  setupTitle: string
  setupText: string
  partner: string
  myShare: string
  start: string
  even: string
  evenHint: (partner: string) => string
  theyOwe: (partner: string) => string
  youOwe: (partner: string) => string
  allMonths: string
  settle: (amount: string) => string
  settled: string
  settleFailed: string
  month: string
  total: string
  count: (n: number) => string
  part: (who: string) => string
  paid: (amount: string) => string
  byCategory: string
  meter: (category: string, amount: string) => string
  bills: string
  noBills: string
  billNote: (payer: string, mine: number, day: number | null) => string
  launch: string
  launched: (day: string) => string
  launchFailed: string
  expenses: string
  noExpenses: (month: string) => string
  parts: (mine: string, partner: string, theirs: string) => string
  paidBy: (who: string) => string
  pays: (who: string) => string
  add: string
  submit: string
  added: string
  addFailed: string
  fields: {
    description: string
    amount: string
    date: string
    category: string
    paidBy: string
    how: string
    myPart: string
    account: string
  }
  how: Record<'default' | 'mine' | 'theirs' | 'custom', (partner: string, mine: number) => string>
  newBill: string
  billFields: { name: string; amount: string; day: string; myShare: string }
  save: string
  saved: string
  saveFailed: string
  settlements: string
  settlementLine: (from: string, to: string) => string
  settings: string
  settingsHint: string
  receiptHint: string
}

export const SPLIT_COPY: Record<HomeLocale, SplitCopy> = {
  en: {
    title: 'Shared bills',
    kicker: (partner) => (partner ? `You and ${partner}` : 'The household'),
    lede: 'Who paid what, each one’s part, and who owes whom.',
    loading: 'Reading the month…',
    failed: 'The month could not be read.',
    nav: { previous: 'Previous month', next: 'Next month', current: 'This month' },
    me: 'You',
    setupTitle: 'Who do you share the household with?',
    setupText: 'One person. Their name is what the shared expenses will carry, so it stays once the first is entered.',
    partner: 'Their name',
    myShare: 'Your part of what is shared (%)',
    start: 'Start',
    even: 'You are even',
    evenHint: (partner) => `Nothing pending between you and ${partner}.`,
    theyOwe: (partner) => `${partner} owes you`,
    youOwe: (partner) => `You owe ${partner}`,
    allMonths: 'The balance of every month, not this one alone.',
    settle: (amount) => `Record a payment of ${amount}`,
    settled: 'Payment recorded.',
    settleFailed: 'The payment could not be recorded.',
    month: 'The month',
    total: 'Total',
    count: (n) => `${n} ${n === 1 ? 'expense' : 'expenses'}`,
    part: (who) => `${who}: part`,
    paid: (amount) => `paid ${amount}`,
    byCategory: 'By category',
    meter: (category, amount) => `${category}: ${amount}`,
    bills: 'Fixed bills of the month',
    noBills: 'No fixed bill yet: rent, power, internet…',
    billNote: (payer, mine, day) => `${payer} · ${mine}/${100 - mine}${day ? ` · day ${day}` : ''}`,
    launch: 'Launch',
    launched: (day) => `launched ${day}`,
    launchFailed: 'It could not be launched.',
    expenses: 'Expenses',
    noExpenses: (month) => `Nothing in ${month}.`,
    parts: (mine, partner, theirs) => `you ${mine} · ${partner} ${theirs}`,
    paidBy: (who) => `${who} paid`,
    pays: (who) => (who === 'You' ? 'You pay' : `${who} pays`),
    add: 'New expense',
    submit: 'Add expense',
    added: 'Added.',
    addFailed: 'It could not be added.',
    fields: {
      description: 'What',
      amount: 'Total',
      date: 'Date',
      category: 'Category',
      paidBy: 'Who paid',
      how: 'How to divide',
      myPart: 'Your part (exact parts)',
      account: 'Your account (if you paid)'
    },
    how: {
      default: (_partner, mine) => `The usual: ${mine}/${100 - mine}`,
      mine: () => 'All yours (they paid it for you)',
      theirs: (partner) => `All ${partner}’s (you paid it for them)`,
      custom: () => 'Exact parts'
    },
    newBill: 'Fixed bills: add or change',
    billFields: { name: 'Name', amount: 'Usual amount', day: 'Due on day', myShare: 'Your part (%)' },
    save: 'Save',
    saved: 'Saved.',
    saveFailed: 'It could not be saved.',
    settlements: 'Payments between you',
    settlementLine: (from, to) => `${from} → ${to}`,
    settings: 'Settings',
    settingsHint: 'The usual division applies to what is entered from now on.',
    receiptHint: 'A receipt line by line: send Claude a photo and say whose each item is.'
  },
  'pt-BR': {
    title: 'Divisão de contas',
    kicker: (partner) => (partner ? `Você e ${partner}` : 'A casa'),
    lede: 'Quem pagou o quê, a parte de cada um e quem deve para quem.',
    loading: 'Lendo o mês…',
    failed: 'Não deu para ler o mês.',
    nav: { previous: 'Mês anterior', next: 'Próximo mês', current: 'Este mês' },
    me: 'Você',
    setupTitle: 'Com quem você divide a casa?',
    setupText: 'Uma pessoa. O nome dela é o que os gastos divididos vão levar, então fica como está depois do primeiro lançamento.',
    partner: 'Nome dela ou dele',
    myShare: 'Sua parte do que é dividido (%)',
    start: 'Começar',
    even: 'Vocês estão quites',
    evenHint: (partner) => `Nada pendente entre você e ${partner}.`,
    theyOwe: (partner) => `${partner} deve para você`,
    youOwe: (partner) => `Você deve para ${partner}`,
    allMonths: 'Saldo acumulado de todos os meses, não só deste.',
    settle: (amount) => `Registrar acerto de ${amount}`,
    settled: 'Acerto registrado.',
    settleFailed: 'Não deu para registrar o acerto.',
    month: 'O mês',
    total: 'Total',
    count: (n) => `${n} ${n === 1 ? 'gasto' : 'gastos'}`,
    part: (who) => `${who}: parte`,
    paid: (amount) => `pagou ${amount}`,
    byCategory: 'Por categoria',
    meter: (category, amount) => `${category}: ${amount}`,
    bills: 'Contas fixas do mês',
    noBills: 'Nenhuma conta fixa ainda: aluguel, luz, internet…',
    billNote: (payer, mine, day) => `${payer} · ${mine}/${100 - mine}${day ? ` · dia ${day}` : ''}`,
    launch: 'Lançar',
    launched: (day) => `lançada em ${day}`,
    launchFailed: 'Não deu para lançar.',
    expenses: 'Gastos',
    noExpenses: (month) => `Nada em ${month}.`,
    parts: (mine, partner, theirs) => `você ${mine} · ${partner} ${theirs}`,
    paidBy: (who) => `${who} pagou`,
    pays: (who) => `${who} paga`,
    add: 'Novo gasto',
    submit: 'Lançar gasto',
    added: 'Lançado.',
    addFailed: 'Não deu para lançar.',
    fields: {
      description: 'O quê',
      amount: 'Total',
      date: 'Data',
      category: 'Categoria',
      paidBy: 'Quem pagou',
      how: 'Como dividir',
      myPart: 'Sua parte (valores exatos)',
      account: 'Sua conta (se você pagou)'
    },
    how: {
      default: (_partner, mine) => `Padrão: ${mine}/${100 - mine}`,
      mine: () => 'Só seu (pagaram para você)',
      theirs: (partner) => `Só de ${partner} (você pagou)`,
      custom: () => 'Valores exatos'
    },
    newBill: 'Contas fixas: cadastrar ou alterar',
    billFields: { name: 'Nome', amount: 'Valor de costume', day: 'Vence no dia', myShare: 'Sua parte (%)' },
    save: 'Salvar',
    saved: 'Salvo.',
    saveFailed: 'Não deu para salvar.',
    settlements: 'Acertos entre vocês',
    settlementLine: (from, to) => `${from} → ${to}`,
    settings: 'Ajustes',
    settingsHint: 'A divisão padrão vale para o que for lançado daqui em diante.',
    receiptHint: 'Nota fiscal item por item: mande a foto para o Claude e diga de quem é cada item.'
  }
}
