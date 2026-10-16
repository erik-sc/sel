// A library of what you read and watch: books, films and series, from "want to" to finished,
// with what you thought of each in words rather than a score, and the quotes and notes they
// left you, linked to them. The quotes in the examples come from works in the public domain.
import { asc, b, callout, chooser, database, desc, divider, h2, inDays, line, linked, opt, p, page, prop, row, schema, views, where } from './build'
import type { Template, TemplateLocale, TemplateValue } from './model'

export function library(locale: TemplateLocale): Template {
  const t = chooser(locale)

  const items = schema(
    prop.title(t('Título', 'Title')),
    prop.select('kind', t('Tipo', 'Kind'), [
      opt('book', t('Livro', 'Book'), 'brown'),
      opt('film', t('Filme', 'Film'), 'blue'),
      opt('series', t('Série', 'Series'), 'purple')
    ]),
    prop.text('creator', t('Autor ou direção', 'Author or director')),
    prop.select('status', t('Situação', 'Status'), [
      opt('want', t('Quero', 'Want to'), 'gray'),
      opt('now', t('Em andamento', 'In progress'), 'blue'),
      opt('done', t('Terminado', 'Finished'), 'green'),
      opt('left', t('Abandonado', 'Gave up'), 'red')
    ]),
    prop.select('verdict', t('O que achei', 'What I thought'), [
      opt('loved', t('Inesquecível', 'Unforgettable'), 'purple'),
      opt('liked', t('Gostei', 'Liked it'), 'green'),
      opt('ok', t('Ok', 'It was fine'), 'yellow'),
      opt('meh', t('Não era para mim', 'Not for me'), 'gray')
    ]),
    prop.multi('genres', t('Gêneros', 'Genres'), [
      opt('classic', t('Clássico', 'Classic'), 'brown'),
      opt('novel', t('Romance', 'Novel'), 'pink'),
      opt('drama', t('Drama', 'Drama'), 'orange'),
      opt('essay', t('Ensaio', 'Essay'), 'blue'),
      opt('animation', t('Animação', 'Animation'), 'green'),
      opt('scifi', t('Ficção científica', 'Science fiction'), 'purple')
    ]),
    prop.date('started', t('Comecei', 'Started')),
    prop.date('finished', t('Terminei', 'Finished on')),
    prop.text('from', t('Indicado por', 'Recommended by')),
    prop.relation('quotes', t('Citações', 'Quotes'), 'quotes', { synced: 'item' }),
    prop.rollup('quoteCount', t('Nº de citações', 'Quotes kept'), 'quotes', undefined, 'count')
  )

  const quotes = schema(
    prop.title(t('Citação ou anotação', 'Quote or note')),
    prop.relation('item', t('De', 'From'), 'items', { synced: 'quotes', one: true }),
    prop.text('where', t('Página ou minuto', 'Page or minute')),
    prop.multi('themes', t('Temas', 'Themes'), [
      opt('time', t('Tempo', 'Time'), 'blue'),
      opt('memory', t('Memória', 'Memory'), 'purple'),
      opt('living', t('Como viver', 'How to live'), 'green'),
      opt('love', t('Amor', 'Love'), 'pink'),
      opt('craft', t('Ofício', 'Craft'), 'orange')
    ]),
    prop.created('noted', t('Anotada em', 'Noted on'))
  )

  const item = (key: string, title: string, kind: string, creator: string, status: string, values: Record<string, TemplateValue> = {}) =>
    row(key, title, { kind, creator, status, ...values })

  return {
    id: 'library',
    locale,
    name: t('Biblioteca', 'Library'),
    description: t('Livros, filmes e séries: o que quero, o que estou vendo e o que ficou, com citações.', 'Books, films and series: what you want to, what you are on and what stayed, with quotes.'),
    icon: 'book',
    page: page(t('Biblioteca', 'Library'), line('book'), [
      callout(
        line('lantern'),
        t(
          [['Guarde aqui o que você quer ler e assistir. Ao terminar, diga '], b('o que achou'), [' em palavras — sem notas — e guarde as frases que ficaram.']],
          [['Keep what you want to read and watch here. When you finish, say '], b('what you thought'), [' in words, not scores, and keep the lines that stayed with you.']]
        )
      ),
      h2(t('Agora', 'Now')),
      linked('items', [views.list(t('Em andamento', 'In progress'), ['kind', 'creator', 'started'], { filters: [where.is('status', 'now')], sorts: [asc('started')] })], {
        title: t('Lendo e assistindo', 'Reading and watching')
      }),
      h2(t('Na fila', 'Up next')),
      linked('items', [views.board(t('Quero', 'Want to'), 'kind', ['creator', 'from'], { filters: [where.is('status', 'want')] })], { title: t('Quero ler e assistir', 'Want to read and watch') }),
      h2(t('O que ficou', 'What stayed')),
      linked(
        'items',
        [
          views.chart(
            t('O que achei', 'What I thought'),
            { kind: 'donut', x: 'verdict', y: { aggregate: 'count' }, palette: 'options', showLegend: true, sort: 'manual', height: 220 },
            { filters: [where.is('status', 'done')] }
          )
        ],
        { title: t('Do que terminei', 'Of what I finished') }
      ),
      linked(
        'items',
        [
          views.chart(
            t('Por mês', 'By month'),
            { kind: 'column', x: 'finished', xDateBucket: 'month', y: { aggregate: 'count' }, series: 'kind', stacked: true, palette: 'options', showLegend: true, sort: 'x_asc', height: 220 },
            { filters: [where.is('status', 'done')] }
          )
        ],
        { title: t('Terminados por mês', 'Finished by month'), beside: true }
      ),
      linked('quotes', [views.list(t('Recentes', 'Latest'), ['item', 'where'], { sorts: [desc('noted')] })], { title: t('Citações e anotações', 'Quotes and notes') }),
      divider(),
      h2(t('Acervo', 'Collection')),
      p(t('Tudo o que já passou por aqui, em qualquer situação.', 'Everything that has come through here, in any state.')),
      database(
        'items',
        t('Livros, filmes e séries', 'Books, films and series'),
        line('book'),
        items,
        [
          views.board(t('Estante', 'Shelf'), 'status', ['kind', 'creator', 'verdict']),
          views.table(t('Tudo', 'Everything'), ['title', 'kind', 'creator', 'status', 'verdict', 'genres', 'started', 'finished', 'from', 'quoteCount']),
          views.list(t('Terminados', 'Finished'), ['kind', 'verdict', 'finished'], { filters: [where.is('status', 'done')], sorts: [desc('finished')] }),
          views.gallery(t('Por tipo', 'By kind'), ['kind', 'creator', 'verdict'])
        ],
        t(
          [
            item('b1', 'Dom Casmurro', 'book', 'Machado de Assis', 'done', { verdict: 'loved', genres: ['classic', 'novel'], started: inDays(-60), finished: inDays(-41) }),
            item('b2', 'Memórias póstumas de Brás Cubas', 'book', 'Machado de Assis', 'done', { verdict: 'liked', genres: ['classic', 'novel'], started: inDays(-110), finished: inDays(-88) }),
            item('b3', 'Torto Arado', 'book', 'Itamar Vieira Junior', 'now', { genres: ['novel'], started: inDays(-9), from: 'Clube do livro' }),
            item('b4', 'A hora da estrela', 'book', 'Clarice Lispector', 'want', { genres: ['classic', 'novel'], from: 'Marina' }),
            item('f1', 'Central do Brasil', 'film', 'Walter Salles', 'done', { verdict: 'loved', genres: ['drama'], finished: inDays(-20) }),
            item('f2', 'Cidade de Deus', 'film', 'Fernando Meirelles e Kátia Lund', 'done', { verdict: 'liked', genres: ['drama'], finished: inDays(-63) }),
            item('f3', 'O som ao redor', 'film', 'Kleber Mendonça Filho', 'done', { verdict: 'ok', genres: ['drama'], finished: inDays(-35) }),
            item('f4', 'Dias perfeitos', 'film', 'Wim Wenders', 'want', { genres: ['drama'], from: 'Pedro' }),
            item('s1', 'Ruptura', 'series', 'Dan Erickson', 'now', { genres: ['scifi'], started: inDays(-14) }),
            item('f5', 'A viagem de Chihiro', 'film', 'Hayao Miyazaki', 'done', { verdict: 'loved', genres: ['animation'], finished: inDays(-5) })
          ],
          [
            item('b1', 'Walden', 'book', 'Henry David Thoreau', 'done', { verdict: 'loved', genres: ['classic', 'essay'], started: inDays(-60), finished: inDays(-41) }),
            item('b2', 'Pride and Prejudice', 'book', 'Jane Austen', 'done', { verdict: 'liked', genres: ['classic', 'novel'], started: inDays(-110), finished: inDays(-88) }),
            item('b3', 'The Remains of the Day', 'book', 'Kazuo Ishiguro', 'now', { genres: ['novel'], started: inDays(-9), from: 'Book club' }),
            item('b4', 'Middlemarch', 'book', 'George Eliot', 'want', { genres: ['classic', 'novel'], from: 'Maya' }),
            item('f1', 'Paterson', 'film', 'Jim Jarmusch', 'done', { verdict: 'loved', genres: ['drama'], finished: inDays(-20) }),
            item('f2', 'Columbus', 'film', 'Kogonada', 'done', { verdict: 'liked', genres: ['drama'], finished: inDays(-63) }),
            item('f3', 'Lost in Translation', 'film', 'Sofia Coppola', 'done', { verdict: 'ok', genres: ['drama'], finished: inDays(-35) }),
            item('f4', 'Perfect Days', 'film', 'Wim Wenders', 'want', { genres: ['drama'], from: 'Ben' }),
            item('s1', 'Severance', 'series', 'Dan Erickson', 'now', { genres: ['scifi'], started: inDays(-14) }),
            item('f5', 'Spirited Away', 'film', 'Hayao Miyazaki', 'done', { verdict: 'loved', genres: ['animation'], finished: inDays(-5) })
          ]
        )
      ),
      database(
        'quotes',
        t('Citações e anotações', 'Quotes and notes'),
        line('feather'),
        quotes,
        [
          views.list(t('Todas', 'All'), ['item', 'where', 'themes'], { sorts: [desc('noted')] }),
          views.table(t('Tabela', 'Table'), ['title', 'item', 'where', 'themes', 'noted'])
        ],
        t(
          [
            row(undefined, 'Matamos o tempo; o tempo nos enterra.', { item: ['b2'], where: 'cap. CXIX', themes: ['time'] }),
            row(undefined, 'O meu fim evidente era atar as duas pontas da vida, e restaurar na velhice a adolescência.', { item: ['b1'], where: 'cap. II', themes: ['memory', 'time'] }),
            row(undefined, 'Rever: a cena das cartas, no fim. Tudo o que o filme diz sem dizer.', { item: ['f1'], where: '1h45', themes: ['craft'] })
          ],
          [
            row(undefined, 'I went to the woods because I wished to live deliberately.', { item: ['b1'], where: 'ch. 2', themes: ['living'] }),
            row(undefined, 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', { item: ['b2'], where: 'ch. 1', themes: ['love'] }),
            row(undefined, 'Watch again: the poems written on screen, a line at a time. The whole film is in that rhythm.', { item: ['f1'], where: '0:12', themes: ['craft'] })
          ]
        )
      )
    ])
  }
}
