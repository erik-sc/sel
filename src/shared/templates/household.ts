// The house: chores that come back by room and by how often, the upkeep of what needs a check
// now and then (and its warranty), what there is in it, who to call, and the shopping list.
// Each chore and each check works out its next date from the last one, so the page on top only
// has to show what is due.
import {
  asc,
  b,
  calc,
  desc,
  callout,
  chooser,
  database,
  divider,
  h2,
  inDays,
  line,
  linked,
  opt,
  p,
  page,
  prop,
  row,
  schema,
  views,
  where
} from './build'
import type { Template, TemplateLocale } from './model'

export function household(locale: TemplateLocale): Template {
  const t = chooser(locale)

  const rooms = [
    opt('kitchen', t('Cozinha', 'Kitchen'), 'orange'),
    opt('living', t('Sala', 'Living room'), 'yellow'),
    opt('bedroom', t('Quarto', 'Bedroom'), 'purple'),
    opt('bathroom', t('Banheiro', 'Bathroom'), 'blue'),
    opt('laundry', t('Lavanderia', 'Laundry'), 'gray'),
    opt('outside', t('Área externa', 'Outside'), 'green'),
    opt('whole', t('Casa toda', 'Whole house'), 'brown')
  ]
  const freq = {
    daily: t('Diária', 'Daily'),
    weekly: t('Semanal', 'Weekly'),
    fortnightly: t('Quinzenal', 'Every two weeks'),
    monthly: t('Mensal', 'Monthly'),
    quarterly: t('Trimestral', 'Every three months'),
    yearly: t('Anual', 'Yearly')
  }

  const chores = schema(
    prop.title(t('Tarefa', 'Chore')),
    prop.select('room', t('Cômodo', 'Room'), rooms),
    prop.select('frequency', t('Frequência', 'How often'), [
      opt('daily', freq.daily, 'red'),
      opt('weekly', freq.weekly, 'orange'),
      opt('fortnightly', freq.fortnightly, 'yellow'),
      opt('monthly', freq.monthly, 'green'),
      opt('quarterly', freq.quarterly, 'blue'),
      opt('yearly', freq.yearly, 'purple')
    ]),
    prop.date('last', t('Última vez', 'Last done')),
    prop.formula(
      'next',
      t('Próxima vez', 'Next due'),
      `ifs(empty(prop("last")), today(), prop("frequency") == "${freq.daily}", dateAdd(prop("last"), 1, "days"), prop("frequency") == "${freq.weekly}", dateAdd(prop("last"), 1, "weeks"), prop("frequency") == "${freq.fortnightly}", dateAdd(prop("last"), 2, "weeks"), prop("frequency") == "${freq.monthly}", dateAdd(prop("last"), 1, "months"), prop("frequency") == "${freq.quarterly}", dateAdd(prop("last"), 3, "months"), dateAdd(prop("last"), 1, "years"))`
    ),
    prop.formula('due', t('Para esta semana', 'Due this week'), 'prop("next") <= dateAdd(today(), 7, "days")'),
    prop.select('who', t('Quem', 'Who'), [
      opt('me', t('Eu', 'Me'), 'blue'),
      opt('partner', t('Ana', 'Sam'), 'pink'),
      opt('anyone', t('Quem puder', 'Whoever can'), 'gray'),
      opt('cleaner', t('Diarista', 'Cleaner'), 'green')
    ]),
    prop.number('minutes', t('Minutos', 'Minutes'))
  )

  const upkeep = schema(
    prop.title(t('Equipamento', 'Item')),
    prop.select('room', t('Onde', 'Where'), rooms),
    prop.date('checked', t('Última revisão', 'Last service')),
    prop.number('interval', t('Revisar a cada (meses)', 'Service every (months)')),
    prop.formula(
      'next',
      t('Próxima revisão', 'Next service'),
      'if(not empty(prop("checked")) and not empty(prop("interval")), dateAdd(prop("checked"), prop("interval"), "months"))'
    ),
    prop.formula('late', t('Revisão atrasada', 'Service overdue'), 'if(empty(prop("next")), false, prop("next") < today())'),
    prop.date('warranty', t('Garantia até', 'Warranty until')),
    prop.formula('covered', t('Na garantia', 'Under warranty'), 'if(empty(prop("warranty")), false, prop("warranty") >= today())'),
    prop.relation('contact', t('Quem chamar', 'Who to call'), 'contacts', { synced: 'items', one: true }),
    prop.text('notes', t('Anotações', 'Notes'))
  )

  const inventory = schema(
    prop.title(t('Item', 'Item')),
    prop.select('room', t('Cômodo', 'Room'), rooms),
    prop.select('kind', t('Categoria', 'Category'), [
      opt('appliance', t('Eletrodoméstico', 'Appliance'), 'blue'),
      opt('electronics', t('Eletrônico', 'Electronics'), 'purple'),
      opt('furniture', t('Móvel', 'Furniture'), 'brown'),
      opt('tools', t('Ferramenta', 'Tools'), 'gray'),
      opt('documents', t('Documento', 'Documents'), 'yellow')
    ]),
    prop.date('bought', t('Comprado em', 'Bought on')),
    prop.number('price', t('Valor', 'Price'), 'currency'),
    prop.text('where', t('Onde está o manual / nota', 'Manual and receipt')),
    prop.text('serial', t('Número de série', 'Serial number'))
  )

  const contacts = schema(
    prop.title(t('Nome', 'Name')),
    prop.select('service', t('Serviço', 'Service'), [
      opt('electrician', t('Eletricista', 'Electrician'), 'yellow'),
      opt('plumber', t('Encanador', 'Plumber'), 'blue'),
      opt('cleaner', t('Diarista', 'Cleaner'), 'green'),
      opt('ac', t('Ar-condicionado', 'Heating and cooling'), 'purple'),
      opt('locksmith', t('Chaveiro', 'Locksmith'), 'gray'),
      opt('handyman', t('Marido de aluguel', 'Handyman'), 'orange')
    ]),
    prop.text('phone', t('Telefone', 'Phone')),
    prop.select('opinion', t('Recomendo?', 'Would call again?'), [
      opt('yes', t('Recomendo', 'Gladly'), 'green'),
      opt('ok', t('Serve', 'It was fine'), 'yellow'),
      opt('no', t('Evitar', 'Rather not'), 'red')
    ]),
    prop.date('lastCall', t('Última vez', 'Last time')),
    prop.relation('items', t('Cuida de', 'Looks after'), 'upkeep', { synced: 'contact' }),
    prop.text('notes', t('Anotações', 'Notes'))
  )

  const shopping = schema(
    prop.title(t('Item', 'Item')),
    prop.select('store', t('Onde comprar', 'Where'), [
      opt('market', t('Mercado', 'Supermarket'), 'green'),
      opt('pharmacy', t('Farmácia', 'Pharmacy'), 'red'),
      opt('hardware', t('Loja de material', 'Hardware store'), 'orange'),
      opt('online', t('Internet', 'Online'), 'blue')
    ]),
    prop.text('amount', t('Quanto', 'How much')),
    prop.checkbox('urgent', t('Urgente', 'Urgent')),
    prop.checkbox('bought', t('Comprado', 'Got it'))
  )

  return {
    id: 'household',
    locale,
    name: t('Casa', 'Household'),
    description: t(
      'Tarefas por cômodo, revisões e garantias, inventário, contatos e compras.',
      'Chores by room, servicing and warranties, inventory, contacts and shopping.'
    ),
    icon: 'house',
    page: page(t('Casa', 'Household'), line('house'), [
      callout(
        '💡',
        t(
          [
            ['Marque '],
            b('Última vez'),
            [
              ' quando fizer uma tarefa: a próxima data se calcula sozinha pela frequência, e ela volta para esta página quando chegar a hora.'
            ]
          ],
          [
            ['Set '],
            b('Last done'),
            [' when you do a chore: the next date follows from how often it comes back, and it returns to this page when it is due.']
          ]
        )
      ),
      h2(t('Esta semana', 'This week')),
      linked(
        'chores',
        [
          views.table(t('Para fazer', 'To do'), ['title', 'room', 'next', 'who', 'last'], {
            filters: [where.checked('due')],
            sorts: [asc('next')]
          }),
          views.board(t('Por cômodo', 'By room'), 'room', ['next', 'who'], { filters: [where.checked('due')] })
        ],
        { title: t('Tarefas desta semana', "This week's chores") }
      ),
      linked(
        'shopping',
        [
          views.board(t('Falta comprar', 'Still to get'), 'store', ['amount'], {
            filters: [where.unchecked('bought')],
            sorts: [desc('urgent')]
          })
        ],
        { title: t('Lista de compras', 'Shopping list') }
      ),
      h2(t('Revisões e garantias', 'Servicing and warranties')),
      linked(
        'upkeep',
        [
          views.table(t('Próximas revisões', 'Next services'), ['title', 'next', 'late', 'contact'], {
            filters: [where.notEmpty('checked')],
            sorts: [asc('next')]
          }),
          views.table(t('Na garantia', 'Under warranty'), ['title', 'warranty', 'room'], {
            filters: [where.checked('covered')],
            sorts: [asc('warranty')]
          })
        ],
        { title: t('Manutenção', 'Upkeep') }
      ),
      divider(),
      page(t('Tudo da casa', 'Everything in the house'), line('box'), [
        p(
          t(
            'De onde a página Casa lê. Comece pelas tarefas: apague as que não servem e acrescente as suas.',
            'What the Household page reads from. Start with the chores: delete the ones that do not fit and add your own.'
          )
        ),
        database(
          'chores',
          t('Tarefas da casa', 'Chores'),
          line('brush'),
          chores,
          [
            views.table(t('Rotina', 'Routine'), ['title', 'room', 'frequency', 'last', 'next', 'who', 'minutes'], { sorts: [asc('next')] }),
            views.board(t('Por cômodo', 'By room'), 'room', ['frequency', 'next']),
            views.board(t('Por frequência', 'By how often'), 'frequency', ['room', 'next']),
            views.chart(t('Tempo por cômodo', 'Time by room'), {
              kind: 'bar',
              x: 'room',
              y: { aggregate: 'sum', property: 'minutes' },
              sort: 'y_desc',
              palette: 'options',
              showValues: true
            })
          ],
          [
            row(undefined, t('Lavar a louça', 'Do the dishes'), {
              room: 'kitchen',
              frequency: 'daily',
              last: inDays(-1),
              who: 'anyone',
              minutes: 20
            }),
            row(undefined, t('Tirar o lixo', 'Take out the trash'), {
              room: 'kitchen',
              frequency: 'daily',
              last: inDays(-1),
              who: 'me',
              minutes: 5
            }),
            row(undefined, t('Arrumar a cama', 'Make the bed'), {
              room: 'bedroom',
              frequency: 'daily',
              last: inDays(0),
              who: 'anyone',
              minutes: 5
            }),
            row(undefined, t('Lavar roupa', 'Laundry'), {
              room: 'laundry',
              frequency: 'weekly',
              last: inDays(-5),
              who: 'partner',
              minutes: 40
            }),
            row(undefined, t('Limpar o banheiro', 'Clean the bathroom'), {
              room: 'bathroom',
              frequency: 'weekly',
              last: inDays(-6),
              who: 'cleaner',
              minutes: 45
            }),
            row(undefined, t('Aspirar e passar pano', 'Vacuum and mop'), {
              room: 'whole',
              frequency: 'weekly',
              last: inDays(-3),
              who: 'cleaner',
              minutes: 60
            }),
            row(undefined, t('Trocar a roupa de cama', 'Change the sheets'), {
              room: 'bedroom',
              frequency: 'fortnightly',
              last: inDays(-12),
              who: 'me',
              minutes: 20
            }),
            row(undefined, t('Regar as plantas', 'Water the plants'), {
              room: 'outside',
              frequency: 'weekly',
              last: inDays(-4),
              who: 'partner',
              minutes: 10
            }),
            row(undefined, t('Limpar a geladeira', 'Clean out the fridge'), {
              room: 'kitchen',
              frequency: 'monthly',
              last: inDays(-26),
              who: 'anyone',
              minutes: 30
            }),
            row(undefined, t('Limpar o filtro da máquina de lavar', 'Clean the washing machine filter'), {
              room: 'laundry',
              frequency: 'quarterly',
              last: inDays(-70),
              who: 'me',
              minutes: 15
            }),
            row(undefined, t('Lavar cortinas', 'Wash the curtains'), {
              room: 'living',
              frequency: 'quarterly',
              last: inDays(-100),
              who: 'anyone',
              minutes: 50
            }),
            row(undefined, t('Limpar calhas', 'Clear the gutters'), {
              room: 'outside',
              frequency: 'yearly',
              last: inDays(-340),
              who: 'me',
              minutes: 90
            })
          ]
        ),
        database(
          'upkeep',
          t('Manutenção', 'Upkeep'),
          line('key'),
          upkeep,
          [
            views.table(
              t('Tudo', 'Everything'),
              ['title', 'room', 'checked', 'interval', 'next', 'late', 'warranty', 'covered', 'contact'],
              { sorts: [asc('next')] }
            ),
            views.list(t('Garantias', 'Warranties'), ['warranty', 'covered'], {
              filters: [where.notEmpty('warranty')],
              sorts: [asc('warranty')]
            })
          ],
          [
            row('ac', t('Ar-condicionado do quarto', 'Bedroom air conditioner'), {
              room: 'bedroom',
              checked: inDays(-160),
              interval: 6,
              warranty: inDays(220),
              contact: ['coldair'],
              notes: t('Limpar o filtro todo mês no verão.', 'Clean the filter every month in summer.')
            }),
            row('filter', t('Filtro de água', 'Water filter'), {
              room: 'kitchen',
              checked: inDays(-200),
              interval: 6,
              notes: t('Refil modelo C+3.', 'Cartridge model C+3.')
            }),
            row('heater', t('Aquecedor a gás', 'Gas water heater'), {
              room: 'laundry',
              checked: inDays(-300),
              interval: 12,
              contact: ['plumber']
            }),
            row('fridge', t('Geladeira', 'Fridge'), { room: 'kitchen', warranty: inDays(400) }),
            row('smoke', t('Detector de fumaça', 'Smoke alarm'), {
              room: 'whole',
              checked: inDays(-20),
              interval: 12,
              notes: t('Testar o botão e trocar a bateria.', 'Press the test button, change the battery.')
            }),
            row('wiring', t('Quadro de luz', 'Fuse box'), { room: 'whole', checked: inDays(-700), interval: 24, contact: ['electrician'] })
          ]
        ),
        database(
          'inventory',
          t('Inventário', 'Inventory'),
          line('box'),
          inventory,
          [
            views.table(t('Tudo', 'Everything'), ['title', 'room', 'kind', 'bought', 'price', 'where', 'serial']),
            views.board(t('Por cômodo', 'By room'), 'room', ['kind', 'price']),
            views.calc(t('Quanto vale', 'What it is worth'), [
              calc('total', t('Valor total', 'Total value'), `sum(${t('Valor', 'Price')})`, 'currency'),
              calc('items', t('Itens', 'Items'), 'count()')
            ])
          ],
          [
            row(undefined, t('Geladeira', 'Fridge'), {
              room: 'kitchen',
              kind: 'appliance',
              bought: inDays(-330),
              price: t(3800, 1200),
              where: t('Pasta azul, gaveta da escrivaninha', 'Blue folder, desk drawer'),
              serial: 'RF-48-2219'
            }),
            row(undefined, t('Máquina de lavar', 'Washing machine'), {
              room: 'laundry',
              kind: 'appliance',
              bought: inDays(-900),
              price: t(2600, 750),
              where: t('Pasta azul', 'Blue folder')
            }),
            row(undefined, t('Notebook', 'Laptop'), {
              room: 'living',
              kind: 'electronics',
              bought: inDays(-500),
              price: t(6500, 1400),
              serial: 'C02X-81LK'
            }),
            row(undefined, t('Sofá', 'Sofa'), { room: 'living', kind: 'furniture', bought: inDays(-1400), price: t(3200, 900) }),
            row(undefined, t('Furadeira', 'Drill'), { room: 'laundry', kind: 'tools', bought: inDays(-1100), price: t(350, 90) }),
            row(undefined, t('Escritura e contrato de aluguel', 'Lease and deeds'), {
              room: 'bedroom',
              kind: 'documents',
              where: t('Caixa-arquivo no armário', 'File box in the wardrobe')
            })
          ]
        ),
        database(
          'contacts',
          t('Contatos de serviços', 'Service contacts'),
          line('bell'),
          contacts,
          [
            views.table(t('Contatos', 'Contacts'), ['title', 'service', 'phone', 'opinion', 'lastCall', 'items']),
            views.board(t('Por serviço', 'By service'), 'service', ['phone', 'opinion'])
          ],
          [
            row('electrician', t('Seu Jorge', 'Mike Reyes'), {
              service: 'electrician',
              phone: t('(11) 98765-4321', '(555) 201-3344'),
              opinion: 'yes',
              lastCall: inDays(-700)
            }),
            row('plumber', t('Rafael Encanamentos', 'Dave the plumber'), {
              service: 'plumber',
              phone: t('(11) 97654-3210', '(555) 418-9902'),
              opinion: 'ok',
              lastCall: inDays(-300),
              notes: t('Cobra a visita à parte.', 'Charges a call-out fee.')
            }),
            row('coldair', t('Clima Bom Refrigeração', 'Cool Breeze HVAC'), {
              service: 'ac',
              phone: t('(11) 3456-7890', '(555) 730-1188'),
              opinion: 'yes',
              lastCall: inDays(-160)
            }),
            row(undefined, t('Dona Célia', 'Rosa'), {
              service: 'cleaner',
              phone: t('(11) 99876-5432', '(555) 662-0475'),
              opinion: 'yes',
              notes: t('Vem às quintas.', 'Comes on Thursdays.')
            }),
            row(undefined, t('Chaveiro 24h da esquina', 'Corner locksmith'), {
              service: 'locksmith',
              phone: t('(11) 3333-1212', '(555) 990-1212'),
              opinion: 'ok'
            })
          ]
        ),
        database(
          'shopping',
          t('Compras', 'Shopping'),
          line('cup'),
          shopping,
          [
            views.table(t('Lista', 'List'), ['title', 'store', 'amount', 'urgent', 'bought'], { filters: [where.unchecked('bought')] }),
            views.board(t('Por lugar', 'By store'), 'store', ['amount', 'urgent', 'bought']),
            views.table(t('Já comprados', 'Already got'), ['title', 'store'], { filters: [where.checked('bought')] })
          ],
          [
            row(undefined, t('Detergente', 'Dish soap'), { store: 'market', amount: '2', urgent: false, bought: false }),
            row(undefined, t('Papel higiênico', 'Toilet paper'), {
              store: 'market',
              amount: t('1 pacote', '1 pack'),
              urgent: true,
              bought: false
            }),
            row(undefined, t('Lâmpada LED', 'LED bulb'), { store: 'hardware', amount: '3', urgent: false, bought: false }),
            row(undefined, t('Refil do filtro de água', 'Water filter cartridge'), {
              store: 'online',
              amount: '1',
              urgent: false,
              bought: false
            }),
            row(undefined, t('Pilhas AA', 'AA batteries'), { store: 'pharmacy', amount: '4', urgent: false, bought: false }),
            row(undefined, t('Sabão em pó', 'Laundry detergent'), { store: 'market', amount: '1', urgent: false, bought: true })
          ]
        )
      ])
    ])
  }
}
