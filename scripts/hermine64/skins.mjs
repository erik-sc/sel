// Hermine 64's skins: what her rig wears. Hats are in head space (the head's centre at the origin,
// radius 0.42, hair up to ~0.5); props and bodies in world space (her left hand at HAND).
import { box, cyl, frustum, sphere, torus, xf } from '../herman64/ps1.mjs'
import { CREAM, GOLD, HAND, WOOD } from './hermine.mjs'

const TAU = Math.PI * 2
const [hx, hy, hz] = HAND
const near = (dx, dy, dz = 0) => [hx + dx, hy + dy, hz + dz]

/** An open book in the hand: two pages on a spine. */
const book = (cover) => [
  ...[-1, 1].flatMap((s) => xf(box(0.3, 0.02, 0.4, cover), { r: [-50, 0, s * 14], t: near(s * 0.15, 0.08, 0.1) })),
  ...[-1, 1].flatMap((s) => xf(box(0.27, 0.025, 0.36, '#faf8f4'), { r: [-50, 0, s * 14], t: near(s * 0.14, 0.1, 0.12) }))
]

export const SKINS = [
  {
    id: 'classic', name: 'Clássica', group: 'Sempre', note: 'Vestido vinho, cabelo chanel com franja, brincos dourados, um livro aberto na mão.',
    o: { dress: '#a3363a', hem: '#6e2a2c', top: '#a3363a', hair: 'bob', prop: book('#3b4f7d') }
  },
  {
    id: 'astronomer', name: 'Astrônoma', group: 'Sempre', note: 'Vestido índigo salpicado de estrelas, coque, um astrolábio de latão erguido.',
    o: {
      dress: '#2c3570', hem: GOLD, hair: 'bun', hairColor: '#7a5632',
      body: [[0.4, 0.2, 0.75], [-0.25, -0.1, 0.78], [0.1, 0.55, 0.55], [-0.5, 0.35, 0.6], [0.55, -0.3, 0.7]].flatMap((t) => xf(box(0.08, 0.08, 0.03, GOLD), { r: [0, 0, 45], t })),
      prop: [
        ...xf(cyl(0.035, 0.45, 5, WOOD), { t: near(0, 0.25, 0) }),
        ...xf(torus(0.24, 0.03, 12, 3, GOLD), { t: near(0, 0.68, 0) }),
        ...xf(torus(0.24, 0.03, 12, 3, GOLD), { r: [0, 70, 0], t: near(0, 0.68, 0) }),
        ...xf(torus(0.17, 0.025, 10, 3, '#9b4f14'), { r: [70, 0, 0], t: near(0, 0.68, 0) }),
        ...xf(sphere(0.07, 5, 4, '#93acce'), { t: near(0, 0.68, 0) })
      ]
    }
  },
  {
    id: 'gardener', name: 'Jardineira', group: 'Sempre', note: 'Chapéu de sol com uma flor, avental verde, cabelo solto, um vaso com uma muda.',
    o: {
      dress: '#d8ccb0', hem: '#b8a986', hair: 'long', hairColor: '#9b4f14',
      hat: [...xf(cyl(0.8, 0.04, 12, '#e2c27a'), { r: [-8, 0, 0], t: [0, 0.32, 0.02] }), ...xf(cyl(0.4, 0.24, 10, '#e2c27a'), { t: [0, 0.45, -0.02] }), ...xf(cyl(0.41, 0.07, 10, '#456a38'), { t: [0, 0.36, -0.02] }), ...xf(sphere(0.1, 5, 4, '#e2827e'), { t: [0.36, 0.42, 0.18] })],
      body: [...xf(box(0.72, 1.05, 0.06, '#456a38'), { r: [-14, 0, 0], t: [0, 0.18, 0.66] }), ...xf(box(0.44, 0.06, 0.05, '#456a38'), { t: [0, 0.92, 0.38] })],
      prop: [
        ...xf(frustum(0.16, 0.22, 0.3, 8, '#9b4f14'), { t: near(0, 0.1, 0.05) }),
        ...xf(cyl(0.025, 0.3, 4, '#456a38'), { t: near(0, 0.38, 0.05) }),
        ...[[-0.1, 0.42], [0.1, 0.48], [0, 0.55]].flatMap(([x, y]) => xf(sphere(0.08, 5, 3, '#9bbb8a'), { s: [1.4, 0.6, 1], t: near(x, y, 0.05) })),
        ...xf(sphere(0.08, 5, 4, '#e2827e'), { t: near(0, 0.6, 0.05) })
      ]
    }
  },
  {
    id: 'hacker', name: 'Hacker', group: 'Sempre', note: 'Moletom grafite, rabo de cavalo roxo, fones de ouvido, lentes verdes acesas, notebook aberto.',
    o: {
      dress: '#2b2b31', hem: '#1c1c21', hair: 'pony', hairColor: '#6f528c', lens: '#5dff8a', rim: '#101014', earrings: false,
      hat: [
        ...xf(torus(0.47, 0.04, 12, 4, '#1c1c21'), { r: [0, 90, 0], t: [0, 0.06, 0] }).filter((t) => (t.v[0][1] + t.v[1][1] + t.v[2][1]) / 3 > 0),
        ...[-1, 1].flatMap((s) => xf(cyl(0.14, 0.1, 8, '#34343b'), { r: [0, 0, 90], t: [s * 0.46, 0, 0] }))
      ],
      prop: [
        ...xf(box(0.66, 0.05, 0.46, '#9a9aa2'), { r: [0, 0, 8], t: near(0.2, 0, 0.32) }),
        ...xf(box(0.66, 0.44, 0.04, '#9a9aa2'), { r: [-18, 0, 8], t: near(0.18, 0.23, 0.57) }),
        ...xf(box(0.14, 0.14, 0.02, '#5dff8a'), { r: [-18, 0, 8], t: near(0.18, 0.24, 0.6) })
      ]
    }
  },
  {
    id: 'monk', name: 'Monja zen', group: 'Sempre', note: 'Cabeça raspada, manto cinza com a faixa açafrão, um pincel grande para o ensō.',
    o: {
      dress: '#63605a', hem: '#24221d', hair: 'none', earrings: false,
      body: [...xf(box(0.22, 1.7, 0.06, '#c8742a'), { r: [-14, 0, 32], t: [0.1, 0.42, 0.56] })],
      prop: [
        ...xf(cyl(0.035, 0.9, 5, WOOD), { r: [0, 0, -18], t: near(0.1, 0.38, 0) }),
        ...xf(frustum(0.07, 0.01, 0.24, 6, '#24221d'), { r: [0, 0, 162], t: near(-0.06, -0.15, 0) })
      ]
    }
  },
  {
    id: 'aviator', name: 'Aviadora', group: 'Sempre', note: 'Jaqueta de couro, touca com óculos de voo na testa, cachecol branco ao vento, um avião de papel.',
    o: {
      dress: '#7a5632', hem: '#4f3720', top: '#7a5632', hair: 'bob', hairColor: '#24221d', earrings: false,
      hat: [
        ...xf(sphere(0.47, 10, 6, '#5a3d22'), { t: [0, 0.06, -0.03] }).filter((t) => (t.v[0][2] + t.v[1][2] + t.v[2][2]) / 3 < 0.16 || (t.v[0][1] + t.v[1][1] + t.v[2][1]) / 3 > 0.24),
        ...[-1, 1].flatMap((s) => [...xf(torus(0.1, 0.03, 8, 4, '#3a3a3a'), { r: [-30, 0, 0], t: [s * 0.14, 0.34, 0.32] }), ...xf(sphere(0.08, 5, 4, '#93acce'), { s: [1, 1, 0.3], r: [-30, 0, 0], t: [s * 0.14, 0.34, 0.31] })])
      ],
      body: [...xf(torus(0.3, 0.08, 10, 4, '#faf8f4'), { r: [90, 0, 0], t: [0, 1.2, 0.04] }), ...xf(box(0.16, 0.5, 0.05, '#faf8f4'), { r: [10, 0, -28], t: [0.36, 0.95, 0.28] })],
      prop: [...xf(frustum(0.18, 0, 0.5, 3, '#faf8f4'), { r: [0, 0, 90], s: [1, 1, 0.35], t: near(0.05, 0.12, 0.05) })]
    }
  },
  {
    id: 'painter', name: 'Pintora', group: 'Sempre', note: 'Boina vermelha, avental manchado de tinta, paleta e pincel. Para dar cor às páginas.',
    o: {
      dress: '#3b4f7d', hem: '#2c3b60', hair: 'bob', hairColor: '#7a5632',
      hat: [...xf(cyl(0.5, 0.12, 10, '#a3363a'), { r: [0, 0, -12], t: [0.06, 0.42, -0.02] }), ...xf(cyl(0.03, 0.08, 4, '#a3363a'), { t: [0.04, 0.52, 0] })],
      body: [
        ...xf(box(0.74, 1.1, 0.06, CREAM), { r: [-14, 0, 0], t: [0, 0.16, 0.66] }),
        ...[['#a3363a', -0.2, 0.3], ['#d1b660', 0.18, 0.1], ['#456a38', -0.05, -0.15], ['#3b4f7d', 0.22, 0.45]].flatMap(([c, x, y]) => xf(box(0.09, 0.09, 0.02, c), { r: [-14, 0, 30], t: [x, y, 0.72 - y * 0.24] }))
      ],
      prop: [
        ...xf(cyl(0.28, 0.035, 10, '#c9a37e'), { r: [70, 0, 0], t: near(0.05, 0.1, 0.12) }),
        ...[['#a3363a', -0.12], ['#d1b660', 0], ['#456a38', 0.12], ['#3b4f7d', 0.05]].map(([c, x], k) => xf(sphere(0.05, 4, 3, c), { t: near(x, 0.12 + (k === 3 ? 0.1 : 0), 0.2 + (k === 3 ? -0.1 : 0)) })).flat(),
        ...xf(cyl(0.02, 0.5, 4, WOOD), { r: [0, 0, 40], t: near(-0.1, 0.32, 0.2) })
      ]
    }
  },
  {
    id: 'librarian', name: 'Bibliotecária', group: 'Sempre', note: 'Cardigã roxo, coque preso com um lápis, óculos de meia-lua, uma pilha de livros.',
    o: {
      dress: '#615d54', hem: '#24221d', top: '#6f528c', sleeve: '#6f528c', hair: 'bun', hairColor: '#959188', lens: '#ebe7de', rim: '#75600c',
      hat: [...xf(cyl(0.025, 0.55, 4, '#d1b660'), { r: [0, 0, 70], t: [0, 0.4, -0.3] })],
      prop: [['#a3363a', 0], ['#456a38', 0.12], ['#3b4f7d', 0.24], ['#d1b660', 0.36]].flatMap(([c, y], k) => xf(box(0.4 - k * 0.03, 0.11, 0.3, c), { r: [0, k * 9, 0], t: near(0.08, y - 0.02, 0.1) }))
    }
  },
  {
    id: 'captain', name: 'Capitã', group: 'Sempre', note: 'Casaco azul-marinho com botões dourados, quepe branco, um leme pequeno nas mãos.',
    o: {
      dress: '#24304f', hem: GOLD, top: '#24304f', hair: 'long', hairColor: '#d1b660',
      hat: [...xf(cyl(0.46, 0.16, 10, '#faf8f4'), { t: [0, 0.42, -0.02] }), ...xf(cyl(0.47, 0.06, 10, '#24221d'), { t: [0, 0.33, -0.02] }), ...xf(box(0.42, 0.03, 0.2, '#24221d'), { r: [-10, 0, 0], t: [0, 0.3, 0.42] }), ...xf(box(0.1, 0.08, 0.03, GOLD), { t: [0, 0.4, 0.47] })],
      body: [...[0.95, 0.7, 0.45, 0.2].flatMap((y) => [-1, 1].map((s) => xf(sphere(0.045, 4, 3, GOLD), { t: [s * 0.13, y, 0.5 - (y - 0.2) * 0.3] })).flat())],
      prop: [
        ...xf(torus(0.26, 0.04, 12, 4, WOOD), { t: near(0.05, 0.25, 0.1) }),
        ...Array.from({ length: 4 }, (_, k) => xf(box(0.7, 0.04, 0.04, WOOD), { r: [0, 0, k * 45], t: near(0.05, 0.25, 0.1) })).flat(),
        ...xf(sphere(0.06, 5, 4, GOLD), { t: near(0.05, 0.25, 0.13) })
      ]
    }
  },
  {
    id: 'astronaut', name: 'Astronauta', group: 'Sempre', note: 'Traje branco, capacete aberto com antena, mochila de oxigênio, a bandeira do sel.',
    o: {
      dress: '#e6e6ea', hem: '#9a9aa2', hair: 'bob', hairColor: '#24221d', earrings: false,
      hat: [
        ...xf(sphere(0.6, 10, 7, '#f2f2f5'), { t: [0, 0.02, -0.02] }).filter((t) => (t.v[0][2] + t.v[1][2] + t.v[2][2]) / 3 < 0.28),
        ...xf(torus(0.48, 0.06, 14, 4, '#9a9aa2'), { t: [0, 0, 0.32] }),
        ...xf(cyl(0.025, 0.4, 4, '#9a9aa2'), { t: [0.28, 0.75, -0.1] }),
        ...xf(sphere(0.07, 5, 4, '#a3363a'), { t: [0.28, 0.97, -0.1] })
      ],
      body: [...xf(box(0.74, 0.85, 0.32, '#c4c4cc'), { t: [0, 0.75, -0.55] }), ...xf(box(0.22, 0.15, 0.05, '#3b4f7d'), { t: [0.18, 0.75, 0.5] })],
      prop: [...xf(cyl(0.03, 1.5, 4, '#b8b8c0'), { t: near(0, 0.35, 0) }), ...xf(box(0.46, 0.3, 0.03, '#3b4f7d'), { t: near(0.25, 0.92, 0) }), ...xf(box(0.13, 0.13, 0.035, '#f2f2f5'), { t: near(0.25, 0.92, 0.01) })]
    }
  },
  {
    id: 'witch', name: 'Bruxa', group: 'Outubro', note: 'Chapéu pontudo com fita laranja, vestido preto, cabelo ruivo solto, vassoura de palha.',
    o: {
      dress: '#26252b', hem: '#e07a1f', top: '#26252b', hair: 'long', hairColor: '#9b4f14',
      hat: [
        ...xf(cyl(0.82, 0.04, 12, '#1c1c21'), { t: [0, 0.34, 0] }),
        ...xf(frustum(0.42, 0, 1.0, 8, '#26252b'), { r: [0, 0, -14], t: [0.08, 0.86, -0.02] }),
        ...xf(cyl(0.43, 0.09, 8, '#e07a1f'), { t: [0, 0.42, -0.02] })
      ],
      prop: [
        ...xf(cyl(0.04, 2.1, 5, WOOD), { r: [0, 0, -8], t: near(-0.02, 0.25, 0) }),
        ...xf(frustum(0.24, 0.06, 0.5, 8, '#d1b660'), { t: near(-0.14, -0.88, 0) }),
        ...xf(cyl(0.08, 0.05, 6, '#a3363a'), { t: near(-0.13, -0.6, 0) })
      ]
    }
  },
  {
    id: 'winter', name: 'Inverno', group: 'Dezembro', note: 'Gorro de lã com pompom, cachecol listrado, casaco vermelho, uma caneca de chocolate quente.',
    o: {
      dress: '#a3363a', hem: '#faf8f4', top: '#a3363a', hair: 'long', hairColor: '#7a5632',
      hat: [...xf(sphere(0.47, 10, 6, '#456a38'), { s: [1, 0.85, 1], t: [0, 0.12, -0.02] }).filter((t) => (t.v[0][1] + t.v[1][1] + t.v[2][1]) / 3 > 0.16), ...xf(cyl(0.48, 0.12, 10, '#faf8f4'), { t: [0, 0.2, -0.02] }), ...xf(sphere(0.13, 6, 4, '#faf8f4'), { t: [0, 0.62, -0.02] })],
      body: [
        ...Array.from({ length: 4 }, (_, i) => xf(cyl(0.38 - i * 0.01, 0.07, 10, i % 2 ? '#faf8f4' : '#456a38'), { t: [0, 1.12 + i * 0.07, 0] })).flat(),
        ...Array.from({ length: 5 }, (_, i) => xf(box(0.16, 0.1, 0.06, i % 2 ? '#faf8f4' : '#456a38'), { r: [0, 0, -8], t: [0.18, 1.0 - i * 0.1, 0.38 + i * 0.02] })).flat()
      ],
      prop: [
        ...xf(cyl(0.12, 0.22, 8, CREAM), { t: near(0.02, 0.15, 0.1) }),
        ...xf(torus(0.07, 0.02, 8, 3, CREAM), { r: [0, 90, 0], t: near(0.16, 0.15, 0.1) }),
        ...xf(cyl(0.1, 0.02, 8, '#7a5632'), { t: near(0.02, 0.26, 0.1) }),
        ...[0, 1, 2].flatMap((k) => xf(box(0.04, 0.08, 0.04, '#ebe7de'), { t: near(0.02 + Math.sin(k * 2) * 0.05, 0.4 + k * 0.1, 0.1) }))
      ]
    }
  }
]
