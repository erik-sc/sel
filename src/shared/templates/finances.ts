// Personal finances: transactions in one ledger (money in and money out in two columns, like a
// bank statement), linked to a category with a monthly budget and to an account. A plan holds
// the take-home pay and sees how the budgets share it out. The page on top reads all of it:
// the plan and what to look at, the month (next to the one before), the budget of the month
// and the fixed bills.
//
// A category reads the month through rollups that keep only this month's (or last month's)
// transactions, and compares its budget with them; the plan sums the budgets by group the same
// way. The month's figures and charts are views filtered to "this month".
import {
  asc,
  b,
  calc,
  callout,
  chooser,
  database,
  desc,
  divider,
  h2,
  line,
  linked,
  ofMonth,
  opt,
  p,
  page,
  prop,
  row,
  schema,
  views,
  where
} from './build'
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
    // What came in or went out, whichever it was: the money in and out by month is one chart split by type.
    prop.formula('value', t('Valor', 'Amount'), 'if(empty(prop("expense")), prop("income"), prop("expense"))', 'currency'),
    prop.text('note', t('Observação', 'Note'))
  )

  const thisMonth = [where.date('date', 'this_month')]
  const categories = schema(
    prop.title(t('Categoria', 'Category')),
    prop.select('group', t('Grupo', 'Group'), [
      opt('needs', t('Essencial', 'Needs'), 'blue'),
      opt('wants', t('Estilo de vida', 'Wants'), 'purple'),
      opt('future', t('Futuro', 'Savings'), 'green'),
      opt('income', t('Renda', 'Income'), 'gray')
    ]),
    prop.number('budget', t('Orçamento mensal', 'Monthly budget'), 'currency'),
    prop.rollup('month', t('Gasto este mês', 'Spent this month'), 'entries', 'expense', 'sum', thisMonth),
    prop.formula(
      'left',
      t('Resta este mês', 'Left this month'),
      'if(not empty(prop("budget")), prop("budget") - prop("month"))',
      'currency'
    ),
    prop.formula('used', t('% usado', '% used'), 'if(not empty(prop("budget")), prop("month") / prop("budget"))', 'percent'),
    // "Too fast": more of the budget is gone than of the month. Savings are the other way round: the whole budget is the aim.
    prop.formula(
      'status',
      t('Situação', 'Status'),
      `ifs(empty(prop("budget")), "", prop("group") == "${t('Futuro', 'Savings')}", if(prop("month") >= prop("budget"), "${t('Guardado', 'Saved')}", "${t('Falta guardar', 'Still to save')}"), prop("month") > prop("budget"), "${t('Estourou', 'Over')}", prop("month") >= prop("budget") * 0.9, "${t('No limite', 'At the limit')}", prop("month") / prop("budget") > day(today()) / 30 + 0.15, "${t('Rápido demais', 'Too fast')}", "${t('Dentro', 'Within')}")`
    ),
    prop.rollup('lastMonth', t('Mês passado', 'Last month'), 'entries', 'expense', 'sum', [where.date('date', 'last_month')]),
    prop.formula(
      'average',
      t('Média por mês', 'Monthly average'),
      'if(empty(prop("since")), 0, round(prop("spent") / (dateBetween(today(), prop("since"), "months") + 1), 2))',
      'currency'
    ),
    prop.relation('entries', t('Lançamentos', 'Transactions'), 'entries', { synced: 'category' }),
    prop.relation('plan', t('Plano', 'Plan'), 'plan', { synced: 'categories', one: true }),
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

  // ---- the plan: the take-home pay, and how the budgets of the categories share it out
  const share = (id: string): string => `if(not empty(prop("salary")), prop("${id}") / prop("salary"))`
  const percentOf = (id: string): string => `format(round(prop("${id}") / prop("salary") * 100))`
  const plan = schema(
    prop.title(t('Plano', 'Plan')),
    prop.number('salary', t('Salário líquido', 'Take-home pay'), 'currency'),
    prop.rollup('planned', t('Já tem destino', 'Budgeted'), 'categories', 'budget', 'sum'),
    prop.formula('free', t('Sem destino', 'Unassigned'), 'if(not empty(prop("salary")), prop("salary") - prop("planned"))', 'currency'),
    prop.rollup('needs', t('Essencial', 'Needs'), 'categories', 'budget', 'sum', [where.is('group', 'needs')]),
    prop.formula('needsShare', t('Essencial (%)', 'Needs (%)'), share('needs'), 'percent'),
    prop.rollup('wants', t('Estilo de vida', 'Wants'), 'categories', 'budget', 'sum', [where.is('group', 'wants')]),
    prop.formula('wantsShare', t('Estilo de vida (%)', 'Wants (%)'), share('wants'), 'percent'),
    prop.rollup('future', t('Futuro', 'Savings'), 'categories', 'budget', 'sum', [where.is('group', 'future')]),
    prop.formula('futureShare', t('Futuro (%)', 'Savings (%)'), share('future'), 'percent'),
    // The first thing worth looking at, measured against the usual 50 / 30 / 20 split.
    prop.formula(
      'advice',
      t('Onde organizar', 'What to look at'),
      `ifs(empty(prop("salary")), "${t('Escreva seu salário líquido para ver o plano.', 'Write down your take-home pay to see the plan.')}", ` +
        `prop("free") < 0, concat("${t('Os orçamentos passam do salário em ', 'The budgets go past your pay by ')}", format(round(0 - prop("free"))), "${t('. Corte primeiro no estilo de vida.', '. Cut wants first.')}"), ` +
        `prop("needs") > prop("salary") * 0.55, concat("${t('O essencial leva ', 'Needs take ')}", ${percentOf('needs')}, "${t('% do salário (o comum é até 50%). Reveja moradia e contas fixas.', '% of your pay (50% or less is usual). Look at housing and fixed bills.')}"), ` +
        `prop("future") < prop("salary") * 0.15, concat("${t('Só ', 'Only ')}", ${percentOf('future')}, "${t('% vai para o futuro (o comum é 20%). Aumente a reserva.', '% goes to savings (20% is usual). Put more aside.')}"), ` +
        `prop("wants") > prop("salary") * 0.35, concat("${t('O estilo de vida leva ', 'Wants take ')}", ${percentOf('wants')}, "${t('% do salário (o comum é até 30%).', '% of your pay (30% or less is usual).')}"), ` +
        `prop("free") > 0, concat("${t('Plano equilibrado. Sobram ', 'A balanced plan. ')}", format(round(prop("free"))), "${t(' sem destino: dê um a eles (reserva, uma meta).', ' has no job yet: give it one (savings, a goal).')}"), ` +
        `"${t('Plano equilibrado: cada real tem um destino.', 'A balanced plan: every coin has a job.')}")`
    ),
    prop.relation('categories', t('Categorias', 'Categories'), 'categories', { synced: 'plan' })
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
      {
        day: 6,
        title: t('Guardar na poupança', 'Transfer to savings'),
        category: 'reserve',
        account: 'checking',
        expense: t(600, 400),
        recurring: true
      },
      {
        day: 10,
        title: t('Aluguel e condomínio', 'Rent'),
        category: 'housing',
        account: 'checking',
        expense: t(1750, 1350),
        recurring: true
      },
      {
        day: 12,
        title: t('Conta de luz', 'Electricity'),
        category: 'housing',
        account: 'checking',
        expense: wobble(t(160, 85), t(12, 6)),
        recurring: true
      },
      { day: 15, title: t('Internet', 'Internet'), category: 'housing', account: 'card', expense: t(110, 60), recurring: true },
      {
        day: 8,
        title: t('Streaming de vídeo', 'Video streaming'),
        category: 'subscriptions',
        account: 'card',
        expense: t(45, 16),
        recurring: true
      },
      { day: 8, title: t('Música', 'Music'), category: 'subscriptions', account: 'card', expense: t(22, 11), recurring: true },
      { day: 20, title: t('Academia', 'Gym'), category: 'health', account: 'card', expense: t(120, 40), recurring: true },
      {
        day: 3,
        title: t('Mercado do mês', 'Big grocery run'),
        category: 'groceries',
        account: 'card',
        expense: wobble(t(420, 130), t(25, 8))
      },
      { day: 14, title: t('Mercado', 'Groceries'), category: 'groceries', account: 'card', expense: wobble(t(260, 85), t(18, 6)) },
      { day: 18, title: t('Feira', "Farmers' market"), category: 'groceries', account: 'wallet', expense: wobble(t(85, 32), t(6, 3)) },
      {
        day: 24,
        title: t('Padaria e hortifrúti', 'Bakery and produce'),
        category: 'groceries',
        account: 'card',
        expense: wobble(t(95, 38), t(7, 3))
      },
      {
        day: 2,
        title: t('Recarga do bilhete', 'Transit pass'),
        category: 'transport',
        account: 'checking',
        expense: t(120, 90),
        recurring: true
      },
      { day: 21, title: t('Corrida de app', 'Rideshare'), category: 'transport', account: 'card', expense: wobble(t(38, 22), t(5, 3)) },
      { day: 17, title: t('Farmácia', 'Pharmacy'), category: 'health', account: 'card', expense: wobble(t(65, 18), t(9, 4)) },
      {
        day: 11,
        title: t('Almoço com a equipe', 'Lunch with the team'),
        category: 'eating',
        account: 'card',
        expense: wobble(t(54, 24), t(4, 2))
      }
    ]
    if (m === 0) {
      list.push(
        { day: 9, title: t('Cinema', 'Movies'), category: 'fun', account: 'card', expense: t(60, 28) },
        {
          day: 13,
          title: t('Livro', 'Book'),
          category: 'fun',
          account: 'card',
          expense: t(70, 19),
          note: t('Presente para a Ana', 'A gift for Sam')
        }
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

  // The paycheck of the examples; every category counts in the plan.
  const planRows: TemplateRow[] = [
    row('mine', t('Meu salário', 'My pay'), { salary: t(5200, 4200), categories: categoryRows.map((category) => category.key as string) })
  ]

  const ledger = ['title', 'date', 'kind', 'income', 'expense', 'category', 'account', 'recurring']
  const withBudget = [where.notEmpty('budget')]

  return {
    id: 'finances',
    locale,
    name: t('Finanças pessoais', 'Personal finances'),
    description: t(
      'Salário e plano, lançamentos, orçamento do mês por categoria, contas e o mês num painel.',
      'Your pay and a plan, transactions, a monthly budget per category, accounts and the month at a glance.'
    ),
    icon: 'stones',
    page: page(t('Finanças pessoais', 'Personal finances'), line('stones'), [
      callout(
        '💡',
        t(
          [
            ['Comece pelo '],
            b('Meu plano'),
            [': escreva seu salário líquido. Depois anote cada entrada e saída em '],
            b('Lançamentos'),
            [', com uma categoria e uma conta. O resto desta página se monta sozinho.']
          ],
          [
            ['Start with '],
            b('My plan'),
            [': write down your take-home pay. Then note every bit of money in and out in '],
            b('Transactions'),
            [', with a category and an account. The rest of this page builds itself.']
          ]
        )
      ),
      h2(t('Meu plano', 'My plan')),
      p(
        t(
          'O salário repartido pelos orçamentos das categorias. Uma divisão comum é 50% para o essencial, 30% para o estilo de vida e 20% para o futuro.',
          'Your pay shared out by the budgets of the categories. A common split is 50% for needs, 30% for wants and 20% for savings.'
        )
      ),
      // The advice is a sentence: it gets a column of its own, wide enough to be read whole.
      linked('plan', [views.table(t('Conselho', 'Advice'), ['title', 'advice'], { widths: { title: 130, advice: 640 } })], {
        title: t('Onde organizar', 'What to look at')
      }),
      linked('plan', [views.table(t('Salário', 'Pay'), ['title', 'salary', 'planned', 'free'])], {
        title: t('Salário e destino', 'Pay and where it goes')
      }),
      linked(
        'plan',
        [views.table(t('Divisão', 'Split'), ['title', 'needs', 'needsShare', 'wants', 'wantsShare', 'future', 'futureShare'])],
        {
          title: t('Essencial, estilo de vida e futuro', 'Needs, wants and savings')
        }
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
            { filters: thisMonth }
          )
        ],
        { title: t('Resumo do mês', 'The month so far') }
      ),
      linked(
        'entries',
        [
          views.calc(
            t('Mês passado', 'Last month'),
            [
              calc('in', t('Entrou', 'Came in'), `sum(${IN})`, 'currency'),
              calc('out', t('Saiu', 'Went out'), `sum(${OUT})`, 'currency'),
              calc('net', t('Sobrou', 'Left over'), `sum(${IN}) - sum(${OUT})`, 'currency')
            ],
            { filters: [where.date('date', 'last_month')] }
          )
        ],
        { title: t('Mês passado', 'Last month'), beside: true }
      ),
      linked(
        'entries',
        [
          views.chart(
            t('Por categoria', 'By category'),
            {
              kind: 'donut',
              x: 'category',
              y: { aggregate: 'sum', property: 'expense' },
              showLegend: true,
              showValues: true,
              sort: 'y_desc',
              height: 240
            },
            { filters: thisMonth }
          )
        ],
        { title: t('Para onde foi o dinheiro', 'Where the money went') }
      ),
      linked(
        'entries',
        [
          views.chart(t('Últimos meses', 'Recent months'), {
            kind: 'column',
            x: 'date',
            xDateBucket: 'month',
            y: { aggregate: 'sum', property: 'value' },
            series: 'kind',
            sort: 'x_asc',
            showLegend: true,
            showGrid: true,
            height: 240
          })
        ],
        { title: t('Entrou e saiu, por mês', 'In and out, by month'), beside: true }
      ),
      linked(
        'entries',
        [
          views.table(t('Do mês', 'This month'), ['title', 'date', 'kind', 'income', 'expense', 'category', 'account'], {
            filters: thisMonth,
            sorts: [desc('date')]
          })
        ],
        { title: t('Lançamentos do mês', "This month's transactions") }
      ),
      h2(t('Orçamento do mês', "This month's budget")),
      p(
        t(
          'Cada categoria compara o orçamento com o que já saiu neste mês. "Rápido demais" quer dizer que já foi mais do orçamento do que do mês: é ali que vale apertar.',
          'Each category compares its budget with what has gone out this month. "Too fast" means more of the budget is gone than of the month: that is where to hold back.'
        )
      ),
      linked(
        'categories',
        [
          views.table(t('Com orçamento', 'With a budget'), ['title', 'budget', 'month', 'left', 'used', 'status', 'lastMonth', 'average'], {
            filters: withBudget,
            sorts: [desc('used')]
          })
        ],
        { title: t('Orçamento', 'Budget') }
      ),
      linked(
        'categories',
        [
          views.chart(
            t('Quanto já foi', 'How much is gone'),
            { kind: 'bar', x: 'title', y: { aggregate: 'sum', property: 'used' }, sort: 'y_desc', showValues: true, height: 260 },
            // What is spent, not what is put aside.
            { filters: [...withBudget, where.isNot('group', 'future')] }
          )
        ],
        { title: t('Do orçamento, quanto já foi', 'How much of each budget is gone') }
      ),
      linked(
        'categories',
        [
          views.chart(
            t('Por grupo', 'By group'),
            {
              kind: 'donut',
              x: 'group',
              y: { aggregate: 'sum', property: 'budget' },
              palette: 'options',
              showLegend: true,
              showValues: true,
              sort: 'manual',
              height: 260
            },
            { filters: withBudget }
          )
        ],
        { title: t('Para onde vai o orçamento', 'Where the budget goes'), beside: true }
      ),
      h2(t('Assinaturas e contas fixas', 'Subscriptions and fixed bills')),
      linked(
        'entries',
        [
          views.calc(
            t('Todo mês', 'Every month'),
            [calc('fixed', t('Fixas por mês', 'Fixed each month'), `sum(${OUT})`, 'currency'), calc('n', t('Contas', 'Bills'), 'count()')],
            { filters: [where.checked('recurring'), where.notEmpty('expense'), ...thisMonth] }
          )
        ],
        { title: t('Comprometido', 'Spoken for') }
      ),
      linked(
        'entries',
        [
          views.table(t('Este mês', 'This month'), ['title', 'expense', 'date', 'category', 'account'], {
            filters: [where.checked('recurring'), where.notEmpty('expense'), ...thisMonth],
            sorts: [asc('date')]
          })
        ],
        { title: t('Contas fixas', 'Fixed bills') }
      ),
      divider(),
      page(t('Dados', 'Data'), line('box'), [
        p(
          t(
            'De onde a página Finanças pessoais lê. Os lançamentos mudam todo dia; o plano, as categorias e as contas, quase nunca.',
            'What the Personal finances page reads from. Transactions change every day; the plan, categories and accounts hardly ever.'
          )
        ),
        database(
          'entries',
          t('Lançamentos', 'Transactions'),
          line('page'),
          entries,
          [
            views.table(t('Todos', 'All'), ledger, { sorts: [desc('date')] }),
            views.table(t('Este mês', 'This month'), ledger, { filters: thisMonth, sorts: [desc('date')] }),
            views.calendar(t('Calendário', 'Calendar'), 'date', ['title', 'expense', 'income']),
            views.chart(t('Por mês', 'By month'), {
              kind: 'column',
              x: 'date',
              xDateBucket: 'month',
              y: { aggregate: 'sum', property: 'value' },
              series: 'kind',
              sort: 'x_asc',
              showLegend: true
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
            views.table(t('Orçamento', 'Budget'), ['title', 'group', 'budget', 'month', 'left', 'used', 'status']),
            views.table(t('Tudo', 'Everything'), [
              'title',
              'group',
              'budget',
              'month',
              'left',
              'used',
              'status',
              'lastMonth',
              'spent',
              'received',
              'since',
              'average',
              'entries',
              'plan'
            ]),
            views.board(t('Por grupo', 'By group'), 'group', ['budget', 'month', 'status'])
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
        ),
        database(
          'plan',
          t('Meu plano', 'My plan'),
          line('stones'),
          plan,
          [
            views.table(t('Plano', 'Plan'), [
              'title',
              'salary',
              'planned',
              'free',
              'needs',
              'needsShare',
              'wants',
              'wantsShare',
              'future',
              'futureShare',
              'advice',
              'categories'
            ])
          ],
          planRows
        )
      ])
    ])
  }
}
