import { describe, expect, it } from 'vitest'
import type { Op } from '../../shared/types'
import type { Repository, TreeInput } from './repository'
import { openTestRepository } from './testing'

/**
 * Repository benchmark on a 50k-block workspace. Skipped unless SELIDA_BENCH=1:
 *
 *   SELIDA_BENCH=1 npx vitest run src/main/db/bench.test.ts
 *
 * Runs on node:sqlite in `:memory:`, so it measures the repository's own work
 * (statements, JSON, tree assembly) rather than disk latency.
 */
const enabled = process.env['SELIDA_BENCH'] === '1'

const WORDS = (
  'selida local first block page database note draft idea plan review meeting project design ' +
  'research summary action report margin kernel orchid lantern quartz harbor velvet cinder maple'
).split(' ')

let seed = 42
function rnd(n: number): number {
  // Deterministic LCG: every run builds the same workspace.
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed % n
}

function sentence(words: number): string {
  let out = ''
  for (let i = 0; i < words; i++) out += (i ? ' ' : '') + WORDS[rnd(WORDS.length)]
  return out
}

function text(marker = ''): TreeInput {
  return { type: 'text', props: { title: [[sentence(12) + marker]] } }
}

/** A page of `blocks` blocks: bullets with nested children and a few sub-pages inside toggles. */
function page(title: string, blocks: number, subPages: number): TreeInput {
  const children: TreeInput[] = []
  let left = blocks
  let pagesLeft = subPages
  while (left > 0) {
    const kids: TreeInput[] = []
    for (let i = 0; i < 9 && left > 1; i++, left--) {
      if (pagesLeft > 0 && i === 4) {
        pagesLeft--
        kids.push({ type: 'page', props: { title: [[`${title} sub ${pagesLeft}`]] }, children: [text()] })
      } else kids.push(text())
    }
    children.push({ type: 'toggle', props: { title: [[sentence(6)]] }, children: kids })
    left--
  }
  return { type: 'page', props: { title: [[title]] }, children }
}

function build(repo: Repository): { big: string; deep: string; total: number } {
  const big = repo.createTree(page('Big page', 2000, 20), null)
  // 480 pages of ~100 blocks, nested four levels deep under 10 root pages.
  let deep = big.id
  for (let r = 0; r < 10; r++) {
    let parent = repo.createTree(page(`Root ${r}`, 100, 0), null).id
    for (let i = 0; i < 47; i++) {
      const made = repo.createTree(page(`Page ${r}.${i} ${sentence(2)}`, 100, 0), parent)
      if (i % 12 === 11) parent = made.id
      if (r === 9 && i === 46) deep = made.id
    }
  }
  repo.update(deep, { props: { favorite: true } })
  // One needle that only the substring fallback can find, in a block deep inside the tree.
  const host = repo.children(deep)[0]
  repo.create({ type: 'text', parentId: host.id, props: { title: [['xx-zebrafinch-yy needle']] } })
  repo.drainChanges()
  let total = 0
  for (const root of repo.listRoot()) total += count(repo, root.id)
  return { big: big.id, deep, total }
}

function count(repo: Repository, id: string): number {
  let n = 0
  for (const b of repo.getTree(id)) n += b.id !== id && (b.type === 'page' || b.type === 'database') ? count(repo, b.id) : 1
  return n
}

function time(label: string, runs: number, fn: () => unknown, results: Record<string, string>): void {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  results[label] = `${samples[Math.floor(samples.length / 2)].toFixed(2)} ms`
}

