// The words of the Finance screen, in English and in Brazilian Portuguese (the language of the
// Home, see home/copy.ts). Pure: no React, no DOM.
import type { HomeLocale } from '@/home/copy'

export interface FinanceCopy {
  title: string
  kicker: string
  lede: string
  loading: string
  failed: string
  nav: { previous: string; next: string; current: string }
  emptyTitle: string
  emptyText: string
  free: string
  freeHint: string
  inAccounts: string
  expected: string
  toPay: string
  accounts: string
  noAccounts: string
  income: string
  bills: string
  received: (day: string) => string
  paid: (day: string) => string
  expectedOn: (day: string | null) => string
  due: (day: string | null) => string
  late: string
  receive: string
  pay: string
  cards: string
  invoice: (month: string) => string
  invoiceDue: (day: string) => string
  invoicePaid: string
  nextInvoice: (month: string, total: string) => string
  invoiceEmpty: string
  onInvoice: (month: string) => string
  refund: string
  filter: string
  everything: string
  noAccount: string
  nothingHere: string
  rawData: string
  rawDataHint: string
  budget: string
  budgetLine: (spent: string, limit: string) => string
  budgetLeft: (left: string, days: number, perWeek: string | null) => string
  left: (amount: string) => string
  over: (amount: string) => string
  noLimit: string
  meter: (category: string, spent: string, limit: string) => string
  boxes: string
  boxGoal: (goal: string) => string
  owed: string
  owesYou: (person: string, amount: string) => string
  youOwe: (person: string, amount: string) => string
  next: string
  nextLine: (income: string, bills: string, budget: string, invoices: string) => string
  nextFree: (amount: string) => string
  entries: string
  noEntries: string
  kinds: Record<'expense' | 'income' | 'transfer' | 'settlement', string>
  planned: string
  instalment: (which: string) => string
  shared: (mine: string) => string
  remove: (what: string) => string
  removed: string
  add: string
  addFailed: string
  added: string
  fields: {
    description: string
    amount: string
    kind: string
    date: string
    category: string
    account: string
    to: string
  }
  setup: string
  setupHint: string
  setupKinds: Record<'account' | 'recurring' | 'budget' | 'box', string>
  setupWhat: string
  save: string
  saved: string
  saveFailed: string
  setupFields: {
    name: string
    type: string
    balance: string
    closingDay: string
    dueDay: string
    kind: string
    day: string
    limit: string
    goal: string
    purpose: string
    yield: string
  }
  accountTypes: Record<'checking' | 'card' | 'cash', string>
  recurringKinds: Record<'expense' | 'income', string>
}

