process.env.TZ = 'America/Sao_Paulo'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NotebookLocale } from '@shared/notebook'
import { addDays, SKY_FIGURES, skyScene, type SkyEvent, type SkyInput } from '@shared/sky'
import { COPY } from './copy'
import { SkyChart } from './SkyChart'
import { timeline } from './timeline'

const DURATION_S = 0.3

function every(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

const INPUT = (locale: NotebookLocale): SkyInput => ({
  meditations: every('2025-06-01', '2026-10-15').map((day, i) => ({ day, text: `Linha número ${i} do dia ${day}` })),
  grains: every('2026-01-01', '2026-10-15').map((day) => ({ key: `t-${day}`, day, at: 1 })),
  pomodoros: every('2026-09-01', '2026-10-15').map((day) => ({ key: `p-${day}`, day, at: 2 })),
  names: { '2026-02': 'O mês 2' },
  hemisphere: 'south',
  locale
})

/** What a person reads on the drawing: its text, without the markup. */
function readable(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
}

describe('the sky shows no number', () => {
  for (const locale of ['en', 'pt-BR'] as const) {
    it(`in ${locale}, still or playing, on any night`, () => {
      const input = INPUT(locale)
      // a name the user gave may hold a digit: that is theirs, not a count
      const named = { ...input, names: {} }
      for (const today of ['2026-10-15', '2026-08-12', '2026-03-03', '2027-01-01']) {
        const scene = skyScene(named, Number(today.slice(0, 4)), today)
        for (const play of [null, { first: true }, { stars: ['2026-10-15'], named: ['2026-09'], grains: ['t-2026-10-15'], halos: ['p-2026-10-15'], event: true }]) {
          const html = renderToStaticMarkup(<SkyChart scene={scene} copy={COPY[locale]} locale={locale} play={play} />)
          expect(readable(html), `${locale} ${today}`).not.toMatch(/\d/)
        }
      }
      // a miniature of an earlier year
      const mini = renderToStaticMarkup(<SkyChart scene={skyScene(named, 2025, '2026-10-15')} copy={COPY[locale]} locale={locale} small />)
      expect(readable(mini)).not.toMatch(/\d/)
    })
  }

  it('in any of its words, but for a year and a date', () => {
    const events: SkyEvent[] = [
      { kind: 'eclipse', total: true },
      { kind: 'eclipse', total: false },
      { kind: 'anniversary' },
      ...(['quadrantids', 'lyrids', 'eta-aquariids', 'delta-aquariids', 'perseids', 'orionids', 'leonids', 'geminids'] as const).map((shower) => ({ kind: 'meteors' as const, shower })),
      ...(['spring-equinox', 'summer-solstice', 'autumn-equinox', 'winter-solstice'] as const).map((mark) => ({ kind: 'season' as const, mark })),
      { kind: 'new-year' },
      { kind: 'comet', night: 2 },
      { kind: 'halo' },
      { kind: 'fireflies' },
      { kind: 'cloud' }
    ]
    for (const locale of ['en', 'pt-BR'] as const) {
      const copy = COPY[locale]
      const words = [
        copy.title,
        copy.kicker,
        ...copy.phase,
        copy.empty,
        copy.emptyLink,
        copy.echo(1, 'x'),
        copy.echo(2, 'x'),
        copy.echo(12, 'x'),
        copy.earlierSkies,
        copy.backToNow,
        copy.moreLines,
        copy.nameStepTitle('2026-10'),
        copy.nameStepAsk,
        copy.nameStepHint,
        copy.loadFailed,
        copy.tryAgain,
        ...events.map((e) => copy.eventCaption(e) ?? '')
      ]
      for (const w of words) expect(w, `${locale}: ${w}`).not.toMatch(/\d/)
      expect(copy.skyOf(2025)).toMatch(/2025/)
    }
  })
})

describe('the words of the Sky', () => {
  it('match between the two languages', () => {
    expect(COPY.en.phase).toHaveLength(8)
    expect(COPY['pt-BR'].phase).toHaveLength(8)
    expect(Object.keys(COPY.en).sort()).toEqual(Object.keys(COPY['pt-BR']).sort())
    expect(COPY['pt-BR'].phase[1]).toBe('Lua crescente')
    expect(COPY['pt-BR'].echo(1, 'O céu ficou laranja.')).toBe('Há um ano, neste dia, você escreveu: “O céu ficou laranja.”')
    expect(COPY['pt-BR'].echo(2, 'x')).toBe('Há dois anos, neste dia, você escreveu: “x”')
    expect(COPY.en.echo(1, 'x')).toBe('A year ago today you wrote: “x”')
    expect(COPY['pt-BR'].nameStepTitle('2026-10')).toBe('Outubro virou uma constelação.')
    expect(COPY['pt-BR'].eventCaption({ kind: 'season', mark: 'winter-solstice' })).toBe('Solstício de inverno · a noite mais longa do ano')
    expect(COPY['pt-BR'].eventCaption({ kind: 'meteors', shower: 'perseids' })).toBe('Perseidas')
  })

  it('name every figure in both languages', () => {
    for (const f of SKY_FIGURES) {
      expect(f.pt).toBeTruthy()
      expect(f.en).toBeTruthy()
    }
  })
})

describe('the timeline', () => {
  const input = INPUT('pt-BR')
  const scene = skyScene(input, 2026, '2026-10-15')

  it('draws the first opening in about nine seconds, however many stars there are', () => {
    const t = timeline(scene, { first: true, delay: 1 })
    expect(t.end * DURATION_S).toBeGreaterThan(7)
    expect(t.end * DURATION_S).toBeLessThan(13)
    const waits = [...t.reveal.values()].map((r) => r.w)
    // in date order
    const days = [...t.reveal.keys()]
    expect(days).toEqual([...days].sort())
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual(waits[i - 1])
    // every closed month writes its name after its last star
    for (const m of scene.months.filter((x) => x.label)) {
      const last = Math.max(...m.stars.map((s) => t.reveal.get(s.day)!.w))
      expect(t.labels.get(m.month)!.w).toBeGreaterThan(last)
    }
    expect(t.moon!.w).toBeGreaterThan(Math.max(...waits))
  })

  it('plays at most three new stars, the newest, one after another', () => {
    const t = timeline(scene, { stars: ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'] })
    expect([...t.stars.keys()]).toEqual(['2026-10-13', '2026-10-14', '2026-10-15'])
    const [a, b, c] = [...t.stars.values()]
    expect(b.start).toBeGreaterThan(a.start)
    expect(c.start).toBeGreaterThan(b.start)
    // the pen leaves the star before, and the new one pops when it arrives
    expect(a.handoff).toBe('2026-10-12')
    expect(a.w).toBeGreaterThan(a.start)
  })

  it('lets a month breathe in the order its stars lit, then writes its name', () => {
    const t = timeline(scene, { named: ['2026-09'] })
    const sep = scene.months.find((m) => m.month === '2026-09')!
    const waits = sep.stars.filter((s) => !s.loose).map((s) => t.breathe.get(s.day)!.w)
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(waits[i - 1])
    expect(t.labels.get('2026-09')!.w).toBeGreaterThan(waits[waits.length - 1])
  })

  it('sends a shooting star before a halo, and nothing at all for no play', () => {
    const t = timeline(scene, { halos: ['p-2026-10-15'] })
    expect(t.meteor).not.toBeNull()
    expect(t.halos.get('p-2026-10-15')!.w).toBeGreaterThan(t.meteor!.w + t.meteor!.n - 0.1)
    expect(timeline(scene, null).end).toBe(0)
  })
})
