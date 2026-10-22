import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { pageLink } from '../../shared/pageLink'
import type { Op } from '../../shared/types'
import { type DatabaseCheck, inspectDatabase, takeBackup, takeBackupApart } from '../data/backups'
import { bareRemote, device, GIT } from '../sync/harness'
import type { Repository, TreeInput } from './repository'
import { openTestDatabase, openTestRepository } from './testing'

/**
 * Repository benchmark on a 50k-block workspace. Skipped unless SEL_BENCH=1:
 *
 *   SEL_BENCH=1 npx vitest run src/main/db/bench.test.ts
 *
 * Runs on node:sqlite in `:memory:`, so it measures the repository's own work
 * (statements, JSON, tree assembly) rather than disk latency. Two parts touch the disk: the
 * sync cycles (real git, skipped without it) and the backup of a 200 MB file, made in
 * SEL_BENCH_DIR when set (the system temp folder otherwise) and deleted afterwards.
 */
const enabled = process.env['SEL_BENCH'] === '1'

const WORDS = (
  'sel local first block page database note draft idea plan review meeting project design ' +
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

/** A database of `rows` rows, each a page with a title and two values. */
function database(title: string, rows: number): TreeInput {
  const children: TreeInput[] = []
  for (let i = 0; i < rows; i++) {
    children.push({ type: 'page', props: { title: [[`${title} ${i} ${sentence(3)}`]], values: { n: i, note: sentence(4) } } })
  }
  return { type: 'database', props: { title: [[title]] }, children }
}

interface Built {
  big: string
  deep: string
  db: string
  total: number
}

function build(repo: Repository): Built {
  const big = repo.createTree(page('Big page', 2000, 20), null)
  // 480 pages of ~100 blocks, nested four levels deep under 10 root pages.
  let deep = big.id
  const pages: string[] = []
  for (let r = 0; r < 10; r++) {
    let parent = repo.createTree(page(`Root ${r}`, 100, 0), null).id
    for (let i = 0; i < 47; i++) {
      const made = repo.createTree(page(`Page ${r}.${i} ${sentence(2)}`, 100, 0), parent)
      pages.push(made.id)
      if (i % 12 === 11) parent = made.id
      if (r === 9 && i === 46) deep = made.id
    }
  }
  repo.update(deep, { props: { favorite: true } })
  // One needle that only the substring fallback can find, in a block deep inside the tree.
  const host = repo.children(deep)[0]
  repo.create({ type: 'text', parentId: host.id, props: { title: [['xx-zebrafinch-yy needle']] } })
  // 25 paragraphs elsewhere link to the big page: what its "Linked from" lists.
  for (let i = 0; i < 25; i++) {
    const at = repo.children(pages[(i * 37) % pages.length])[0]
    repo.create({ type: 'text', parentId: at.id, props: { title: [['see '], ['the big page', [['a', pageLink(big.id)]]]] } })
  }
  // A database of 5k rows (each row a page), shown again as a linked view, and one archived page.
  const db = repo.createTree(database('Task', 5000), null)
  repo.create({ type: 'database', parentId: deep, props: { sourceId: db.id } })
  repo.update(pages[100], { props: { archivedAt: 1_700_000_000_000 } })
  repo.drainChanges()
  let total = 0
  for (const root of repo.listRoot()) total += count(repo, root.id)
  return { big: big.id, deep, db: db.id, total }
}

function count(repo: Repository, id: string): number {
  let n = 0
  for (const b of repo.getTree(id)) n += b.id !== id && (b.type === 'page' || b.type === 'database') ? count(repo, b.id) : 1
  return n
}

/**
 * copyAndCheck's statements (data/backups.ts) in a worker thread on node:sqlite: what the
 * utility process of the app does, where a plain test can run it.
 */
function inWorker(file: string, partial: string): Promise<DatabaseCheck> {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads')
    const { DatabaseSync } = require('node:sqlite')
    const src = new DatabaseSync(workerData.file, { readOnly: true })
    src.prepare('VACUUM INTO ?').run(workerData.partial)
    src.close()
    const copy = new DatabaseSync(workerData.partial, { readOnly: true })
    const check = copy.prepare('PRAGMA quick_check').all()
    const row = copy.prepare("SELECT COUNT(*) AS pages FROM blocks WHERE type IN ('page', 'database') AND trashed_at IS NULL").get()
    copy.close()
    parentPort.postMessage(check.length === 1 && check[0].quick_check === 'ok' ? { ok: true, pages: Number(row.pages), lastEdit: null } : { ok: false, problem: 'damaged' })
  `
  return new Promise((resolve, reject) => {
    const worker = new Worker(code, { eval: true, workerData: { file, partial } })
    worker.once('message', (check: DatabaseCheck) => {
      resolve(check)
      void worker.terminate()
    })
    worker.once('error', reject)
  })
}

function print(rows: [string, string][], width = 48): void {
  // Written straight to stdout: vitest does not echo console output of passing tests.
  process.stdout.write(`\n${rows.map(([k, v]) => `${k.padEnd(width)} ${v}`).join('\n')}\n\n`)
}

/** Lets the event-loop delay monitor tick once more (see the sync cycle). */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 25))

const median = (samples: number[]): number => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]

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

describe.skipIf(!enabled)('benchmark (SEL_BENCH=1)', () => {
  it('reports timings on a 50k-block workspace', () => {
    const repo = openTestRepository()
    const results: Record<string, string> = {}
    const started = performance.now()
    const { big, deep, db, total } = build(repo)
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
    time('listArchived', 15, () => repo.listArchived(), results)
    time('listDatabases', 15, () => repo.listDatabases(), results)
    time('databaseLocations (linked views of a db)', 15, () => repo.databaseLocations(db), results)
    time('ancestors (5 levels)', 15, () => repo.ancestors(deep), results)
    time('search "project" (common prefix)', 15, () => repo.search('project', 20), results)
    time('search "proj des" (two terms)', 15, () => repo.search('proj des', 20), results)
    time('search "zebrafinch" (substring fallback)', 15, () => repo.search('zebrafinch', 20), results)
    time('search "nothingmatches" (miss)', 15, () => repo.search('nothingmatches', 20), results)
    time('backlinks (25 links to a page)', 15, () => repo.backlinks(big), results)
    time('backlinks (a page nobody links to)', 15, () => repo.backlinks(deep), results)
    expect(repo.search('zebrafinch', 20)).toHaveLength(1)
    expect(repo.backlinks(big)).toHaveLength(25)
    expect(repo.listFavorites()).toHaveLength(1)
    expect(repo.listArchived()).toHaveLength(1)
    expect(repo.databaseLocations(db)).toHaveLength(1)

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
    time(
      'delete (2k-block toggle tree, via apply)',
      1,
      () => repo.apply(repo.children(big).map((b) => ({ op: 'delete', id: b.id }))),
      results
    )

    repo.close()
    // Written straight to stdout: vitest does not echo console output of passing tests.
    process.stdout.write(
      '\n' +
        Object.entries(results)
          .map(([k, v]) => `${k.padEnd(44)} ${v}`)
          .join('\n') +
        '\n\n'
    )
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
  /**
   * The first change of a session to a row of a large database: the row is a page with a
   * history of its own; what it costs must not grow with the number of rows beside it.
   */
  it('first edit of a database row, 5k rows, history on', () => {
    let now = Date.UTC(2026, 0, 1)
    const repo = openTestRepository(':memory:', { clock: () => now })
    const db = repo.createTree(database('Task', 5000), null)
    const rows = repo.children(db.id)
    repo.setSetting('history.enabled', true)
    const edit: number[] = []
    const add: number[] = []
    for (let i = 0; i < 15; i++) {
      // Each sample starts a new session (the gap is longer than the default 10 minutes).
      now += 11 * 60_000
      const row = rows[(i * 331) % rows.length]
      let start = performance.now()
      repo.update(row.id, { props: { values: { n: -i, note: 'edited' } } })
      edit.push(performance.now() - start)
      now += 11 * 60_000
      start = performance.now()
      repo.create({ type: 'page', parentId: db.id, props: { title: [[`new ${i}`]] } })
      add.push(performance.now() - start)
    }
    now += 11 * 60_000
    for (const row of rows.slice(0, 50)) repo.update(row.id, { props: { values: { n: 0 } } })
    const start = performance.now()
    const flushed = repo.flushVersions()
    const flush = performance.now() - start
    repo.close()
    print([
      ['first edit of a row (median of 15)', `${median(edit).toFixed(2)} ms`],
      ['first new row of a session (median of 15)', `${median(add).toFixed(2)} ms`],
      ['flushVersions after editing 50 rows', `${flush.toFixed(2)} ms (${flushed} versions)`]
    ])
  }, 300_000)

  /**
   * A sync cycle against a local bare repository, with real git: idle (nothing changed) and
   * with one edit. `longest block` is the longest the event loop - the IPC of every window -
   * was held up during the cycle; `rows read` counts full reads of the blocks table.
   */
  it.skipIf(!GIT)(
    'sync cycle at 50k blocks',
    async () => {
      const a = device('Bench', 1_000_000)
      const { big, total } = build(a.repo)
      const leaf = a.repo.getTree(big).find((b) => b.type === 'text') as { id: string }
      const remote = bareRemote()
      let start = performance.now()
      const first = await a.setup(remote)
      const setup = performance.now() - start
      expect(first.lastError).toBeUndefined()
      const reads = vi.spyOn(a.repo, 'syncRows')
      const cycle = async (edit: (() => void) | null): Promise<{ wall: number[]; block: number[]; reads: number }> => {
        const wall: number[] = []
        const block: number[] = []
        reads.mockClear()
        for (let i = 0; i < 7; i++) {
          edit?.()
          const loop = monitorEventLoopDelay({ resolution: 1 })
          loop.enable()
          start = performance.now()
          const status = await a.engine.now()
          wall.push(performance.now() - start)
          // The histogram only sees a block once a timer fires after it: a cycle that ends with
          // its heaviest work (an idle one did) would otherwise not count it.
          await settle()
          loop.disable()
          block.push(loop.max / 1e6)
          expect(status.lastError).toBeUndefined()
        }
        return { wall, block, reads: reads.mock.calls.length }
      }
      const idle = await cycle(null)
      let n = 0
      const edited = await cycle(() => a.repo.update(leaf.id, { props: { title: [[`edited ${++n}`]] } }))
      a.repo.close()
      const line = (r: { wall: number[]; block: number[]; reads: number }): string =>
        `${median(r.wall).toFixed(0)} ms, longest block ${median(r.block).toFixed(1)} ms, rows read ${r.reads}x in 7 cycles`
      print([
        ['first upload', `${setup.toFixed(0)} ms (${total} blocks)`],
        ['idle cycle (median of 7)', line(idle)],
        ['cycle with one edit (median of 7)', line(edited)]
      ])
    },
    600_000
  )

  /**
   * The daily backup (`VACUUM INTO` + `quick_check` + a count) on a database file of about
   * 200 MB: whether it may stay in the main process (decision 5 of release 0.7.0: move it to a
   * utilityProcess only above ~300 ms).
   */
  it('takeBackup on a 200 MB database', async () => {
    const dir = mkdtempSync(join(process.env['SEL_BENCH_DIR'] ?? tmpdir(), 'sel-bench-'))
    try {
      const file = join(dir, 'sel.db')
      const { repo, db } = openTestDatabase(file)
      const target = 200 * 1024 * 1024
      let pages = 0
      const started = performance.now()
      while (repo.byteSize() < target) repo.createTree(page(`Filler ${pages++}`, 2000, 0), null)
      const built = performance.now() - started
      // The app checkpoints as it goes: the copy reads the main file, not a long WAL.
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      const open = (f: string): DatabaseSync => new DatabaseSync(f, { readOnly: true })
      const out = join(dir, 'backups')
      const backup: number[] = []
      const copy: number[] = []
      const check: number[] = []
      let size = 0
      for (let i = 0; i < 3; i++) {
        let start = performance.now()
        const made = takeBackup({ source: repo, dir: out, kind: 'manual', now: Date.UTC(2026, 0, 1 + i * 30), open })
        backup.push(performance.now() - start)
        size = made.size
        start = performance.now()
        expect(inspectDatabase(open, made.path).ok).toBe(true)
        check.push(performance.now() - start)
        rmSync(made.path)
        const plain = join(dir, `copy-${i}.db`)
        start = performance.now()
        repo.copyTo(plain)
        copy.push(performance.now() - start)
        rmSync(plain)
      }
      // The app makes it apart (takeBackupApart + a utility process running copyAndCheck): here a
      // worker thread runs the same statements on node:sqlite, and what is timed is how long the
      // main thread was held up meanwhile.
      const apart: number[] = []
      const held: number[] = []
      for (let i = 0; i < 3; i++) {
        const loop = monitorEventLoopDelay({ resolution: 1 })
        loop.enable()
        const start = performance.now()
        const made = await takeBackupApart({
          source: repo,
          file,
          dir: out,
          kind: 'manual',
          now: Date.UTC(2026, 6, 1 + i * 30),
          work: (from, partial) => inWorker(from, partial)
        })
        apart.push(performance.now() - start)
        await settle()
        loop.disable()
        held.push(loop.max / 1e6)
        rmSync(made.path)
      }
      const bytes = repo.byteSize()
      repo.close()
      print(
        [
          ['database', `${(bytes / 1024 / 1024).toFixed(0)} MB (${pages} pages of 2k blocks, built in ${(built / 1000).toFixed(1)} s)`],
          ['takeBackup in the main thread (median of 3)', `${median(backup).toFixed(0)} ms (backup ${(size / 1024 / 1024).toFixed(0)} MB)`],
          ['  VACUUM INTO alone (median of 3)', `${median(copy).toFixed(0)} ms`],
          ['  the check alone: quick_check + count (median of 3)', `${median(check).toFixed(0)} ms`],
          ['takeBackupApart, copy and check in a worker (median of 3)', `${median(apart).toFixed(0)} ms`],
          ['  longest the main thread was held up (median of 3)', `${median(held).toFixed(1)} ms`]
        ],
        60
      )
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 600_000)
})
