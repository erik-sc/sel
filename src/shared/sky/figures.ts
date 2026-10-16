// The figures of sel's sky, ported as they are from docs/plans/sky/figures.js. Each one is drawn on a
// 100 by 100 box, y pointing down. `stars` are listed in the order they light up: the first Meditation of a
// month lights star 0, the next one star 1, and so on. `lines` are polylines over star indices; a segment
// appears as soon as both of its stars are lit. Authored by hand, like Herman's anchors.

export interface SkyFigure {
  id: string
  /** With its article, lower case, for sentences: "o Barco". */
  pt: string
  en: string
  stars: ReadonlyArray<readonly [number, number]>
  lines: ReadonlyArray<ReadonlyArray<number>>
}

export const SKY_FIGURES: readonly SkyFigure[] = [
  // ---- the desk ----
  { id: 'boat', pt: 'o Barco', en: 'the Boat', stars: [[50, 10], [78, 50], [50, 55], [14, 66], [88, 66], [76, 84], [26, 84], [50, 66]], lines: [[0, 1, 2], [0, 2, 7], [3, 4, 5, 6, 3]] },
  { id: 'fish', pt: 'o Peixe', en: 'the Fish', stars: [[8, 50], [30, 34], [60, 36], [72, 48], [92, 30], [92, 70], [60, 64], [30, 66], [24, 47]], lines: [[0, 1, 2, 3, 4, 5, 3, 6, 7, 0]] },
  { id: 'lantern', pt: 'a Lanterna', en: 'the Lantern', stars: [[50, 6], [50, 18], [32, 24], [24, 50], [32, 78], [68, 78], [76, 50], [68, 24]], lines: [[0, 1], [1, 2, 3, 4, 5, 6, 7, 1]] },
  { id: 'cup', pt: 'a Xícara', en: 'the Cup', stars: [[50, 8], [44, 20], [52, 30], [18, 42], [76, 42], [66, 78], [30, 78], [90, 54]], lines: [[0, 1, 2], [3, 4, 5, 6, 3], [4, 7, 5]] },
  { id: 'feather', pt: 'a Pena', en: 'the Feather', stars: [[88, 8], [62, 24], [42, 44], [24, 70], [10, 92], [72, 40], [52, 62], [66, 8], [40, 30]], lines: [[4, 3, 2, 1, 0], [0, 5, 6, 3], [0, 7, 8, 2]] },
  { id: 'candle', pt: 'a Vela', en: 'the Candle', stars: [[50, 6], [43, 18], [50, 28], [57, 18], [36, 34], [64, 34], [64, 92], [36, 92]], lines: [[0, 1, 2, 3, 0], [4, 5, 6, 7, 4]] },
  { id: 'key', pt: 'a Chave', en: 'the Key', stars: [[30, 10], [44, 24], [30, 38], [16, 24], [30, 68], [44, 68], [30, 92], [44, 92]], lines: [[0, 1, 2, 3, 0], [2, 4, 6], [4, 5], [6, 7]] },
  { id: 'bell', pt: 'o Sino', en: 'the Bell', stars: [[50, 6], [50, 16], [30, 26], [24, 62], [12, 76], [88, 76], [76, 62], [70, 26], [50, 88]], lines: [[0, 1], [1, 2, 3, 4, 5, 6, 7, 1]] },
  { id: 'hourglass', pt: 'a Ampulheta', en: 'the Hourglass', stars: [[20, 8], [80, 8], [54, 50], [80, 92], [20, 92], [46, 50], [50, 80]], lines: [[0, 1, 2, 3, 4, 5, 0]] },
  { id: 'book', pt: 'o Livro', en: 'the Book', stars: [[50, 24], [10, 16], [10, 76], [50, 86], [90, 76], [90, 16]], lines: [[0, 1, 2, 3, 4, 5, 0, 3]] },
  { id: 'spectacles', pt: 'os Óculos', en: 'the Spectacles', stars: [[12, 50], [28, 36], [44, 50], [28, 64], [56, 50], [72, 36], [88, 50], [72, 64]], lines: [[0, 1, 2, 3, 0], [2, 4], [4, 5, 6, 7, 4]] },
  { id: 'staff', pt: 'o Cajado', en: 'the Staff', stars: [[46, 96], [48, 62], [50, 30], [44, 16], [52, 6], [64, 14], [58, 26], [50, 22]], lines: [[0, 1, 2, 3, 4, 5, 6, 7]] },
  { id: 'teapot', pt: 'o Bule', en: 'the Teapot', stars: [[50, 14], [30, 30], [70, 30], [82, 58], [66, 84], [34, 84], [18, 58], [96, 32], [6, 46]], lines: [[1, 0, 2], [1, 6, 5, 4, 3, 2], [3, 7], [6, 8, 1]] },
  // ---- outside the window ----
  { id: 'mountain', pt: 'a Montanha', en: 'the Mountain', stars: [[4, 86], [34, 30], [50, 54], [64, 40], [96, 86], [26, 44], [36, 50], [42, 44]], lines: [[0, 1, 2, 3, 4, 0], [5, 6, 7]] },
  { id: 'wave', pt: 'a Onda', en: 'the Wave', stars: [[4, 62], [22, 34], [44, 30], [50, 46], [40, 56], [36, 44], [56, 40], [76, 58], [96, 60]], lines: [[0, 1, 2, 3, 4, 5, 6, 7, 8]] },
  { id: 'house', pt: 'a Casa', en: 'the House', stars: [[8, 48], [50, 12], [92, 48], [80, 48], [80, 90], [20, 90], [20, 48], [42, 90], [42, 66], [58, 66], [58, 90]], lines: [[0, 1, 2], [3, 4, 5, 6], [7, 8, 9, 10]] },
  { id: 'bridge', pt: 'a Ponte', en: 'the Bridge', stars: [[4, 42], [96, 42], [4, 82], [26, 58], [50, 50], [74, 58], [96, 82]], lines: [[0, 1], [2, 3, 4, 5, 6], [0, 2], [1, 6]] },
  { id: 'lighthouse', pt: 'o Farol', en: 'the Lighthouse', stars: [[36, 92], [42, 34], [40, 26], [50, 12], [60, 26], [58, 34], [64, 92], [96, 14]], lines: [[0, 1, 2, 3, 4, 5, 6, 0], [1, 5], [4, 7]] },
  { id: 'umbrella', pt: 'o Guarda-chuva', en: 'the Umbrella', stars: [[8, 48], [24, 26], [50, 14], [76, 26], [92, 48], [72, 42], [50, 48], [28, 42], [50, 86], [40, 92]], lines: [[0, 1, 2, 3, 4, 5, 6, 7, 0], [6, 8, 9]] },
  { id: 'ladder', pt: 'a Escada', en: 'the Ladder', stars: [[30, 94], [70, 94], [30, 66], [70, 66], [30, 38], [70, 38], [30, 10], [70, 10]], lines: [[0, 2, 4, 6], [1, 3, 5, 7], [0, 1], [2, 3], [4, 5], [6, 7]] },
  // ---- what grows ----
  { id: 'leaf', pt: 'a Folha', en: 'the Leaf', stars: [[12, 88], [14, 50], [40, 20], [88, 12], [80, 52], [52, 82], [56, 40]], lines: [[0, 1, 2, 3, 4, 5, 0], [0, 6, 3]] },
  { id: 'sprout', pt: 'o Broto', en: 'the Sprout', stars: [[50, 96], [50, 54], [20, 30], [30, 50], [82, 34], [68, 52]], lines: [[0, 1], [1, 3, 2, 1], [1, 5, 4, 1]] },
  { id: 'araucaria', pt: 'a Araucária', en: 'the Araucaria', stars: [[50, 96], [50, 56], [50, 30], [22, 44], [14, 26], [78, 44], [86, 26], [34, 26], [30, 12], [66, 26], [70, 12]], lines: [[0, 1, 2], [1, 3, 4], [1, 5, 6], [2, 7, 8], [2, 9, 10]] },
  { id: 'ipe', pt: 'o Ipê', en: 'the Ipê Tree', stars: [[50, 96], [50, 62], [32, 44], [68, 44], [16, 30], [30, 12], [50, 8], [70, 12], [84, 30], [50, 34]], lines: [[0, 1, 2, 4, 5, 6, 7, 8, 3, 1], [2, 9, 3]] },
  { id: 'palm', pt: 'o Coqueiro', en: 'the Coconut Palm', stars: [[62, 96], [56, 66], [50, 36], [14, 44], [22, 18], [54, 8], [86, 22], [88, 48], [56, 44]], lines: [[0, 1, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7]] },
  { id: 'mandacaru', pt: 'o Mandacaru', en: 'the Mandacaru', stars: [[50, 96], [50, 64], [50, 10], [28, 64], [28, 32], [50, 46], [74, 46], [74, 20]], lines: [[0, 1, 5, 2], [1, 3, 4], [5, 6, 7]] },
  { id: 'banana', pt: 'a Bananeira', en: 'the Banana Tree', stars: [[50, 96], [50, 50], [12, 34], [32, 12], [70, 10], [90, 34], [62, 60], [66, 74]], lines: [[0, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6, 7]] },
  { id: 'waterlily', pt: 'a Vitória-régia', en: 'the Water Lily', stars: [[8, 62], [28, 74], [72, 74], [92, 62], [72, 50], [28, 50], [50, 42], [50, 26]], lines: [[0, 1, 2, 3, 4, 6, 5, 0], [6, 7]] },
  { id: 'cashew', pt: 'o Caju', en: 'the Cashew', stars: [[34, 14], [64, 14], [74, 46], [56, 72], [34, 56], [58, 86], [42, 92]], lines: [[0, 1, 2, 3, 4, 0], [3, 5, 6]] },
  // ---- who lives here ----
  { id: 'hummingbird', pt: 'o Beija-flor', en: 'the Hummingbird', stars: [[4, 34], [28, 32], [40, 42], [62, 8], [52, 36], [88, 74], [74, 84], [56, 58]], lines: [[0, 1, 2, 7, 5], [7, 6], [2, 4, 3]] },
  { id: 'toucan', pt: 'o Tucano', en: 'the Toucan', stars: [[6, 44], [36, 30], [36, 50], [48, 24], [72, 36], [94, 72], [62, 70], [56, 86]], lines: [[0, 1, 3, 4, 5, 6, 2, 0], [6, 7]] },
  { id: 'turtle', pt: 'a Tartaruga', en: 'the Turtle', stars: [[18, 56], [34, 34], [66, 34], [82, 56], [66, 70], [34, 70], [96, 48], [24, 84], [76, 84], [6, 62]], lines: [[0, 1, 2, 3, 4, 5, 0], [3, 6], [5, 7], [4, 8], [0, 9]] },
  { id: 'whale', pt: 'a Baleia', en: 'the Whale', stars: [[6, 54], [28, 36], [64, 38], [80, 52], [94, 34], [96, 62], [64, 70], [28, 70], [36, 18]], lines: [[0, 1, 2, 3, 4, 5, 3, 6, 7, 0], [1, 8]] },
  { id: 'heron', pt: 'a Garça', en: 'the Heron', stars: [[46, 98], [50, 64], [30, 54], [70, 54], [64, 34], [54, 22], [60, 10], [34, 14]], lines: [[0, 1, 2, 3, 1], [3, 4, 5, 6, 7]] },
  { id: 'owl', pt: 'a Coruja', en: 'the Owl', stars: [[28, 10], [40, 26], [60, 26], [72, 10], [76, 56], [62, 88], [38, 88], [24, 56], [40, 42], [60, 42]], lines: [[0, 1, 2, 3, 4, 5, 6, 7, 0]] },
  { id: 'cat', pt: 'o Gato', en: 'the Cat', stars: [[30, 94], [34, 50], [30, 24], [40, 34], [56, 34], [66, 24], [62, 50], [72, 94], [92, 70]], lines: [[0, 1, 2, 3, 4, 5, 6, 7, 0], [7, 8]] },
  { id: 'snail', pt: 'o Caracol', en: 'the Snail', stars: [[52, 50], [44, 44], [40, 56], [56, 66], [70, 50], [60, 30], [34, 32], [8, 82], [94, 82], [90, 62]], lines: [[0, 1, 2, 3, 4, 5, 6], [7, 8, 9]] },
  // ---- what we play ----
  { id: 'kite', pt: 'a Pipa', en: 'the Kite', stars: [[50, 6], [82, 36], [50, 72], [18, 36], [56, 82], [46, 90], [56, 98]], lines: [[0, 1, 2, 3, 0, 2], [3, 1], [2, 4, 5, 6]] },
  { id: 'top', pt: 'o Pião', en: 'the Spinning Top', stars: [[50, 96], [20, 56], [34, 36], [66, 36], [80, 56], [50, 36], [50, 14]], lines: [[0, 1, 2, 3, 4, 0], [5, 6]] },
  { id: 'pinwheel', pt: 'o Cata-vento', en: 'the Pinwheel', stars: [[50, 44], [50, 8], [70, 24], [86, 44], [70, 64], [50, 80], [30, 64], [14, 44], [30, 24], [50, 98]], lines: [[0, 1, 2, 0], [0, 3, 4, 0], [0, 5, 6, 0], [0, 7, 8, 0], [5, 9]] },
  { id: 'guitar', pt: 'o Violão', en: 'the Guitar', stars: [[50, 96], [24, 82], [34, 62], [26, 46], [50, 40], [74, 46], [66, 62], [76, 82], [50, 6], [50, 64]], lines: [[0, 1, 2, 3, 4, 5, 6, 7, 0], [4, 8]] },
  { id: 'berimbau', pt: 'o Berimbau', en: 'the Berimbau', stars: [[36, 4], [22, 34], [22, 66], [36, 96], [36, 70], [50, 74], [50, 88]], lines: [[0, 1, 2, 3, 4, 0], [4, 5, 6, 4]] },
  { id: 'hammock', pt: 'a Rede', en: 'the Hammock', stars: [[8, 92], [8, 26], [28, 58], [50, 66], [72, 58], [92, 26], [92, 92]], lines: [[0, 1, 2, 3, 4, 5, 6]] },
  { id: 'jangada', pt: 'a Jangada', en: 'the Raft', stars: [[8, 76], [92, 76], [82, 88], [18, 88], [50, 76], [50, 8], [82, 58]], lines: [[0, 1, 2, 3, 0], [4, 5, 6, 4]] },
  { id: 'strawhat', pt: 'o Chapéu de palha', en: 'the Straw Hat', stars: [[4, 70], [30, 62], [36, 34], [64, 34], [70, 62], [96, 70], [50, 76]], lines: [[0, 1, 2, 3, 4, 5, 6, 0], [1, 4]] }
]

