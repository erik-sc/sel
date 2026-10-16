// Personal finances: transactions in one ledger (money in and money out in two columns, like a
// bank statement), linked to a category with a monthly budget and to an account. The page on
// top reads the month from them: a summary, the transactions, the budget and the fixed bills.
//
// Rollups in sel sum every linked row (they cannot be limited to a month), so a category
// compares its budget with its average monthly spending since its first transaction; the month
// itself is read through views filtered to "this month".
import { asc, b, calc, callout, chooser, database, desc, divider, h2, line, linked, ofMonth, opt, p, page, prop, row, schema, views, where } from './build'
import type { Template, TemplateLocale, TemplateRow } from './model'

export function finances(locale: TemplateLocale): Template {
  const t = chooser(locale)

  // ---- names the formulas and calculations read (a select is read by its option's name)
  const IN = t('Entrada', 'Income')
  const OUT = t('Saída', 'Expense')

  const entries = schema(
    prop.title(t('Descrição', 'Description')),
    prop.date('date', t('Data', 'Date')),
    prop.number('income', IN, 'currency'),
    prop.number('expense', OUT, 'currency'),
    prop.relation('category', t('Categoria', 'Category'), 'categories', { synced: 'entries', one: true }),
    prop.relation('account', t('Conta', 'Account'), 'accounts', { synced: 'entries', one: true }),
    prop.checkbox('recurring', t('Recorrente', 'Recurring')),
    prop.formula('kind', t('Tipo', 'Type'), `if(empty(prop("expense")), "${t('↑ Entrada', '↑ In')}", "${t('↓ Saída', '↓ Out')}")`),
    prop.text('note', t('Observação', 'Note'))
  )

  const categories = schema(
    prop.title(t('Categoria', 'Category')),
    prop.select('group', t('Grupo', 'Group'), [
      opt('needs', t('Essencial', 'Needs'), 'blue'),
      opt('wants', t('Estilo de vida', 'Wants'), 'purple'),
      opt('future', t('Futuro', 'Savings'), 'green'),
      opt('income', t('Renda', 'Income'), 'gray')
    ]),
    prop.number('budget', t('Orçamento mensal', 'Monthly budget'), 'currency'),
    prop.formula(
      'average',
      t('Média por mês', 'Monthly average'),
      'if(empty(prop("since")), 0, round(prop("spent") / (dateBetween(today(), prop("since"), "months") + 1), 2))',
      'currency'
    ),
    prop.formula('left', t('Folga', 'Left'), 'if(not empty(prop("budget")), prop("budget") - prop("average"))', 'currency'),
    prop.formula(
      'status',
      t('Situação', 'Status'),
      `ifs(empty(prop("budget")), "", prop("average") > prop("budget"), "${t('Acima', 'Over')}", prop("average") >= prop("budget") * 0.9, "${t('No limite', 'At the limit')}", "${t('Dentro', 'Within')}")`
    ),
    prop.relation('entries', t('Lançamentos', 'Transactions'), 'entries', { synced: 'category' }),
    prop.rollup('spent', t('Gasto no total', 'Spent in total'), 'entries', 'expense', 'sum'),
    prop.rollup('received', t('Recebido no total', 'Received in total'), 'entries', 'income', 'sum'),
    prop.rollup('since', t('Desde', 'Since'), 'entries', 'date', 'earliest')
  )

  const accounts = schema(
    prop.title(t('Conta', 'Account')),
    prop.select('type', t('Tipo', 'Type'), [
      opt('checking', t('Conta corrente', 'Checking'), 'blue'),
      opt('savings', t('Poupança', 'Savings'), 'green'),
      opt('card', t('Cartão de crédito', 'Credit card'), 'orange'),
      opt('cash', t('Dinheiro', 'Cash'), 'yellow'),
      opt('investments', t('Investimentos', 'Investments'), 'purple')
    ]),
    prop.number('opening', t('Saldo inicial', 'Opening balance'), 'currency'),
    prop.formula(
      'balance',
      t('Saldo atual', 'Balance'),
      'if(empty(prop("opening")), 0, prop("opening")) + if(empty(prop("in")), 0, prop("in")) - if(empty(prop("out")), 0, prop("out"))',
      'currency'
    ),
    prop.rollup('in', t('Entradas', 'Money in'), 'entries', 'income', 'sum'),
    prop.rollup('out', t('Saídas', 'Money out'), 'entries', 'expense', 'sum'),
    prop.rollup('last', t('Último lançamento', 'Last transaction'), 'entries', 'date', 'latest'),
    prop.relation('entries', t('Lançamentos', 'Transactions'), 'entries', { synced: 'account' })
  )

  // ---- examples: three months of an ordinary life, in the currency of the language
  const categoryRows: TemplateRow[] = [
    row('housing', t('Moradia', 'Housing'), { group: 'needs', budget: t(2000, 1500) }),
    row('groceries', t('Mercado', 'Groceries'), { group: 'needs', budget: t(900, 450) }),
    row('transport', t('Transporte', 'Transport'), { group: 'needs', budget: t(300, 150) }),
    row('health', t('Saúde', 'Health'), { group: 'needs', budget: t(250, 80) }),
    row('eating', t('Restaurantes', 'Eating out'), { group: 'wants', budget: t(350, 180) }),
    row('fun', t('Lazer', 'Fun'), { group: 'wants', budget: t(250, 100) }),
    row('subscriptions', t('Assinaturas', 'Subscriptions'), { group: 'wants', budget: t(80, 40) }),
    row('reserve', t('Reserva de emergência', 'Emergency fund'), { group: 'future', budget: t(600, 400) }),
    row('salary', t('Salário', 'Salary'), { group: 'income' }),
    row('extra', t('Renda extra', 'Side income'), { group: 'income' })
  ]
  const accountRows: TemplateRow[] = [
    row('checking', t('Conta corrente', 'Checking account'), { type: 'checking', opening: t(2400, 1800) }),
    row('card', t('Cartão de crédito', 'Credit card'), { type: 'card', opening: 0 }),
    row('savings', t('Poupança', 'Savings account'), { type: 'savings', opening: t(8000, 5000) }),
    row('wallet', t('Carteira', 'Wallet'), { type: 'cash', opening: t(150, 60) })
  ]

  interface Entry {
    day: number
    title: string
    category: string
    account: string
    income?: number
    expense?: number
    recurring?: boolean
    note?: string
  }
  // The same month three times, with the small differences months have (`m` is 0, 1, 2 months ago).
  const month = (m: number): Entry[] => {
    const wobble = (n: number, step: number): number => Math.round((n + step * ((m * 7) % 5) - step * 2) * 100) / 100
    const list: Entry[] = [
      { day: 5, title: t('Salário', 'Paycheck'), category: 'salary', account: 'checking', income: t(5200, 4200), recurring: true },
      { day: 6, title: t('Guardar na poupança', 'Transfer to savings'), category: 'reserve', account: 'checking', expense: t(600, 400), recurring: true },
      { day: 10, title: t('Aluguel e condomínio', 'Rent'), category: 'housing', account: 'checking', expense: t(1750, 1350), recurring: true },
      { day: 12, title: t('Conta de luz', 'Electricity'), category: 'housing', account: 'checking', expense: wobble(t(160, 85), t(12, 6)), recurring: true },
      { day: 15, title: t('Internet', 'Internet'), category: 'housing', account: 'card', expense: t(110, 60), recurring: true },
      { day: 8, title: t('Streaming de vídeo', 'Video streaming'), category: 'subscriptions', account: 'card', expense: t(45, 16), recurring: true },
      { day: 8, title: t('Música', 'Music'), category: 'subscriptions', account: 'card', expense: t(22, 11), recurring: true },
      { day: 20, title: t('Academia', 'Gym'), category: 'health', account: 'card', expense: t(120, 40), recurring: true },
      { day: 3, title: t('Mercado do mês', 'Big grocery run'), category: 'groceries', account: 'card', expense: wobble(t(420, 130), t(25, 8)) },
      { day: 14, title: t('Mercado', 'Groceries'), category: 'groceries', account: 'card', expense: wobble(t(260, 85), t(18, 6)) },
      { day: 18, title: t('Feira', "Farmers' market"), category: 'groceries', account: 'wallet', expense: wobble(t(85, 32), t(6, 3)) },
      { day: 24, title: t('Padaria e hortifrúti', 'Bakery and produce'), category: 'groceries', account: 'card', expense: wobble(t(95, 38), t(7, 3)) },
      { day: 2, title: t('Recarga do bilhete', 'Transit pass'), category: 'transport', account: 'checking', expense: t(120, 90), recurring: true },
      { day: 21, title: t('Corrida de app', 'Rideshare'), category: 'transport', account: 'card', expense: wobble(t(38, 22), t(5, 3)) },
      { day: 17, title: t('Farmácia', 'Pharmacy'), category: 'health', account: 'card', expense: wobble(t(65, 18), t(9, 4)) },
      { day: 11, title: t('Almoço com a equipe', 'Lunch with the team'), category: 'eating', account: 'card', expense: wobble(t(54, 24), t(4, 2)) }
    ]
    if (m === 0) {
      list.push(
        { day: 9, title: t('Cinema', 'Movies'), category: 'fun', account: 'card', expense: t(60, 28) },
        { day: 13, title: t('Livro', 'Book'), category: 'fun', account: 'card', expense: t(70, 19), note: t('Presente para a Ana', 'A gift for Sam') }
      )
    }
    if (m === 1) {
      list.push(
        { day: 22, title: t('Jantar de aniversário', 'Birthday dinner'), category: 'eating', account: 'card', expense: t(180, 85) },
        { day: 25, title: t('Freela de design', 'Freelance design job'), category: 'extra', account: 'checking', income: t(900, 650) },
        { day: 27, title: t('Show', 'Concert'), category: 'fun', account: 'card', expense: t(220, 75) }
      )
    }
    if (m === 2) {
      list.push(
        { day: 16, title: t('Consulta no dentista', 'Dentist'), category: 'health', account: 'checking', expense: t(250, 120) },
        { day: 26, title: t('Pizza com amigos', 'Pizza with friends'), category: 'eating', account: 'wallet', expense: t(75, 36) }
      )
    }
    return list
  }
  const entryRows: TemplateRow[] = [2, 1, 0].flatMap((m) =>
    month(m).map((entry) =>
      row(undefined, entry.title, {
        date: ofMonth(-m, entry.day),
        ...(entry.income !== undefined ? { income: entry.income } : {}),
        ...(entry.expense !== undefined ? { expense: entry.expense } : {}),
        category: [entry.category],
        account: [entry.account],
        recurring: entry.recurring === true,
        ...(entry.note ? { note: entry.note } : {})
      })
    )
  )

  const ledger = ['title', 'date', 'kind', 'income', 'expense', 'category', 'account', 'recurring']

  return {
    id: 'finances',
    locale,
    name: t('Finanças pessoais', 'Personal finances'),
    description: t('Lançamentos, orçamento por categoria, contas e o mês num painel.', 'Transactions, a budget per category, accounts and the month at a glance.'),
    icon: 'stones',
    page: page(t('Finanças pessoais', 'Personal finances'), line('stones'), [
      callout(
        '💡',
        t(
          [['Anote cada entrada e saída em '], b('Lançamentos'), [', ligada a uma categoria e a uma conta. O resto desta página se monta sozinho.']],
          [['Write down every bit of money in and out in '], b('Transactions'), [', with a category and an account. The rest of this page builds itself.']]
        )
      ),
      h2(t('Este mês', 'This month')),
      linked(
        'entries',
        [
          views.calc(
            t('Este mês', 'This month'),
            [
              calc('in', t('Entrou', 'Came in'), `sum(${IN})`, 'currency'),
              calc('out', t('Saiu', 'Went out'), `sum(${OUT})`, 'currency'),
              calc('net', t('Sobrou', 'Left over'), `sum(${IN}) - sum(${OUT})`, 'currency'),
              calc('count', t('Lançamentos', 'Transactions'), 'count()')
            ],
            { filters: [where.date('date', 'this_month')] }
          )
        ],
        { title: t('Resumo do mês', 'The month so far') }
      ),
      linked(
        'entries',
        [
          views.chart(t('Últimos meses', 'Recent months'), {
            kind: 'column',
            x: 'date',
            xDateBucket: 'month',
            y: { aggregate: 'sum', property: 'expense' },
            sort: 'x_asc',
            showValues: true,
            showGrid: true,
            height: 220
          })
        ],
        { title: t('Saídas por mês', 'Spending by month'), beside: true }
      ),
      linked(
        'entries',
        [
          views.table(t('Do mês', 'This month'), ['title', 'date', 'kind', 'income', 'expense', 'category', 'account'], {
            filters: [where.date('date', 'this_month')],
            sorts: [desc('date')]
          })
        ],
        { title: t('Lançamentos do mês', "This month's transactions") }
      ),
      h2(t('Orçamento por categoria', 'Budget by category')),
      p(
        t(
          'Cada categoria compara o orçamento com o que você gasta, em média, por mês desde o primeiro lançamento dela.',
          'Each category compares its budget with what you spend on it in an average month, since its first transaction.'
        )
      ),
      linked(
        'categories',
        [
          views.table(t('Com orçamento', 'With a budget'), ['title', 'budget', 'average', 'left', 'status'], {
            filters: [where.notEmpty('budget')],
            sorts: [asc('group')]
          })
        ],
        { title: t('Orçamento', 'Budget') }
      ),
      linked(
        'categories',
        [
          views.chart(
            t('Por grupo', 'By group'),
            { kind: 'donut', x: 'group', y: { aggregate: 'sum', property: 'budget' }, palette: 'options', showLegend: true, showValues: true, sort: 'manual', height: 220 },
            { filters: [where.notEmpty('budget')] }
          )
        ],
        { title: t('Para onde vai o orçamento', 'Where the budget goes') }
      ),
      h2(t('Assinaturas e contas fixas', 'Subscriptions and fixed bills')),
      linked(
        'entries',
        [
          views.calc(
            t('Todo mês', 'Every month'),
            [calc('fixed', t('Fixas por mês', 'Fixed each month'), `sum(${OUT})`, 'currency'), calc('n', t('Contas', 'Bills'), 'count()')],
            { filters: [where.checked('recurring'), where.notEmpty('expense'), where.date('date', 'this_month')] }
          )
        ],
        { title: t('Comprometido', 'Spoken for') }
      ),
      linked(
        'entries',
        [
          views.table(t('Este mês', 'This month'), ['title', 'expense', 'date', 'category', 'account'], {
            filters: [where.checked('recurring'), where.notEmpty('expense'), where.date('date', 'this_month')],
            sorts: [asc('date')]
          })
        ],
        { title: t('Contas fixas', 'Fixed bills') }
      ),
      divider(),
      page(t('Dados', 'Data'), line('box'), [
      p(t('De onde a página Finanças pessoais lê. Os lançamentos mudam todo dia; categorias e contas, quase nunca.', 'What the Personal finances page reads from. Transactions change every day; categories and accounts hardly ever.')),
      database(
        'entries',
        t('Lançamentos', 'Transactions'),
        line('page'),
        entries,
        [
          views.table(t('Todos', 'All'), ledger, { sorts: [desc('date')] }),
          views.table(t('Este mês', 'This month'), ledger, { filters: [where.date('date', 'this_month')], sorts: [desc('date')] }),
          views.calendar(t('Calendário', 'Calendar'), 'date', ['title', 'expense', 'income']),
          views.chart(t('Por mês', 'By month'), {
            kind: 'column',
            x: 'date',
            xDateBucket: 'month',
            y: { aggregate: 'sum', property: 'expense' },
            sort: 'x_asc',
            showValues: true
          })
        ],
        entryRows
      ),
      database(
        'categories',
        t('Categorias', 'Categories'),
        line('box'),
        categories,
        [
          views.table(t('Orçamento', 'Budget'), ['title', 'group', 'budget', 'average', 'left', 'status']),
          views.table(t('Tudo', 'Everything'), ['title', 'group', 'budget', 'spent', 'received', 'since', 'average', 'left', 'status', 'entries']),
          views.board(t('Por grupo', 'By group'), 'group', ['budget', 'status'])
        ],
        categoryRows
      ),
      database(
        'accounts',
        t('Contas', 'Accounts'),
        line('key'),
        accounts,
        [views.table(t('Contas', 'Accounts'), ['title', 'type', 'opening', 'in', 'out', 'balance', 'last'])],
        accountRows
      )
      ])
    ])
  }
}