describe.skipIf(!enabled)('benchmark (SELIDA_BENCH=1)', () => {
  it('reports timings on a 50k-block workspace', () => {
    const repo = openTestRepository()
    const results: Record<string, string> = {}
    const started = performance.now()
    const { big, deep, total } = build(repo)
    results['build workspace'] = `${(performance.now() - started).toFixed(0)} ms (${total} blocks)`
    expect(total).toBeGreaterThan(50_000)

    const tree = repo.getTree(big)
    expect(tree.length).toBeGreaterThan(2000)
    const leaves = tree.filter((b) => b.type === 'text')

    time('getTree (2k-block page)', 15, () => repo.getTree(big), results)
    time('listChildren (2k-block page)', 15, () => repo.listChildren(big), results)
    time('children (200 direct children)', 15, () => repo.children(big), results)
    time('listRoot', 15, () => repo.listRoot(), results)
    time('listRecent(20)', 15, () => repo.listRecent(20), results)
    time('listFavorites', 15, () => repo.listFavorites(), results)
    time('ancestors (5 levels)', 15, () => repo.ancestors(deep), results)
    time('search "project" (common prefix)', 15, () => repo.search('project', 20), results)
    time('search "proj des" (two terms)', 15, () => repo.search('proj des', 20), results)
    time('search "zebrafinch" (substring fallback)', 15, () => repo.search('zebrafinch', 20), results)
    time('search "nothingmatches" (miss)', 15, () => repo.search('nothingmatches', 20), results)
    expect(repo.search('zebrafinch', 20)).toHaveLength(1)

    // Typing: one small update per transaction, on blocks inside the big page.
    let n = 0
    time(
      'update (one typing transaction)',
      400,
      () => {
        const b = leaves[n++ % leaves.length]
        repo.update(b.id, { props: { title: [[`typed ${n} ${sentence(8)}`]] } })
      },
      results
    )

    const updates: Op[] = leaves.slice(0, 1000).map((b, i) => ({
      op: 'update',
      id: b.id,
      patch: { props: { title: [[`batch ${i} ${sentence(8)}`]] } }
    }))
    time('apply (1k update ops)', 5, () => repo.apply(updates), results)

    const host = repo.create({ type: 'page', parentId: null, props: { title: [['Bulk target']] } })
    let round = 0
    time(
      'apply (1k create ops, one parent)',
      3,
      () => {
        round++
        const creates: Op[] = Array.from({ length: 1000 }, (_, i) => ({
          op: 'create',
          input: { type: 'text', parentId: host.id, props: { title: [[`created ${round}.${i}`]] } }
        }))
        repo.apply(creates)
      },
      results
    )

    time('duplicate (2k-block page)', 3, () => repo.duplicate(big), results)
    time('delete (2k-block toggle tree, via apply)', 1, () => repo.apply(repo.children(big).map((b) => ({ op: 'delete', id: b.id }))), results)

    repo.close()
    // Written straight to stdout: vitest does not echo console output of passing tests.
    process.stdout.write('\n' + Object.entries(results).map(([k, v]) => `${k.padEnd(44)} ${v}`).join('\n') + '\n\n')
  }, 300_000)

  /**
   * Version history must cost nothing noticeable while typing: a snapshot is O(page size),
   * but it is taken at most once per session gap, never per keystroke. Typing transactions
   * on a 2k-block page are timed with history off and on, in alternating rounds on the same
   * database so that drift (cache, WAL, JIT) hits both alike.
   */
  it('typing costs the same with version history on', () => {
    let now = Date.UTC(2026, 0, 1)
    const repo = openTestRepository(':memory:', { clock: () => now })
    const big = repo.createTree(page('Big page', 2000, 20), null)
    const leaves = repo.getTree(big.id).filter((b) => b.type === 'text')
    const median = (samples: number[]): number => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]
    let n = 0
    const type = (): number => {
      const b = leaves[n++ % leaves.length]
      const start = performance.now()
      repo.update(b.id, { props: { title: [[`typed ${n} ${sentence(8)}`]] } })
      return performance.now() - start
    }
    // Warm-up, and the one snapshot this session takes (the state before its first edit).
    repo.setSetting('history.enabled', true)
    const first = type()
    for (let i = 0; i < 300; i++) type()
    expect(repo.listVersions(big.id)).toHaveLength(1)

    const off: number[] = []
    const on: number[] = []
    for (let round = 0; round < 6; round++) {
      repo.setSetting('history.enabled', false)
      for (let i = 0; i < 400; i++) off.push(type())
      repo.setSetting('history.enabled', true)
      for (let i = 0; i < 400; i++) on.push(type())
      // A few seconds of typing pass; the session is still the same one.
      now += 5_000
    }
    // 2400 keystrokes later there is still exactly one version: nothing was captured per keystroke.
    expect(repo.listVersions(big.id)).toHaveLength(1)
    const baseline = median(off)
    const withHistory = median(on)
    // Within a quarter of the baseline plus 10 microseconds of timer noise.
    expect(withHistory).toBeLessThanOrEqual(baseline * 1.25 + 0.01)

    // The next session starts with one O(page) snapshot, and only one.
    now += 11 * 60_000
    const captured = type()
    const after = type()
    expect(repo.listVersions(big.id)).toHaveLength(2)
    const stats = repo.versionStats()
    repo.close()
    process.stdout.write(
      '\n' +
        [
          ['update, history off (median of 2400)', `${baseline.toFixed(4)} ms`],
          ['update, history on (median of 2400)', `${withHistory.toFixed(4)} ms`],
          ['overhead', `${(((withHistory - baseline) / baseline) * 100).toFixed(1)} %`],
          ['first update of a session (snapshot, 2k blocks)', `${captured.toFixed(2)} ms (first ever: ${first.toFixed(2)} ms)`],
          ['update right after it', `${after.toFixed(4)} ms`],
          ['stored', `${stats.count} versions, ${(stats.bytes / 1024).toFixed(1)} KiB compressed`]
        ]
          .map(([k, v]) => `${k.padEnd(48)} ${v}`)
          .join('\n') +
        '\n\n'
    )
  }, 300_000)
})