/**
 * The figure of each month, in order: month m of year y draws FIGURE_SEQUENCE[(y·12 + m−1) mod 45].
 * Generated once with a Fisher–Yates shuffle seeded by 'sel-sky-figures' and frozen here: changing it
 * would redraw every sky already seen, so a test locks it. Neighbouring months never repeat, and the same
 * calendar month repeats a figure only after 15 years.
 */
export const FIGURE_SEQUENCE: readonly string[] = Object.freeze([
  'mandacaru', 'book', 'sprout', 'cat', 'araucaria', 'umbrella', 'staff', 'bell', 'leaf',
  'banana', 'fish', 'ipe', 'hummingbird', 'mountain', 'boat', 'ladder', 'spectacles', 'owl',
  'house', 'cashew', 'strawhat', 'snail', 'turtle', 'pinwheel', 'palm', 'candle', 'waterlily',
  'berimbau', 'kite', 'lighthouse', 'key', 'top', 'bridge', 'guitar', 'whale', 'jangada',
  'lantern', 'wave', 'toucan', 'cup', 'heron', 'feather', 'teapot', 'hourglass', 'hammock'
])

const BY_ID = new Map(SKY_FIGURES.map((f) => [f.id, f]))

export function figureById(id: string): SkyFigure | undefined {
  return BY_ID.get(id)
}

/** The figure a month draws; `month` is 'YYYY-MM'. */
export function figureOfMonth(month: string): SkyFigure {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const i = (((y * 12 + m - 1) % FIGURE_SEQUENCE.length) + FIGURE_SEQUENCE.length) % FIGURE_SEQUENCE.length
  return BY_ID.get(FIGURE_SEQUENCE[i])!
}

export interface FigureSegment {
  a: number
  b: number
  /** The star that completes the segment: it shows once star `at` is lit. */
  at: number
}

/** A figure's distinct segments, each with the index of the star that completes it. */
export function figureSegments(fig: SkyFigure): FigureSegment[] {
  const out: FigureSegment[] = []
  const seen = new Set<string>()
  for (const line of fig.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]
      const b = line[i]
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ a, b, at: Math.max(a, b) })
    }
  }
  return out
}

/** "o Barco" → "O Barco": the label under a constellation. */
export function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
