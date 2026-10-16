// The kitchen: a recipe book (each recipe a page with its ingredients and its steps), the menu
// of the week linked to the recipes, and the shopping list by aisle, linked to what it is for.
// The recipes differ by language: everyday food of each place, written as it would be at home.
import { asc, b, bullet, callout, chooser, database, divider, h2, h3, line, linked, numbered, onWeekday, opt, p, page, prop, row, schema, views, where } from './build'
import type { Template, TemplateLocale, TemplateNode, TemplateRow, TemplateValue } from './model'

export function kitchen(locale: TemplateLocale): Template {
  const t = chooser(locale)

  const recipes = schema(
    prop.title(t('Receita', 'Recipe')),
    prop.select('meal', t('Refeição', 'Meal'), [
      opt('breakfast', t('Café da manhã', 'Breakfast'), 'yellow'),
      opt('main', t('Almoço e jantar', 'Lunch and dinner'), 'orange'),
      opt('snack', t('Lanche', 'Snack'), 'green'),
      opt('dessert', t('Sobremesa', 'Dessert'), 'pink')
    ]),
    prop.number('minutes', t('Tempo (min)', 'Time (min)')),
    prop.number('servings', t('Porções', 'Serves')),
    prop.select('effort', t('Dificuldade', 'Effort'), [
      opt('easy', t('Fácil', 'Easy'), 'green'),
      opt('medium', t('Média', 'Some care'), 'yellow'),
      opt('project', t('Trabalhosa', 'A project'), 'red')
    ]),
    prop.multi('tags', t('Etiquetas', 'Tags'), [
      opt('veg', t('Vegetariana', 'Vegetarian'), 'green'),
      opt('quick', t('Rápida', 'Quick'), 'blue'),
      opt('freezes', t('Congela bem', 'Freezes well'), 'purple'),
      opt('lunchbox', t('Marmita', 'Lunchbox'), 'orange'),
      opt('oven', t('Forno', 'Oven'), 'red'),
      opt('onepot', t('Uma panela só', 'One pot'), 'brown')
    ]),
    prop.text('ingredients', t('Ingredientes principais', 'Main ingredients')),
    prop.checkbox('favorite', t('Favorita', 'Favourite')),
    prop.text('source', t('De onde veio', 'Where it came from'))
  )

  const menu = schema(
    prop.title(t('Dia', 'Day')),
    prop.date('date', t('Data', 'Date')),
    prop.relation('lunch', t('Almoço', 'Lunch'), 'recipes'),
    prop.relation('dinner', t('Jantar', 'Dinner'), 'recipes'),
    prop.select('cook', t('Quem cozinha', 'Who cooks'), [
      opt('me', t('Eu', 'Me'), 'blue'),
      opt('partner', t('Ana', 'Sam'), 'pink'),
      opt('together', t('Juntos', 'Together'), 'green'),
      opt('out', t('Comer fora', 'Eating out'), 'gray')
    ]),
    prop.rollup('dinnerTime', t('Tempo do jantar (min)', 'Dinner time (min)'), 'dinner', 'minutes', 'sum'),
    prop.text('notes', t('Observação', 'Note'))
  )

  const shopping = schema(
    prop.title(t('Item', 'Item')),
    prop.select('aisle', t('Seção', 'Aisle'), [
      opt('produce', t('Hortifrúti', 'Produce'), 'green'),
      opt('meat', t('Açougue e peixaria', 'Meat and fish'), 'red'),
      opt('bakery', t('Padaria', 'Bakery'), 'yellow'),
      opt('dairy', t('Laticínios', 'Dairy'), 'blue'),
      opt('pantry', t('Mercearia', 'Pantry'), 'brown'),
      opt('cleaning', t('Limpeza', 'Household'), 'gray')
    ]),
    prop.text('amount', t('Quanto', 'How much')),
    prop.relation('recipe', t('Para', 'For'), 'recipes'),
    prop.checkbox('got', t('Comprado', 'Got it'))
  )

  const body = (ingredients: string[], steps: string[], tip?: string): TemplateNode[] => [
    h3(t('Ingredientes', 'Ingredients')),
    ...ingredients.map((item) => bullet(item)),
    h3(t('Modo de preparo', 'Method')),
    ...steps.map((step) => numbered(step)),
    ...(tip ? [callout(line('leaf'), tip, 'green_background')] : [])
  ]

  interface Recipe {
    key: string
    title: string
    meal: string
    minutes: number
    servings: number
    effort: string
    tags: string[]
    ingredients: string[]
    steps: string[]
    tip?: string
    favorite?: boolean
    source?: string
  }
  const recipe = (r: Recipe): TemplateRow =>
    row(
      r.key,
      r.title,
      {
        meal: r.meal,
        minutes: r.minutes,
        servings: r.servings,
        effort: r.effort,
        tags: r.tags,
        ingredients: r.ingredients
          .slice(0, 4)
          .map((i) => i.replace(/^[\d½¼¾,./ ]+(xícaras?|colheres?( de sopa| de chá)?|cups?|tbsp|tsp|g|kg|lb|ml|l|dentes?|cloves?|cans?|latas?|fatias?|folhas?)?( de)? /i, '').split(',')[0])
          .map((i) => i.charAt(0).toLowerCase() + i.slice(1))
          .join(', ')
          .replace(/^./, (c) => c.toUpperCase()),
        favorite: r.favorite === true,
        ...(r.source ? { source: r.source } : {})
      },
      body(r.ingredients, r.steps, r.tip)
    )

  const recipeRows: Recipe[] = t(
    [
      {
        key: 'r1',
        title: 'Feijão de panela de pressão',
        meal: 'main',
        minutes: 90,
        servings: 8,
        effort: 'easy',
        tags: ['freezes', 'onepot', 'lunchbox'],
        favorite: true,
        source: 'Caderno da vó',
        ingredients: ['500 g de feijão carioca', '2 folhas de louro', '1 cebola picada', '3 dentes de alho', '100 g de bacon em cubos', 'Sal a gosto'],
        steps: [
          'Deixe o feijão de molho por 8 horas e descarte a água.',
          'Cozinhe na pressão com água cobrindo dois dedos e o louro, por 25 minutos depois de pegar pressão.',
          'Doure o bacon, depois a cebola e o alho.',
          'Junte uma concha de feijão, amasse e devolva tudo à panela. Ferva 10 minutos para engrossar.'
        ],
        tip: 'Congela bem em potes de uma refeição.'
      },
      {
        key: 'r2',
        title: 'Bolo de cenoura com cobertura de chocolate',
        meal: 'snack',
        minutes: 60,
        servings: 12,
        effort: 'medium',
        tags: ['oven'],
        favorite: true,
        ingredients: ['3 cenouras médias', '3 ovos', '1 xícara de óleo', '2 xícaras de açúcar', '2 xícaras de farinha de trigo', '1 colher de sopa de fermento', 'Cobertura: 4 colheres de chocolate em pó, 1 colher de manteiga, 3 colheres de açúcar, 3 colheres de leite'],
        steps: [
          'Bata no liquidificador a cenoura, os ovos e o óleo.',
          'Misture com o açúcar e a farinha; por último, o fermento.',
          'Asse em forma untada a 180 °C por cerca de 40 minutos.',
          'Ferva os ingredientes da cobertura até engrossar e despeje sobre o bolo ainda quente.'
        ]
      },
      {
        key: 'r3',
        title: 'Arroz soltinho',
        meal: 'main',
        minutes: 25,
        servings: 4,
        effort: 'easy',
        tags: ['quick', 'veg', 'onepot'],
        ingredients: ['2 xícaras de arroz', '4 xícaras de água quente', '1/2 cebola picada', '2 dentes de alho', '1 colher de sopa de azeite', 'Sal'],
        steps: ['Refogue a cebola e o alho no azeite.', 'Junte o arroz e frite até ficar opaco.', 'Cubra com a água quente e o sal; cozinhe em fogo baixo, tampado, até secar.', 'Desligue e deixe descansar 5 minutos tampado.']
      },
      {
        key: 'r4',
        title: 'Frango assado com legumes',
        meal: 'main',
        minutes: 70,
        servings: 4,
        effort: 'easy',
        tags: ['oven', 'onepot'],
        ingredients: ['1 kg de sobrecoxa', '4 batatas', '2 cenouras', '1 cebola roxa', 'Limão, alho, páprica e alecrim', 'Azeite e sal'],
        steps: ['Tempere o frango com limão, alho, páprica e sal e deixe descansar 30 minutos.', 'Corte os legumes em pedaços parecidos e espalhe na assadeira com azeite.', 'Ponha o frango por cima e asse a 200 °C por 45 minutos, virando na metade.']
      },
      {
        key: 'r5',
        title: 'Escondidinho de mandioca com carne seca',
        meal: 'main',
        minutes: 80,
        servings: 6,
        effort: 'project',
        tags: ['oven', 'freezes', 'lunchbox'],
        ingredients: ['1 kg de mandioca', '500 g de carne seca dessalgada', '1 cebola', '200 g de requeijão', '100 g de queijo coalho ralado', 'Manteiga'],
        steps: ['Cozinhe a mandioca até desmanchar e amasse com manteiga.', 'Desfie a carne seca e refogue com a cebola.', 'Monte em camadas: carne, requeijão, purê.', 'Cubra com o queijo e gratine a 200 °C por 20 minutos.'],
        tip: 'Dessalgue a carne na véspera, trocando a água três vezes.'
      },
      {
        key: 'r6',
        title: 'Salada de grão-de-bico',
        meal: 'main',
        minutes: 15,
        servings: 2,
        effort: 'easy',
        tags: ['veg', 'quick', 'lunchbox'],
        ingredients: ['1 lata de grão-de-bico', '1 tomate', '1/2 pepino', '1/4 de cebola roxa', 'Salsinha, limão e azeite'],
        steps: ['Escorra e lave o grão-de-bico.', 'Pique os legumes em cubos pequenos.', 'Tempere com limão, azeite, sal e salsinha.']
      },
      {
        key: 'r7',
        title: 'Tapioca com queijo',
        meal: 'breakfast',
        minutes: 10,
        servings: 1,
        effort: 'easy',
        tags: ['quick', 'veg'],
        ingredients: ['4 colheres de goma de tapioca', '2 fatias de queijo minas', 'Orégano'],
        steps: ['Espalhe a goma peneirada na frigideira quente, sem óleo.', 'Quando firmar, recheie com o queijo e o orégano e dobre ao meio.']
      },
      {
        key: 'r8',
        title: 'Sopa de legumes',
        meal: 'main',
        minutes: 40,
        servings: 6,
        effort: 'easy',
        tags: ['veg', 'freezes', 'onepot'],
        ingredients: ['2 batatas', '1 abobrinha', '2 cenouras', '1 mandioquinha', '1 cebola e 2 dentes de alho', 'Cheiro-verde'],
        steps: ['Refogue a cebola e o alho.', 'Junte os legumes picados e cubra com água.', 'Cozinhe 25 minutos e bata metade no liquidificador para engrossar.']
      }
    ],
    [
      {
        key: 'r1',
        title: 'Lentil soup',
        meal: 'main',
        minutes: 45,
        servings: 6,
        effort: 'easy',
        tags: ['veg', 'freezes', 'onepot', 'lunchbox'],
        favorite: true,
        source: "Mum's notebook",
        ingredients: ['1 1/2 cups red lentils', '1 onion, chopped', '2 carrots, diced', '2 cloves garlic', '1 tsp cumin', '6 cups vegetable stock', 'Lemon juice'],
        steps: ['Soften the onion and carrots in oil for 8 minutes.', 'Add the garlic and cumin for a minute.', 'Add the lentils and stock; simmer 25 minutes.', 'Blend half, stir back in and finish with lemon.'],
        tip: 'Freezes well in single portions.'
      },
      {
        key: 'r2',
        title: 'Banana bread',
        meal: 'snack',
        minutes: 70,
        servings: 10,
        effort: 'medium',
        tags: ['oven', 'veg'],
        favorite: true,
        ingredients: ['3 very ripe bananas', '1/3 cup melted butter', '3/4 cup sugar', '1 egg', '1 1/2 cups flour', '1 tsp baking soda', 'A pinch of salt'],
        steps: ['Mash the bananas and mix in the butter.', 'Stir in the sugar, egg, then the flour, soda and salt.', 'Bake in a loaf tin at 350 °F for about 60 minutes.']
      },
      {
        key: 'r3',
        title: 'Weeknight tomato pasta',
        meal: 'main',
        minutes: 20,
        servings: 4,
        effort: 'easy',
        tags: ['quick', 'veg'],
        ingredients: ['1 lb spaghetti', '1 can whole tomatoes', '3 cloves garlic', 'Olive oil, chilli flakes, basil', 'Parmesan'],
        steps: ['Cook the pasta in well-salted water.', 'Warm the garlic and chilli in oil, add the tomatoes and crush them; simmer 10 minutes.', 'Toss with the pasta, a splash of its water, basil and parmesan.']
      },
      {
        key: 'r4',
        title: 'Roast chicken thighs with vegetables',
        meal: 'main',
        minutes: 70,
        servings: 4,
        effort: 'easy',
        tags: ['oven', 'onepot'],
        ingredients: ['2 lb chicken thighs', '4 potatoes', '2 carrots', '1 red onion', 'Lemon, garlic, paprika, rosemary', 'Olive oil and salt'],
        steps: ['Season the chicken with lemon, garlic, paprika and salt.', 'Toss the vegetables in oil on a tray.', 'Lay the chicken on top and roast at 400 °F for 45 minutes.']
      },
      {
        key: 'r5',
        title: 'Big pot of chili',
        meal: 'main',
        minutes: 90,
        servings: 8,
        effort: 'project',
        tags: ['freezes', 'lunchbox', 'onepot'],
        ingredients: ['2 lb ground beef', '2 cans kidney beans', '2 cans crushed tomatoes', '2 onions', '2 tbsp chili powder', 'Cumin, oregano, garlic'],
        steps: ['Brown the beef in batches.', 'Soften the onions and garlic, add the spices.', 'Add the tomatoes and beans; simmer an hour, stirring now and then.'],
        tip: 'Better on the second day.'
      },
      {
        key: 'r6',
        title: 'Chickpea salad',
        meal: 'main',
        minutes: 15,
        servings: 2,
        effort: 'easy',
        tags: ['veg', 'quick', 'lunchbox'],
        ingredients: ['1 can chickpeas', '1 tomato', '1/2 cucumber', '1/4 red onion', 'Parsley, lemon and olive oil'],
        steps: ['Drain and rinse the chickpeas.', 'Dice the vegetables small.', 'Dress with lemon, oil, salt and parsley.']
      },
      {
        key: 'r7',
        title: 'Overnight oats',
        meal: 'breakfast',
        minutes: 5,
        servings: 1,
        effort: 'easy',
        tags: ['quick', 'veg'],
        ingredients: ['1/2 cup rolled oats', '1/2 cup milk', '1/4 cup yoghurt', 'Berries and honey'],
        steps: ['Stir the oats, milk and yoghurt together in a jar.', 'Leave in the fridge overnight; top with berries and honey.']
      },
      {
        key: 'r8',
        title: 'Shakshuka',
        meal: 'breakfast',
        minutes: 30,
        servings: 3,
        effort: 'easy',
        tags: ['veg', 'onepot'],
        ingredients: ['1 can crushed tomatoes', '1 red pepper', '1 onion', '5 eggs', 'Cumin, paprika, feta'],
        steps: ['Soften the onion and pepper; add the spices.', 'Pour in the tomatoes and simmer 10 minutes.', 'Make wells, crack in the eggs and cover until just set.']
      }
    ]
  )

  const day = (key: string, title: string, weekday: number, values: Record<string, TemplateValue>) => row(key, title, { date: onWeekday(weekday), ...values })

  return {
    id: 'kitchen',
    locale,
    name: t('Cozinha', 'Kitchen'),
    description: t('Receitas com ingredientes e preparo, cardápio da semana e lista de compras por seção.', 'Recipes with ingredients and method, a weekly menu and a shopping list by aisle.'),
    icon: 'cup',
    page: page(t('Cozinha', 'Kitchen'), line('cup'), [
      callout(
        line('lantern'),
        t(
          [['Cada receita é uma página com ingredientes e preparo. Monte a semana no '], b('Cardápio'), [' escolhendo receitas, e anote o que falta na lista de compras.']],
          [['Each recipe is a page with its ingredients and method. Plan the week in the '], b('Menu'), [' by picking recipes, and note what is missing on the shopping list.']]
        )
      ),
      h2(t('Esta semana', 'This week')),
      linked('menu', [views.table(t('Semana', 'Week'), ['title', 'lunch', 'dinner', 'cook'], { filters: [where.date('date', 'this_week')], sorts: [asc('date')] })], {
        title: t('Cardápio da semana', "This week's menu")
      }),
      linked('shopping', [views.board(t('No mercado', 'At the shop'), 'aisle', ['amount', 'recipe'], { filters: [where.unchecked('got')] })], {
        title: t('Lista de compras', 'Shopping list')
      }),
      h2(t('Receitas', 'Recipes')),
      linked('recipes', [views.gallery(t('Favoritas', 'Favourites'), ['meal', 'minutes', 'tags'], { filters: [where.checked('favorite')] })], { title: t('As favoritas', 'Favourites') }),
      linked('recipes', [views.list(t('Rápidas', 'Quick'), ['minutes', 'meal'], { filters: [where.lessThan('minutes', 31)], sorts: [asc('minutes')] })], {
        title: t('Para dias corridos', 'For busy days'),
        beside: true
      }),
      divider(),
      h2(t('Livro de receitas', 'Recipe book')),
      p(t('Abra uma receita para ver os ingredientes e o modo de preparo.', 'Open a recipe to see its ingredients and method.')),
      database(
        'recipes',
        t('Receitas', 'Recipes'),
        line('cup'),
        recipes,
        [
          views.gallery(t('Livro', 'Book'), ['meal', 'minutes', 'tags']),
          views.table(t('Tabela', 'Table'), ['title', 'meal', 'minutes', 'servings', 'effort', 'tags', 'ingredients', 'favorite']),
          views.board(t('Por refeição', 'By meal'), 'meal', ['minutes', 'effort'])
        ],
        recipeRows.map(recipe)
      ),
      database(
        'menu',
        t('Cardápio', 'Menu'),
        line('hourglass'),
        menu,
        [
          views.table(t('Semana', 'Week'), ['title', 'date', 'lunch', 'dinner', 'cook', 'dinnerTime', 'notes'], { sorts: [asc('date')] }),
          views.calendar(t('Calendário', 'Calendar'), 'date', ['lunch', 'dinner'])
        ],
        [
          day('mon', t('Segunda', 'Monday'), 1, { lunch: ['r1', 'r3'], dinner: ['r8'], cook: 'me' }),
          day('tue', t('Terça', 'Tuesday'), 2, { lunch: ['r6'], dinner: ['r4'], cook: 'partner' }),
          day('wed', t('Quarta', 'Wednesday'), 3, { lunch: ['r1', 'r3'], dinner: ['r8'], cook: 'me', notes: t('Sobra de segunda.', "Monday's leftovers.") }),
          day('thu', t('Quinta', 'Thursday'), 4, { lunch: ['r6'], dinner: ['r5'], cook: 'together' }),
          day('fri', t('Sexta', 'Friday'), 5, { lunch: ['r5'], cook: 'out', notes: t('Jantar fora.', 'Dinner out.') }),
          day('sat', t('Sábado', 'Saturday'), 6, { lunch: ['r4'], dinner: ['r7'], cook: 'together' }),
          day('sun', t('Domingo', 'Sunday'), 7, { lunch: ['r1', 'r3'], cook: 'me', notes: t('Bolo para a semana.', 'Bake for the week.') })
        ]
      ),
      database(
        'shopping',
        t('Lista de compras', 'Shopping list'),
        line('box'),
        shopping,
        [
          views.board(t('Por seção', 'By aisle'), 'aisle', ['amount', 'recipe'], { filters: [where.unchecked('got')] }),
          views.table(t('Tudo', 'Everything'), ['title', 'aisle', 'amount', 'recipe', 'got'])
        ],
        t(
          [
            row(undefined, 'Feijão carioca', { aisle: 'pantry', amount: '1 kg', recipe: ['r1'], got: false }),
            row(undefined, 'Cenoura', { aisle: 'produce', amount: '6', recipe: ['r2', 'r4'], got: false }),
            row(undefined, 'Sobrecoxa de frango', { aisle: 'meat', amount: '1 kg', recipe: ['r4'], got: false }),
            row(undefined, 'Carne seca', { aisle: 'meat', amount: '500 g', recipe: ['r5'], got: false }),
            row(undefined, 'Requeijão', { aisle: 'dairy', amount: '1 copo', recipe: ['r5'], got: true }),
            row(undefined, 'Grão-de-bico', { aisle: 'pantry', amount: '2 latas', recipe: ['r6'], got: false }),
            row(undefined, 'Pão francês', { aisle: 'bakery', amount: '6', recipe: [], got: false }),
            row(undefined, 'Detergente', { aisle: 'cleaning', amount: '1', recipe: [], got: false })
          ],
          [
            row(undefined, 'Red lentils', { aisle: 'pantry', amount: '1 bag', recipe: ['r1'], got: false }),
            row(undefined, 'Carrots', { aisle: 'produce', amount: '6', recipe: ['r1', 'r4'], got: false }),
            row(undefined, 'Chicken thighs', { aisle: 'meat', amount: '2 lb', recipe: ['r4'], got: false }),
            row(undefined, 'Ground beef', { aisle: 'meat', amount: '2 lb', recipe: ['r5'], got: false }),
            row(undefined, 'Feta', { aisle: 'dairy', amount: '1 block', recipe: ['r8'], got: true }),
            row(undefined, 'Chickpeas', { aisle: 'pantry', amount: '2 cans', recipe: ['r6'], got: false }),
            row(undefined, 'Sourdough loaf', { aisle: 'bakery', amount: '1', recipe: [], got: false }),
            row(undefined, 'Dish soap', { aisle: 'cleaning', amount: '1', recipe: [], got: false })
          ]
        )
      )
    ])
  }
}