export const FINANCE_COPY: Record<HomeLocale, FinanceCopy> = {
  en: {
    title: 'Finances',
    kicker: 'My month',
    lede: 'What came in, what is still to go out, and what should be left.',
    loading: 'Reading the month…',
    failed: 'The month could not be read.',
    nav: { previous: 'Previous month', next: 'Next month', current: 'This month' },
    emptyTitle: 'Nothing here yet',
    emptyText: 'Start with an account and what it holds, then what comes every month. Or tell Claude, and it enters it for you.',
    free: 'Left at the end of the month',
    freeHint: 'In the accounts, plus income expected, minus bills pending, invoices due and what is left of the budget.',
    inAccounts: 'In the accounts',
    expected: 'Still to come in',
    toPay: 'Still to pay',
    accounts: 'Accounts',
    noAccounts: 'No account yet.',
    income: 'Income',
    bills: 'Fixed bills',
    received: (day) => `received ${day}`,
    paid: (day) => `paid ${day}`,
    expectedOn: (day) => (day ? `expected ${day}` : 'expected'),
    due: (day) => (day ? `due ${day}` : 'pending'),
    late: 'late',
    receive: 'Received',
    pay: 'Paid',
    cards: 'Cards',
    invoice: (month) => `Invoice of ${month}`,
    invoiceDue: (day) => `due ${day}`,
    invoicePaid: 'paid',
    nextInvoice: (month, total) => `The one of ${month} already holds ${total}.`,
    invoiceEmpty: 'Nothing on this invoice.',
    onInvoice: (month) => `invoice of ${month}`,
    refund: 'refund',
    filter: 'Show',
    everything: 'Everything',
    noAccount: 'No account',
    nothingHere: 'Nothing here this month.',
    rawData: 'Open the databases',
    rawDataHint: 'Everything here is kept in five databases, out of the sidebar. Open them to see or fix a row by hand.',
    budget: 'Day-to-day budget',
    budgetLine: (spent, limit) => `${spent} of ${limit}`,
    budgetLeft: (left, days, perWeek) =>
      perWeek && days > 0 ? `${left} left for ${days} ${days === 1 ? 'day' : 'days'}: ${perWeek} a week.` : `${left} left.`,
    left: (amount) => `${amount} left`,
    over: (amount) => `${amount} over`,
    noLimit: 'no limit set',
    meter: (category, spent, limit) => `${category}: ${spent} of ${limit}`,
    boxes: 'Boxes',
    boxGoal: (goal) => `of ${goal}`,
    owed: 'Shared with others',
    owesYou: (person, amount) => `${person} owes you ${amount}`,
    youOwe: (person, amount) => `You owe ${person} ${amount}`,
    next: 'Next month',
    nextLine: (income, bills, budget, invoices) =>
      `Income ${income}, bills ${bills}, budget ${budget}, invoices already known ${invoices}.`,
    nextFree: (amount) => `${amount} free`,
    entries: 'Entries of the month',
    noEntries: 'Nothing entered this month.',
    kinds: { expense: 'expense', income: 'income', transfer: 'transfer', settlement: 'settlement' },
    planned: 'planned',
    instalment: (which) => `instalment ${which}`,
    shared: (mine) => `your part ${mine}`,
    remove: (what) => `Move ${what} to the trash`,
    removed: 'Moved to the trash.',
    add: 'Add',
    addFailed: 'It could not be added.',
    added: 'Added.',
    fields: {
      description: 'What',
      amount: 'Amount',
      kind: 'Kind',
      date: 'Date',
      category: 'Category',
      account: 'Account or card',
      to: 'To (transfer)'
    },
    setup: 'Accounts, bills, budget and boxes',
    setupHint: 'A name that already exists is changed; a new one is added.',
    setupKinds: { account: 'Account or card', recurring: 'Fixed bill or income', budget: 'Budget limit', box: 'Box' },
    setupWhat: 'What to set up',
    save: 'Save',
    saved: 'Saved.',
    saveFailed: 'It could not be saved.',
    setupFields: {
      name: 'Name',
      type: 'Type',
      balance: 'Balance now',
      closingDay: 'Closes on day',
      dueDay: 'Due on day',
      kind: 'Kind',
      day: 'Day of the month',
      limit: 'Limit a month',
      goal: 'Goal',
      purpose: 'What it is for',
      yield: 'Yield a month (%)'
    },
    accountTypes: { checking: 'Account', card: 'Credit card', cash: 'Cash' },
    recurringKinds: { expense: 'Bill', income: 'Income' }
  },
  'pt-BR': {
    title: 'Finanças',
    kicker: 'Meu mês',
    lede: 'O que entrou, o que ainda sai e o que deve sobrar.',
    loading: 'Lendo o mês…',
    failed: 'Não deu para ler o mês.',
    nav: { previous: 'Mês anterior', next: 'Próximo mês', current: 'Este mês' },
    emptyTitle: 'Nada por aqui ainda',
    emptyText: 'Comece por uma conta e o saldo dela, depois o que vem todo mês. Ou diga ao Claude, e ele lança para você.',
    free: 'Sobra prevista no fim do mês',
    freeHint: 'O que está nas contas, mais o que ainda entra, menos as contas a pagar, as faturas que vencem e o que resta do orçamento.',
    inAccounts: 'Nas contas',
    expected: 'Ainda entra',
    toPay: 'Ainda a pagar',
    accounts: 'Contas',
    noAccounts: 'Nenhuma conta ainda.',
    income: 'Entradas',
    bills: 'Contas fixas',
    received: (day) => `recebida em ${day}`,
    paid: (day) => `paga em ${day}`,
    expectedOn: (day) => (day ? `prevista para ${day}` : 'prevista'),
    due: (day) => (day ? `vence em ${day}` : 'a pagar'),
    late: 'atrasada',
    receive: 'Recebi',
    pay: 'Paguei',
    cards: 'Cartões',
    invoice: (month) => `Fatura de ${month}`,
    invoiceDue: (day) => `vence em ${day}`,
    invoicePaid: 'paga',
    nextInvoice: (month, total) => `A de ${month} já tem ${total}.`,
    invoiceEmpty: 'Nada nesta fatura.',
    onInvoice: (month) => `fatura de ${month}`,
    refund: 'estorno',
    filter: 'Mostrar',
    everything: 'Tudo',
    noAccount: 'Sem conta',
    nothingHere: 'Nada aqui neste mês.',
    rawData: 'Abrir os bancos de dados',
    rawDataHint: 'Tudo aqui fica em cinco bancos de dados, fora da barra lateral. Abra para ver ou corrigir uma linha à mão.',
    budget: 'Orçamento do dia a dia',
    budgetLine: (spent, limit) => `${spent} de ${limit}`,
    budgetLeft: (left, days, perWeek) =>
      perWeek && days > 0 ? `Restam ${left} para ${days} ${days === 1 ? 'dia' : 'dias'}: ${perWeek} por semana.` : `Restam ${left}.`,
    left: (amount) => `restam ${amount}`,
    over: (amount) => `${amount} acima`,
    noLimit: 'sem limite definido',
    meter: (category, spent, limit) => `${category}: ${spent} de ${limit}`,
    boxes: 'Caixinhas',
    boxGoal: (goal) => `de ${goal}`,
    owed: 'Dividido com outras pessoas',
    owesYou: (person, amount) => `${person} te deve ${amount}`,
    youOwe: (person, amount) => `Você deve ${amount} para ${person}`,
    next: 'Próximo mês',
    nextLine: (income, bills, budget, invoices) =>
      `Entradas ${income}, contas ${bills}, orçamento ${budget}, faturas já conhecidas ${invoices}.`,
    nextFree: (amount) => `${amount} livres`,
    entries: 'Lançamentos do mês',
    noEntries: 'Nada lançado neste mês.',
    kinds: { expense: 'gasto', income: 'receita', transfer: 'transferência', settlement: 'acerto' },
    planned: 'previsto',
    instalment: (which) => `parcela ${which}`,
    shared: (mine) => `sua parte ${mine}`,
    remove: (what) => `Mover ${what} para a lixeira`,
    removed: 'Foi para a lixeira.',
    add: 'Lançar',
    addFailed: 'Não deu para lançar.',
    added: 'Lançado.',
    fields: {
      description: 'O quê',
      amount: 'Valor',
      kind: 'Tipo',
      date: 'Data',
      category: 'Categoria',
      account: 'Conta ou cartão',
      to: 'Para (transferência)'
    },
    setup: 'Contas, contas fixas, orçamento e caixinhas',
    setupHint: 'Um nome que já existe é alterado; um novo é criado.',
    setupKinds: { account: 'Conta ou cartão', recurring: 'Conta fixa ou receita', budget: 'Limite do orçamento', box: 'Caixinha' },
    setupWhat: 'O que cadastrar',
    save: 'Salvar',
    saved: 'Salvo.',
    saveFailed: 'Não deu para salvar.',
    setupFields: {
      name: 'Nome',
      type: 'Tipo',
      balance: 'Saldo agora',
      closingDay: 'Fecha no dia',
      dueDay: 'Vence no dia',
      kind: 'Tipo',
      day: 'Dia do mês',
      limit: 'Limite por mês',
      goal: 'Meta',
      purpose: 'Para quê',
      yield: 'Rende ao mês (%)'
    },
    accountTypes: { checking: 'Conta', card: 'Cartão de crédito', cash: 'Dinheiro' },
    recurringKinds: { expense: 'Conta', income: 'Receita' }
  }
}
