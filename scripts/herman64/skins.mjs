// Every Herman 64 skin: what the rig wears. Shared by the skins picker, the gallery and the screens.
import { box, cyl, frustum, sphere, torus, xf } from './ps1.mjs'
import { cutFront, GOLD, staff, WOOD } from './herman64.mjs'

const TAU = Math.PI * 2

export const SKINS = [
  {
    id: 'classic', name: 'Clássico', group: 'Sempre', note: 'O Herman 64 de sempre: manto índigo, cajado com a ponta dourada.',
    o: { robe: '#3b4f7d', hem: '#2c3b60', prop: staff([...xf(sphere(0.14, 6, 5, GOLD), { t: [-1.0, 1.75, 0.18] })]) }
  },
  {
    id: 'wizard', name: 'Mago das estrelas', group: 'Sempre', note: 'Chapéu pontudo com estrelas, barra dourada, cajado com cristal.',
    o: {
      robe: '#2c3570', hem: GOLD,
      hat: [
        ...xf(cyl(0.78, 0.05, 10, '#232a58'), { t: [0, 1.82, 0] }),
        ...xf(frustum(0.5, 0, 1.15, 8, '#2c3570'), { r: [0, 0, -10], t: [0.05, 2.38, 0] }),
        ...[[0.18, 2.15, 0.36], [-0.2, 2.45, 0.24], [0.1, 2.7, 0.15], [0.32, 1.98, -0.2]].flatMap((t) => xf(box(0.09, 0.09, 0.03, GOLD), { r: [0, 0, 45], t }))
      ],
      body: [...xf(cyl(0.6, 0.08, 8, GOLD), { t: [0, 0.98, 0] })],
      prop: staff([...xf(sphere(0.2, 4, 2, '#9fd8ff'), { s: [1, 1.5, 1], t: [-1.0, 1.85, 0.18] }), ...xf(torus(0.13, 0.03, 8, 3, GOLD), { r: [90, 0, 0], t: [-1.0, 1.68, 0.18] })])
    }
  },
  {
    id: 'monk', name: 'Monge zen', group: 'Sempre', note: 'Manto açafrão, faixa, chapéu de palha, colar de contas, rastelo de jardim zen.',
    o: {
      robe: '#c8742a', hem: '#9b4f14',
      hat: [...xf(frustum(1.0, 0.05, 0.32, 10, '#d9b26b'), { t: [0, 2.02, 0] })],
      body: [
        ...xf(box(0.24, 1.8, 0.06, '#8f3b1c'), { r: [-14, 0, 32], t: [0.12, 0.45, 0.6] }),
        ...Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * TAU; return xf(sphere(0.05, 5, 3, '#5a3a24'), { t: [Math.cos(a) * 0.36, 1.02 + Math.sin(a) * 0.12, 0.28 + Math.sin(a) * 0.18] }) }).flat()
      ],
      prop: [
        ...xf(cyl(0.045, 2.3, 5, WOOD), { t: [-1.0, 0.35, 0.18] }),
        ...xf(box(0.7, 0.07, 0.1, WOOD), { t: [-1.0, -0.78, 0.18] }),
        ...Array.from({ length: 6 }, (_, i) => xf(box(0.04, 0.14, 0.04, WOOD), { t: [-1.3 + i * 0.12, -0.86, 0.18] })).flat()
      ]
    }
  },
  {
    id: 'hacker', name: 'Hacker', group: 'Sempre', note: 'Moletom com capuz, lentes verdes acesas, notebook no lugar do cajado.',
    o: {
      robe: '#2b2b31', hem: '#1c1c21', lens: '#5dff8a', rim: '#101014',
      hat: [...cutFront(xf(sphere(0.58, 9, 6, '#34343b'), { s: [1, 1.06, 1], t: [0, 1.52, -0.06] }), 0.26)],
      body: [...xf(frustum(0.5, 0.45, 0.2, 8, '#34343b'), { t: [0, 1.08, 0] })],
      prop: [
        ...xf(box(0.72, 0.05, 0.5, '#9a9aa2'), { r: [0, 0, 8], t: [-0.6, 0.78, 0.55] }),
        ...xf(box(0.72, 0.48, 0.04, '#9a9aa2'), { r: [-18, 0, 8], t: [-0.62, 1.03, 0.82] }),
        ...xf(box(0.16, 0.16, 0.02, '#5dff8a'), { r: [-18, 0, 8], t: [-0.62, 1.04, 0.85] })
      ]
    }
  },
  {
    id: 'gardener', name: 'Jardineiro', group: 'Sempre', note: 'Chapéu de palha com fita, avental verde, regador pingando.',
    o: {
      robe: '#d8ccb0', hem: '#b8a986',
      hat: [...xf(cyl(0.82, 0.05, 10, '#e2c27a'), { t: [0, 1.86, 0] }), ...xf(cyl(0.44, 0.3, 9, '#e2c27a'), { t: [0, 2.02, 0] }), ...xf(cyl(0.45, 0.08, 9, '#a3363a'), { t: [0, 1.94, 0] })],
      body: [...xf(box(0.8, 1.2, 0.06, '#5f8f45'), { r: [-14, 0, 0], t: [0, 0.2, 0.7] }), ...xf(box(0.5, 0.06, 0.05, '#5f8f45'), { t: [0, 0.95, 0.45] })],
      prop: [
        ...xf(cyl(0.24, 0.4, 8, '#6f8f7a'), { t: [-1.0, 0.45, 0.25] }),
        ...xf(cyl(0.04, 0.6, 5, '#6f8f7a'), { r: [0, 0, 55], t: [-1.42, 0.62, 0.25] }),
        ...xf(cyl(0.08, 0.06, 6, '#6f8f7a'), { r: [0, 0, 55], t: [-1.68, 0.8, 0.25] }),
        ...xf(torus(0.2, 0.03, 8, 3, '#55705f'), { t: [-1.0, 0.75, 0.25] }),
        ...[[-1.78, 0.62], [-1.86, 0.5], [-1.72, 0.44]].flatMap(([x, y]) => xf(box(0.04, 0.08, 0.04, '#7fb6e0'), { t: [x, y, 0.25] }))
      ]
    }
  },
  {
    id: 'astronaut', name: 'Astronauta', group: 'Sempre', note: 'Traje branco, capacete aberto com antena, mochila de oxigênio, bandeira do sel.',
    o: {
      robe: '#e6e6ea', hem: '#9a9aa2', sleeve: '#e6e6ea',
      hat: [
        ...cutFront(xf(sphere(0.64, 10, 7, '#f2f2f5'), { t: [0, 1.5, -0.02] }), 0.3),
        ...xf(torus(0.5, 0.06, 14, 4, '#9a9aa2'), { t: [0, 1.48, 0.34] }),
        ...xf(cyl(0.025, 0.4, 4, '#9a9aa2'), { t: [0.3, 2.25, -0.1] }),
        ...xf(sphere(0.07, 5, 4, '#e2524a'), { t: [0.3, 2.47, -0.1] })
      ],
      body: [...xf(box(0.8, 0.9, 0.35, '#c4c4cc'), { t: [0, 0.75, -0.6] }), ...xf(box(0.24, 0.16, 0.05, '#4a64a8'), { t: [0.2, 0.75, 0.55] })],
      prop: staff([...xf(box(0.5, 0.32, 0.03, '#4a64a8'), { t: [-0.74, 1.5, 0.18] }), ...xf(box(0.14, 0.14, 0.035, '#f2f2f5'), { t: [-0.74, 1.5, 0.19] })], '#b8b8c0')
    }
  },
  {
    id: 'pirate', name: 'Pirata', group: 'Sempre', note: 'Tricórnio, casaco vermelho com barra dourada, tapa-olho, luneta.',
    o: {
      robe: '#a3363a', hem: GOLD,
      hat: [
        ...xf(frustum(0.78, 0.55, 0.3, 3, '#26252b'), { r: [0, 30, 0], t: [0, 1.95, 0] }),
        ...xf(frustum(0.45, 0.3, 0.3, 8, '#26252b'), { t: [0, 2.15, 0] }),
        ...xf(box(0.22, 0.18, 0.04, '#121214'), { t: [-0.17, 1.55, 0.47] }),
        ...xf(box(0.9, 0.03, 0.03, '#121214'), { r: [0, 0, -20], t: [0, 1.66, 0.4] })
      ],
      body: [...xf(cyl(0.62, 0.1, 8, '#26252b'), { t: [0, 0.6, 0] }), ...xf(box(0.14, 0.12, 0.05, GOLD), { t: [0, 0.6, 0.62] })],
      prop: [
        ...xf(cyl(0.06, 0.6, 6, '#b08a3a'), { r: [0, 0, 80], t: [-1.2, 0.86, 0.2] }),
        ...xf(cyl(0.09, 0.22, 6, '#c9a24a'), { r: [0, 0, 80], t: [-1.55, 0.92, 0.2] })
      ]
    }
  },
  {
    id: 'detective', name: 'Detetive', group: 'Sempre', note: 'Sobretudo bege, chapéu fedora, lupa erguida. Para a busca.',
    o: {
      robe: '#b89a6a', hem: '#8a7350',
      hat: [...xf(cyl(0.72, 0.05, 10, '#5a4a3a'), { t: [0, 1.86, 0] }), ...xf(frustum(0.42, 0.34, 0.34, 9, '#5a4a3a'), { t: [0, 2.06, 0] }), ...xf(cyl(0.43, 0.07, 9, '#2a2420'), { t: [0, 1.93, 0] })],
      body: [...[-1, 1].flatMap((s) => xf(box(0.3, 0.5, 0.05, '#a3895c'), { r: [-10, 0, s * 25], t: [s * 0.2, 0.95, 0.48] })), ...xf(cyl(0.6, 0.1, 8, '#6d5a3c'), { t: [0, 0.45, 0] })],
      prop: [
        ...xf(cyl(0.04, 0.4, 5, '#3a2a1c'), { r: [0, 0, -20], t: [-1.0, 0.98, 0.3] }),
        ...xf(torus(0.2, 0.04, 12, 4, '#c9a24a'), { t: [-1.06, 1.35, 0.32] }),
        ...xf(cyl(0.18, 0.02, 10, '#bfe3f2'), { r: [90, 0, 0], t: [-1.06, 1.35, 0.32] })
      ]
    }
  },
  {
    id: 'scribe', name: 'Escriba', group: 'Sempre', note: 'Manto roxo, gorro macio, uma pena enorme e um rolo de pergaminho. Para escrever com você.',
    o: {
      robe: '#6f528c', hem: '#4e3966',
      hat: [...cutFront(xf(sphere(0.5, 8, 5, '#8b6aa8'), { s: [1, 0.7, 1], t: [0.05, 1.8, -0.05] }), 0.5)],
      body: [...xf(cyl(0.12, 0.9, 7, '#efe3c0'), { r: [0, 90, 90], t: [0.15, 0.55, 0.62] }), ...[-1, 1].flatMap((s) => xf(cyl(0.14, 0.06, 7, '#c9b48a'), { r: [0, 0, 90], t: [0.15 + s * 0.46, 0.55, 0.62] }))],
      prop: [
        ...xf(cyl(0.025, 0.5, 4, '#e9e4d8'), { r: [0, 0, 20], t: [-1.0, 1.05, 0.2] }),
        ...xf(sphere(0.5, 6, 4, '#d27b3a'), { s: [0.12, 1, 0.42], r: [0, 0, 26], t: [-1.24, 1.6, 0.2] })
      ]
    }
  },
  {
    id: 'santa', name: 'Papai Noel', group: 'Dezembro', note: 'Gorro com pompom, manto vermelho com barra de pelo, cinto, bengala doce.',
    o: {
      robe: '#c0392b', hem: '#f4f2ec',
      hat: [
        ...xf(frustum(0.48, 0, 0.95, 8, '#c0392b'), { r: [0, 0, 28], t: [0.15, 2.18, 0] }),
        ...xf(cyl(0.52, 0.14, 10, '#f4f2ec'), { t: [0, 1.86, 0] }),
        ...xf(sphere(0.13, 6, 4, '#f4f2ec'), { t: [0.42, 2.58, 0] })
      ],
      body: [...xf(cyl(0.63, 0.14, 8, '#1e1d22'), { t: [0, 0.55, 0] }), ...xf(box(0.2, 0.18, 0.05, GOLD), { t: [0, 0.55, 0.64] })],
      prop: [
        ...Array.from({ length: 9 }, (_, i) => xf(cyl(0.055, 0.26, 6, i % 2 ? '#f4f2ec' : '#d23b3b'), { t: [-1.0, -0.6 + i * 0.26, 0.18] })).flat(),
        ...Array.from({ length: 5 }, (_, i) => { const a = Math.PI - (i / 4) * Math.PI; return xf(sphere(0.07, 5, 3, i % 2 ? '#f4f2ec' : '#d23b3b'), { t: [-0.82 + Math.cos(a) * 0.18, 1.72 + Math.sin(a) * 0.18, 0.18] }) }).flat()
      ]
    }
  },
  {
    id: 'pumpkin', name: 'Abóbora', group: 'Outubro', note: 'Máscara de abóbora por cima dos óculos, capa preta, lanterna pendurada no cajado.',
    o: {
      robe: '#26252b', hem: '#e07a1f',
      hat: [
        ...xf(sphere(0.6, 10, 6, '#e07a1f'), { s: [1, 0.82, 0.95], t: [0, 1.55, 0.02] }),
        ...xf(cyl(0.06, 0.2, 5, '#4f7a3a'), { t: [0, 2.1, 0] }),
        ...[-1, 1].flatMap((s) => xf(box(0.15, 0.15, 0.04, '#2a1508'), { r: [0, 0, 45], t: [s * 0.2, 1.62, 0.56] })),
        ...xf(box(0.36, 0.08, 0.04, '#2a1508'), { t: [0, 1.38, 0.55] }),
        ...xf(box(0.06, 0.06, 0.05, '#e07a1f'), { t: [0, 1.4, 0.56] })
      ],
      prop: staff([...xf(cyl(0.02, 0.2, 4, '#3a3a3a'), { t: [-1.0, 1.72, 0.18] }), ...xf(box(0.22, 0.26, 0.22, '#ffcf5a'), { t: [-1.0, 1.5, 0.18] }), ...xf(box(0.26, 0.04, 0.26, '#3a3a3a'), { t: [-1.0, 1.65, 0.18] })])
    }
  }
]
