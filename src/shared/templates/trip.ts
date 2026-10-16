// A trip: the itinerary day by day (a calendar), bookings and documents, the packing list, the
// budget in the currencies it is spent in (each linked to its rate, converted back home), and
// the places worth seeing, grouped by city. The example is a week in Portugal a month from now.
import { asc, b, calc, callout, chooser, database, divider, h2, h3, inDays, line, linked, opt, p, page, prop, row, schema, todo, views, where } from './build'
import type { Template, TemplateLocale, TemplateValue } from './model'

export function trip(locale: TemplateLocale): Template {
  const t = chooser(locale)
  /** The first day of the trip, in days from today. */
  const D = 30
  const HOME = t('R$', 'US$')

  const cities = [
    opt('lisbon', t('Lisboa', 'Lisbon'), 'yellow'),
    opt('sintra', 'Sintra', 'green'),
    opt('porto', 'Porto', 'blue')
  ]

  const itinerary = schema(
    prop.title(t('O quê', 'What')),
    prop.date('when', t('Quando', 'When')),
    prop.select('city', t('Cidade', 'City'), cities),
    prop.select('kind', t('Tipo', 'Kind'), [
      opt('travel', t('Deslocamento', 'Getting there'), 'gray'),
      opt('stay', t('Hospedagem', 'Stay'), 'purple'),
      opt('visit', t('Passeio', 'Sightseeing'), 'green'),
      opt('food', t('Comida', 'Food'), 'orange'),
      opt('free', t('Livre', 'Free time'), 'blue')
    ]),
    prop.relation('place', t('Lugar', 'Place'), 'places', { synced: 'plans', one: true }),
    prop.relation('booking', t('Reserva', 'Booking'), 'bookings', { synced: 'plans', one: true }),
    prop.text('notes', t('Anotações', 'Notes'))
  )

  const bookings = schema(
    prop.title(t('Reserva ou documento', 'Booking or document')),
    prop.select('kind', t('Tipo', 'Kind'), [
      opt('flight', t('Voo', 'Flight'), 'blue'),
      opt('hotel', t('Hospedagem', 'Stay'), 'purple'),
      opt('train', t('Trem', 'Train'), 'green'),
      opt('ticket', t('Ingresso', 'Ticket'), 'orange'),
      opt('insurance', t('Seguro', 'Insurance'), 'red'),
      opt('document', t('Documento', 'Document'), 'gray')
    ]),
    prop.date('date', t('Data', 'Date')),
    prop.text('code', t('Localizador', 'Reference')),
    prop.checkbox('confirmed', t('Confirmado', 'Confirmed')),
    prop.checkbox('printed', t('Impresso / no celular', 'Printed or on phone')),
    prop.relation('plans', t('No roteiro', 'In the itinerary'), 'itinerary', { synced: 'booking' })
  )

  const packing = schema(
    prop.title(t('Item', 'Item')),
    prop.select('group', t('Grupo', 'Group'), [
      opt('docs', t('Documentos', 'Documents'), 'red'),
      opt('clothes', t('Roupas', 'Clothes'), 'blue'),
      opt('toiletries', t('Higiene', 'Toiletries'), 'green'),
      opt('tech', t('Eletrônicos', 'Electronics'), 'purple'),
      opt('health', t('Remédios', 'Medicine'), 'orange'),
      opt('other', t('Outros', 'Other'), 'gray')
    ]),
    prop.number('qty', t('Quantidade', 'How many')),
    prop.checkbox('packed', t('Na mala', 'Packed'))
  )

  const currencies = schema(
    prop.title(t('Moeda', 'Currency')),
    prop.number('rate', t(`Cotação (em ${HOME})`, `Rate (in ${HOME})`)),
    prop.relation('spending', t('Gastos', 'Spending'), 'budget', { synced: 'currency' }),
    prop.rollup('total', t('Total na moeda', 'Total in the currency'), 'spending', 'amount', 'sum'),
    prop.formula('home', t('Total convertido', 'Total converted'), 'round(if(empty(prop("total")), 0, prop("total")) * prop("rate"), 2)', 'currency')
  )

  const budget = schema(
    prop.title(t('Gasto', 'Expense')),
    prop.select('kind', t('Categoria', 'Category'), [
      opt('stay', t('Hospedagem', 'Stay'), 'purple'),
      opt('transport', t('Transporte', 'Transport'), 'blue'),
      opt('food', t('Comida', 'Food'), 'orange'),
      opt('visits', t('Passeios', 'Sights'), 'green'),
      opt('shopping', t('Compras', 'Shopping'), 'pink'),
      opt('other', t('Outros', 'Other'), 'gray')
    ]),
    prop.number('amount', t('Valor', 'Amount')),
    prop.relation('currency', t('Moeda', 'Currency'), 'currencies', { synced: 'spending', one: true }),
    prop.rollup('rate', t('Cotação', 'Rate'), 'currency', 'rate', 'sum'),
    prop.formula('home', t(`Em ${HOME}`, `In ${HOME}`), 'round(prop("amount") * if(empty(prop("rate")), 1, prop("rate")), 2)', 'currency'),
    prop.select('status', t('Situação', 'Status'), [
      opt('planned', t('Previsto', 'Planned'), 'gray'),
      opt('paid', t('Pago', 'Paid'), 'green')
    ]),
    prop.date('date', t('Data', 'Date'))
  )

  const places = schema(
    prop.title(t('Lugar', 'Place')),
    prop.select('city', t('Cidade', 'City'), cities),
    prop.select('kind', t('Tipo', 'Kind'), [
      opt('museum', t('Museu', 'Museum'), 'purple'),
      opt('view', t('Mirante', 'Viewpoint'), 'blue'),
      opt('food', t('Comer e beber', 'Food and drink'), 'orange'),
      opt('walk', t('Bairro e passeio', 'Neighbourhood'), 'green'),
      opt('shop', t('Livraria e lojas', 'Books and shops'), 'pink')
    ]),
    prop.select('status', t('Situação', 'Status'), [
      opt('want', t('Quero ir', 'Want to go'), 'gray'),
      opt('planned', t('No roteiro', 'Planned'), 'blue'),
      opt('been', t('Fui', 'Been there'), 'green')
    ]),
    prop.text('address', t('Endereço', 'Address')),
    prop.text('tip', t('Dica', 'Tip')),
    prop.relation('plans', t('No roteiro', 'In the itinerary'), 'itinerary', { synced: 'place' })
  )

  const stop = (title: string, when: TemplateValue, city: string, kind: string, extra: Record<string, TemplateValue> = {}) =>
    row(undefined, title, { when, city, kind, ...extra })

  return {
    id: 'trip',
    locale,
    name: t('Viagem', 'Trip'),
    description: t('Roteiro dia a dia, reservas, mala, orçamento em outra moeda e lugares por cidade.', 'Day-by-day itinerary, bookings, packing, a budget in another currency and places by city.'),
    icon: 'boat',
    page: page(t('Viagem', 'Trip'), line('boat'), [
      callout(
        line('lantern'),
        t(
          [['Comece pelo '], b('Roteiro'), [': cada linha é um momento da viagem, ligado ao lugar e à reserva. Troque as datas e a página acompanha.']],
          [['Start with the '], b('Itinerary'), [': each line is a moment of the trip, linked to its place and its booking. Change the dates and the page follows.']]
        )
      ),
      h2(t('Antes de ir', 'Before you go')),
      linked(
        'bookings',
        [views.table(t('Falta confirmar', 'Not confirmed yet'), ['title', 'kind', 'date', 'code'], { filters: [where.unchecked('confirmed')], sorts: [asc('date')] })],
        { title: t('Reservas pendentes', 'Bookings to confirm') }
      ),
      linked(
        'packing',
        [
          views.calc(t('A mala', 'The suitcase'), [
            calc('packed', t('Já na mala', 'Packed'), `count(${t('Na mala', 'Packed')}) / count()`, 'percent'),
            calc('left', t('Faltam', 'Still to pack'), `count() - count(${t('Na mala', 'Packed')})`)
          ])
        ],
        { title: t('Mala', 'Packing'), beside: true }
      ),
      h3(t('Uma semana antes', 'A week before')),
      todo(t('Avisar o banco sobre a viagem', 'Tell the bank about the trip')),
      todo(t('Baixar os mapas offline', 'Download offline maps')),
      todo(t('Separar dinheiro local para os primeiros dias', 'Get some local cash for the first days')),
      h2(t('Roteiro', 'Itinerary')),
      linked('itinerary', [views.calendar(t('Calendário', 'Calendar'), 'when', ['title', 'city'])], { title: t('A viagem no calendário', 'The trip on a calendar') }),
      h2(t('Orçamento', 'Budget')),
      p(
        t(
          'Lance cada gasto na moeda em que foi pago e ligue-o à moeda: a cotação o converte para reais.',
          'Enter each expense in the currency it was paid in and link it to that currency: its rate converts it to dollars.'
        )
      ),
      linked('currencies', [views.table(t('Por moeda', 'By currency'), ['title', 'rate', 'total', 'home'])], { title: t('Quanto em cada moeda', 'How much in each currency') }),
      linked(
        'budget',
        [
          views.chart(t('Por categoria', 'By category'), {
            kind: 'donut',
            x: 'kind',
            y: { aggregate: 'sum', property: 'amount' },
            palette: 'options',
            showLegend: true,
            sort: 'manual',
            height: 220
          }, { filters: [where.links('currency', ['eur'])] })
        ],
        { title: t('Gastos na moeda do destino', 'Spending in the local currency') }
      ),
      divider(),
      h2(t('Tudo da viagem', 'Everything about the trip')),
      database(
        'itinerary',
        t('Roteiro', 'Itinerary'),
        line('path'),
        itinerary,
        [
          views.list(t('Dia a dia', 'Day by day'), ['when', 'city', 'kind', 'place'], { sorts: [asc('when')] }),
          views.calendar(t('Calendário', 'Calendar'), 'when', ['title', 'city']),
          views.board(t('Por cidade', 'By city'), 'city', ['when', 'kind']),
          views.table(t('Tabela', 'Table'), ['title', 'when', 'city', 'kind', 'place', 'booking', 'notes'], { sorts: [asc('when')] })
        ],
        [
          stop(t('Voo para Lisboa', 'Flight to Lisbon'), inDays(D, '22:40', D + 1, '12:15'), 'lisbon', 'travel', { booking: ['flight'] }),
          stop(t('Check-in na Alfama', 'Check in at Alfama'), inDays(D + 1, '15:00'), 'lisbon', 'stay', { booking: ['hotel1'] }),
          stop(t('Castelo e miradouros', 'The castle and viewpoints'), inDays(D + 2, '09:30'), 'lisbon', 'visit', { place: ['castle'] }),
          stop(t('Bonde 28 até a Graça', 'Tram 28 up to Graça'), inDays(D + 2, '15:00'), 'lisbon', 'free', { place: ['graca'] }),
          stop(t('Belém e pastéis', 'Belém and custard tarts'), inDays(D + 3, '10:00'), 'lisbon', 'visit', {
            place: ['belem'],
            notes: t('Chegar cedo: a fila do mosteiro cresce depois das 11h.', 'Get there early: the monastery line grows after 11.')
          }),
          stop(t('Bate-volta a Sintra', 'Day trip to Sintra'), inDays(D + 4, '08:30'), 'sintra', 'visit', { place: ['pena'], booking: ['penaTicket'] }),
          stop(t('Trem para o Porto', 'Train to Porto'), inDays(D + 5, '09:00', D + 5, '12:00'), 'porto', 'travel', { booking: ['train'] }),
          stop(t('Check-in na Ribeira', 'Check in by the river'), inDays(D + 5, '14:00'), 'porto', 'stay', { booking: ['hotel2'] }),
          stop(t('Livraria e Clérigos', 'Bookshop and Clérigos tower'), inDays(D + 6, '10:00'), 'porto', 'visit', { place: ['lello'] }),
          stop(t('Jantar de despedida', 'Farewell dinner'), inDays(D + 6, '20:30'), 'porto', 'food', { place: ['tasca'] }),
          stop(t('Voo de volta', 'Flight home'), inDays(D + 7, '11:20'), 'porto', 'travel', { booking: ['flightHome'] })
        ]
      ),
      database(
        'bookings',
        t('Reservas e documentos', 'Bookings and documents'),
        line('key'),
        bookings,
        [
          views.table(t('Tudo', 'Everything'), ['title', 'kind', 'date', 'code', 'confirmed', 'printed'], { sorts: [asc('date')] }),
          views.board(t('Por tipo', 'By kind'), 'kind', ['date', 'confirmed'])
        ],
        [
          row('passport', t('Passaporte (validade)', 'Passport (expiry)'), { kind: 'document', date: inDays(900), confirmed: true, printed: true }),
          row('insurance', t('Seguro viagem', 'Travel insurance'), { kind: 'insurance', date: inDays(D, undefined, D + 7), code: 'SV-208341', confirmed: true, printed: false }),
          row('flight', t('Voo de ida', 'Outbound flight'), { kind: 'flight', date: inDays(D, '22:40'), code: 'XK7P2Q', confirmed: true, printed: true }),
          row('hotel1', t('Apartamento na Alfama', 'Apartment in Alfama'), { kind: 'hotel', date: inDays(D + 1, undefined, D + 5), code: '4417-221', confirmed: true, printed: false }),
          row('penaTicket', t('Ingresso do Palácio da Pena', 'Pena Palace ticket'), { kind: 'ticket', date: inDays(D + 4, '09:30'), confirmed: false, printed: false }),
          row('train', t('Trem Lisboa–Porto', 'Lisbon–Porto train'), { kind: 'train', date: inDays(D + 5, '09:00'), code: 'AP 123', confirmed: false, printed: false }),
          row('hotel2', t('Pousada na Ribeira', 'Guesthouse in Ribeira'), { kind: 'hotel', date: inDays(D + 5, undefined, D + 7), code: 'RB-77310', confirmed: true, printed: false }),
          row('flightHome', t('Voo de volta', 'Return flight'), { kind: 'flight', date: inDays(D + 7, '11:20'), code: 'XK7P2Q', confirmed: true, printed: true })
        ]
      ),
      database(
        'packing',
        t('Mala', 'Packing list'),
        line('box'),
        packing,
        [
          views.board(t('Por grupo', 'By group'), 'group', ['qty', 'packed']),
          views.table(t('Falta pôr', 'Still to pack'), ['title', 'group', 'qty'], { filters: [where.unchecked('packed')] })
        ],
        [
          row(undefined, t('Passaporte', 'Passport'), { group: 'docs', qty: 1, packed: true }),
          row(undefined, t('Cartão do seguro', 'Insurance card'), { group: 'docs', qty: 1, packed: false }),
          row(undefined, t('Camisetas', 'T-shirts'), { group: 'clothes', qty: 5, packed: false }),
          row(undefined, t('Casaco leve', 'Light jacket'), { group: 'clothes', qty: 1, packed: false }),
          row(undefined, t('Tênis confortável', 'Comfortable shoes'), { group: 'clothes', qty: 1, packed: true }),
          row(undefined, t('Escova e pasta de dente', 'Toothbrush and toothpaste'), { group: 'toiletries', qty: 1, packed: false }),
          row(undefined, t('Protetor solar', 'Sunscreen'), { group: 'toiletries', qty: 1, packed: false }),
          row(undefined, t('Adaptador de tomada', 'Plug adapter'), { group: 'tech', qty: 2, packed: false }),
          row(undefined, t('Carregador e bateria externa', 'Charger and power bank'), { group: 'tech', qty: 1, packed: true }),
          row(undefined, t('Remédio de enjoo', 'Motion sickness pills'), { group: 'health', qty: 1, packed: false }),
          row(undefined, t('Garrafa de água', 'Water bottle'), { group: 'other', qty: 1, packed: false })
        ]
      ),
      database(
        'currencies',
        t('Moedas', 'Currencies'),
        line('stones'),
        currencies,
        [views.table(t('Moedas', 'Currencies'), ['title', 'rate', 'total', 'home', 'spending'])],
        [row('eur', t('Euro (€)', 'Euro (€)'), { rate: t(6.2, 1.1) }), row('home', t('Real (R$)', 'Dollar (US$)'), { rate: 1 })]
      ),
      database(
        'budget',
        t('Orçamento', 'Budget'),
        line('hourglass'),
        budget,
        [
          views.table(t('Gastos', 'Expenses'), ['title', 'kind', 'amount', 'currency', 'home', 'status', 'date'], { sorts: [asc('date')] }),
          views.board(t('Por situação', 'By status'), 'status', ['amount', 'currency', 'home'])
        ],
        [
          row(undefined, t('Passagens de ida e volta', 'Return flights'), { kind: 'transport', amount: t(4800, 980), currency: ['home'], status: 'paid', date: inDays(-12) }),
          row(undefined, t('Seguro viagem', 'Travel insurance'), { kind: 'other', amount: t(210, 45), currency: ['home'], status: 'paid', date: inDays(-10) }),
          row(undefined, t('Apartamento na Alfama (4 noites)', 'Alfama apartment (4 nights)'), { kind: 'stay', amount: 480, currency: ['eur'], status: 'paid', date: inDays(-8) }),
          row(undefined, t('Pousada no Porto (2 noites)', 'Porto guesthouse (2 nights)'), { kind: 'stay', amount: 190, currency: ['eur'], status: 'planned', date: inDays(D + 5) }),
          row(undefined, t('Trem Lisboa–Porto', 'Lisbon–Porto train'), { kind: 'transport', amount: 50, currency: ['eur'], status: 'planned', date: inDays(D + 5) }),
          row(undefined, t('Palácio da Pena', 'Pena Palace'), { kind: 'visits', amount: 40, currency: ['eur'], status: 'planned', date: inDays(D + 4) }),
          row(undefined, t('Comida (estimativa, 7 dias)', 'Food (estimate, 7 days)'), { kind: 'food', amount: 280, currency: ['eur'], status: 'planned', date: inDays(D + 1) }),
          row(undefined, t('Lembranças', 'Souvenirs'), { kind: 'shopping', amount: 60, currency: ['eur'], status: 'planned', date: inDays(D + 6) })
        ]
      ),
      database(
        'places',
        t('Lugares para conhecer', 'Places to see'),
        line('mountain'),
        places,
        [
          views.board(t('Mapa por cidade', 'Map by city'), 'city', ['kind', 'status']),
          views.board(t('Por situação', 'By status'), 'status', ['city', 'kind']),
          views.table(t('Tabela', 'Table'), ['title', 'city', 'kind', 'status', 'address', 'tip'])
        ],
        [
          row('castle', t('Castelo de São Jorge', 'São Jorge Castle'), { city: 'lisbon', kind: 'view', status: 'planned', tip: t('A vista do pôr do sol vale a fila.', 'The sunset view is worth the line.') }),
          row('graca', t('Miradouro da Graça', 'Graça viewpoint'), { city: 'lisbon', kind: 'view', status: 'planned' }),
          row('belem', t('Mosteiro dos Jerónimos', 'Jerónimos Monastery'), { city: 'lisbon', kind: 'museum', status: 'planned', address: 'Praça do Império, Belém' }),
          row(undefined, t('LX Factory', 'LX Factory'), { city: 'lisbon', kind: 'shop', status: 'want' }),
          row('pena', t('Palácio da Pena', 'Pena Palace'), { city: 'sintra', kind: 'museum', status: 'planned', tip: t('Subir de ônibus, descer a pé pelo parque.', 'Take the bus up, walk down through the park.') }),
          row(undefined, t('Quinta da Regaleira', 'Quinta da Regaleira'), { city: 'sintra', kind: 'walk', status: 'want' }),
          row('lello', t('Livraria Lello', 'Livraria Lello'), { city: 'porto', kind: 'shop', status: 'planned', tip: t('O ingresso vira desconto num livro.', 'The ticket counts towards a book.') }),
          row('tasca', t('Tasca na Ribeira', 'A tasca in Ribeira'), { city: 'porto', kind: 'food', status: 'planned' }),
          row(undefined, t('Ponte Luís I ao entardecer', 'Luís I Bridge at dusk'), { city: 'porto', kind: 'view', status: 'want' })
        ]
      )
    ])
  }
}
