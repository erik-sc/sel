/**
 * Sync against real git, encryption, incremental export, several devices, databases, pausing and timings.
 * Skipped, with a message, on a computer without git (see ./harness.ts).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { bareRemote, commitCount, device, git, pair, plain, PNG, remoteFiles, ROOT, suite, sync } from './harness'

suite('sync with real git: scale', () => {
  it('encrypts everything with a passphrase and detects a wrong one', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const name = '11111111-2222-4333-8444-555566667777.png'
    writeFileSync(join(a.filesDir, name), PNG)
    const page = a.page('Top secret plans')
    a.text(page.id, 'The launch code is swordfish')
    a.repo.create({ type: 'image', parentId: page.id, props: { url: `sel-file://files/${name}` } })
    a.repo.setSetting('appearance', { version: 1, light: { '--accent': '#123456' }, dark: {}, shared: {}, customCss: '', presetId: null })
    const status = await a.setup(remote, { passphrase: 'correct horse battery' })
    expect(status).toMatchObject({ configured: true, encrypted: true })
    expect(status.lastError).toBeUndefined()

    const files = remoteFiles(remote)
    const paths = [...files.keys()].sort()
    expect(paths.filter((p) => p.startsWith('pages/'))).toHaveLength(1)
    expect(paths.filter((p) => p.startsWith('files/'))).toHaveLength(1)
    for (const path of paths) {
      // No id, no image name, nothing readable: not in the names, not in the contents.
      expect(path).not.toContain(page.id)
      expect(path).not.toContain(name)
      if (path === 'sel.json' || path === 'README.md') continue
      const bytes = files.get(path)!
      for (const secret of ['swordfish', 'Top secret', page.id, '#123456', 'IHDR-and-some-pixels'])
        expect(bytes.includes(secret), `${path}: ${secret}`).toBe(false)
    }
    const meta = JSON.parse(files.get('sel.json')!.toString()) as Record<string, unknown>
    expect(Object.keys(meta).sort()).toEqual(['app', 'encryption', 'format'])
    expect(meta['encryption']).toMatchObject({ kdf: 'scrypt', v: 1 })
    // The key is with the OS keychain, never in the settings; the passphrase itself is nowhere.
    expect(JSON.stringify(a.repo.getSetting('sync.remoteUrl'))).not.toContain('correct horse')
    expect(a.secrets.value).not.toContain('correct horse')
    for (const key of ['sync.remoteUrl', 'sync.deviceName', 'sync.lastCommit', 'sync.activity', 'sync.encrypted']) {
      expect(JSON.stringify(a.repo.getSetting(key))).not.toContain(
        JSON.parse(a.secrets.value!).keys[(meta['encryption'] as { salt: string }).salt].enc
      )
    }

    const b = device('Device B', 2_000_000)
    expect(await b.setup(remote)).toMatchObject({ configured: false, lastError: { code: 'passphrase-required' } })
    expect(await b.setup(remote, { passphrase: 'wrong horse battery' })).toMatchObject({
      configured: false,
      lastError: { code: 'wrong-passphrase' }
    })
    expect(b.titles()).toEqual([])
    const ok = await b.setup(remote, { passphrase: 'correct horse battery' })
    expect(ok).toMatchObject({ configured: true, encrypted: true })
    expect(ok.lastError).toBeUndefined()
    expect(b.texts(page.id)).toEqual(['The launch code is swordfish', ''])
    expect(readFileSync(join(b.filesDir, name)).equals(PNG)).toBe(true)
    expect(b.repo.getSetting('appearance')).toMatchObject({ light: { '--accent': '#123456' } })

    // And on from there, both ways, still sealed.
    b.text(page.id, 'B adds a hidden line')
    await sync(b, a)
    expect(a.texts(page.id)).toContain('B adds a hidden line')
    for (const bytes of remoteFiles(remote).values()) expect(bytes.includes('hidden line')).toBe(false)
  })

  it('turns encryption on and off for an existing repository as a re-upload, and asks the other device for the passphrase', async () => {
    const { remote, a, b, pageId } = await pair()
    a.text(pageId, 'written before encryption')
    await sync(a, b)
    const sealedStatus = await a.engine.setEncryption('a new passphrase')
    expect(sealedStatus).toMatchObject({ encrypted: true, state: 'idle' })
    expect(sealedStatus.lastError).toBeUndefined()
    const files = remoteFiles(remote)
    expect([...files.keys()].some((path) => path.endsWith('.json') && path.startsWith('pages/'))).toBe(false)
    for (const [path, bytes] of files) if (path !== 'README.md') expect(bytes.includes('written before encryption'), path).toBe(false)

    // The other device has edits of its own and no key yet.
    b.text(pageId, 'written on B meanwhile')
    const locked = await b.engine.now()
    expect(locked).toMatchObject({ state: 'error', lastError: { code: 'passphrase-required' } })
    expect(b.texts(pageId)).toContain('written on B meanwhile')
    expect(await b.engine.unlock('not the passphrase')).toMatchObject({ lastError: { code: 'wrong-passphrase' } })
    const unlocked = await b.engine.unlock('a new passphrase')
    expect(unlocked.lastError).toBeUndefined()
    expect(unlocked.encrypted).toBe(true)
    await sync(a)
    expect(a.texts(pageId)).toEqual(['one', 'two', 'three', 'written before encryption', 'written on B meanwhile'])

    // Off again: readable files, and the other device follows without being asked anything.
    expect(await a.engine.setEncryption(null)).toMatchObject({ encrypted: false, state: 'idle' })
    expect(remoteFiles(remote).get(`pages/${pageId}.json`)!.toString()).toContain('written on B meanwhile')
    a.text(pageId, 'in the clear again')
    await sync(a, b)
    expect(b.texts(pageId)).toContain('in the clear again')
    expect(b.engine.status().encrypted).toBe(false)
  })

  it('rewrites only the files of pages that changed', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const pages = ['One', 'Two', 'Three', 'Four'].map((title) => a.page(title))
    for (const page of pages) a.text(page.id, `text of ${plain(page.props.title)}`)
    await a.setup(remote)
    const clone = join(a.dir, 'sync', 'repo')
    const stamp = (id: string): string => git(remote, 'rev-parse', `main:pages/${id}.json`).trim()
    const before = pages.map((page) => stamp(page.id))

    const line = a.text(pages[2].id, 'a new line in Three')
    a.spawns.length = 0
    await sync(a)
    expect(git(remote, 'show', '--name-only', '--format=', 'main').trim().split('\n')).toEqual([`pages/${pages[2].id}.json`])
    expect(pages.map((page) => stamp(page.id) === before[pages.indexOf(page)])).toEqual([true, true, false, true])
    // No tree of the repository was read for it: nothing came down.
    expect(a.spawns.some(({ args }) => args.includes('cat-file') || args.includes('ls-tree'))).toBe(false)

    // A page that is deleted for good loses its file; the others are not touched.
    a.repo.delete(pages[0].id)
    a.repo.deleteForever(pages[0].id)
    a.repo.update(line.id, { props: { title: [['reworded']] } })
    await sync(a)
    expect(git(remote, 'show', '--name-status', '--format=', 'main').trim().split('\n').sort()).toEqual(
      [`D\tpages/${pages[0].id}.json`, `M\tpages/${pages[2].id}.json`, 'M\tworkspace.json'].sort()
    )
    expect(existsSync(join(clone, 'pages', `${pages[0].id}.json`))).toBe(false)

    // On the receiving side too: a merge only rewrites what differs from what was downloaded.
    const b = device('Device B', 2_000_000)
    await b.setup(remote)
    const count = commitCount(remote)
    b.text(pages[1].id, 'from B')
    a.text(pages[3].id, 'from A')
    await sync(a, b)
    expect(commitCount(remote)).toBe(count + 2)
    expect(git(remote, 'show', '--name-only', '--format=', 'main').trim().split('\n')).toEqual([`pages/${pages[1].id}.json`])
  })

  it('keeps three devices in step', async () => {
    const { remote, a, b, pageId, blocks } = await pair()
    const c = device('Device C', 3_000_000)
    expect((await c.setup(remote)).lastError).toBeUndefined()
    a.repo.update(blocks[0], { props: { title: [['A']] } })
    b.repo.update(blocks[1], { props: { title: [['B']] } })
    c.repo.update(blocks[2], { props: { title: [['C']] } })
    const fromC = c.page('Page from C')
    a.text(pageId, 'tail from A')
    await sync(a, b, c, a, b)
    for (const d of [a, b, c]) {
      expect(d.texts(pageId), d.name).toEqual(['A', 'B', 'C', 'tail from A'])
      expect(d.titles(), d.name).toEqual(['Shared page', 'Page from C'])
    }
    // All three change the same block while offline: one text everywhere, the latest clock's.
    a.repo.update(blocks[0], { props: { title: [['A again']] } })
    b.repo.update(blocks[0], { props: { title: [['B again']] } })
    c.repo.update(blocks[0], { props: { title: [['C again']] } })
    c.repo.delete(fromC.id)
    await sync(b, c, a, b, c, a)
    for (const d of [a, b, c]) {
      expect(d.texts(pageId)[0], d.name).toBe('C again')
      expect(d.titles(), d.name).toEqual(['Shared page'])
    }
  })

  it('syncs databases: schema, rows, views and linked views', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const home = a.page('Home')
    const db = a.repo.create({ type: 'database', parentId: home.id, props: { title: [['Tasks']] } })
    const schema = {
      ...db.props.schema!,
      status: { id: 'status', name: 'Status', type: 'select' as const, options: [{ id: 'o1', name: 'Todo', color: 'gray' }] }
    }
    a.repo.update(db.id, { props: { schema } })
    const row = a.repo.create({ type: 'page', parentId: db.id, props: { title: [['Row 1']], values: { status: 'o1' } } })
    const linked = a.repo.create({ type: 'database', parentId: home.id, props: { sourceId: db.id } })
    await a.setup(remote)
    const b = device('Device B', 2_000_000)
    await b.setup(remote)
    expect(Object.keys(b.repo.get(db.id)!.props.schema!)).toEqual(['title', 'status'])
    expect(b.repo.get(linked.id)?.props.sourceId).toBe(db.id)
    expect(b.repo.databaseLocations(db.id).map((l) => l.block.id)).toEqual([linked.id])

    // Offline on both: a new property each, a value each, a view on one.
    a.repo.update(db.id, { props: { schema: { ...schema, due: { id: 'due', name: 'Due', type: 'date' } } } })
    a.repo.update(row.id, { props: { values: { status: 'o1', due: { start: '2026-10-13' } } } })
    const fromB = b.repo.get(db.id)!
    b.repo.update(db.id, {
      props: {
        schema: { ...fromB.props.schema!, points: { id: 'points', name: 'Points', type: 'number' } },
        views: [
          ...fromB.props.views!,
          {
            id: 'chart-1',
            name: 'Chart',
            type: 'chart',
            visibleProperties: ['title'],
            filters: [],
            sorts: [],
            chart: { kind: 'bar', x: 'status', y: { aggregate: 'count' } }
          }
        ]
      }
    })
    b.repo.update(row.id, { props: { values: { status: 'o1', points: 3 } } })
    b.repo.create({ type: 'page', parentId: db.id, props: { title: [['Row 2']] } })
    await sync(a, b, a)
    for (const d of [a, b]) {
      const merged = d.repo.get(db.id)!
      expect(Object.keys(merged.props.schema!).sort(), d.name).toEqual(['due', 'points', 'status', 'title'])
      expect(
        merged.props.views!.map((v) => v.type),
        d.name
      ).toEqual(['table', 'chart'])
      expect(merged.props.views![1].chart, d.name).toMatchObject({ kind: 'bar', x: 'status' })
      expect(d.repo.get(row.id)!.props.values, d.name).toEqual({ status: 'o1', due: { start: '2026-10-13' }, points: 3 })
      expect(
        d.repo.children(db.id).map((r) => plain(r.props.title)),
        d.name
      ).toEqual(['Row 1', 'Row 2'])
    }
    expect(Object.keys(a.repo.get(db.id)!.props.schema!)).toEqual(Object.keys(b.repo.get(db.id)!.props.schema!))
  })

  it('pauses, reports pending pages, and disconnects without touching the repository', async () => {
    const { remote, a, pageId } = await pair()
    a.engine.pause(true)
    a.text(pageId, 'while paused')
    a.engine.noteLocalChange()
    expect(a.engine.status()).toMatchObject({ paused: true, pending: 1 })
    expect(await a.engine.auto()).toBeNull()
    expect(remoteFiles(remote).get(`pages/${pageId}.json`)!.toString()).not.toContain('while paused')
    a.engine.pause(false)
    expect(await a.engine.auto()).toBeNull()
    expect(remoteFiles(remote).get(`pages/${pageId}.json`)!.toString()).toContain('while paused')
    expect(a.engine.status().pending).toBe(0)
    expect(a.statuses.some((status) => status.state === 'syncing')).toBe(true)

    const commits = commitCount(remote)
    const status = await a.engine.disconnect()
    expect(status).toMatchObject({ configured: false, state: 'needs-setup', activity: [] })
    expect(existsSync(join(a.dir, 'sync', 'repo'))).toBe(false)
    expect(a.repo.getSetting('sync.remoteUrl')).toBeNull()
    expect(a.repo.syncStates().size).toBe(0)
    // The pages stay on the device, and the repository is exactly as it was.
    expect(a.texts(pageId)).toContain('while paused')
    expect(commitCount(remote)).toBe(commits)
    expect(remoteFiles(remote).size).toBeGreaterThan(3)
    // Connecting again later merges by id: nothing is doubled.
    const again = await a.setup(remote, { mode: 'merge' })
    expect(again.lastError).toBeUndefined()
    expect(a.titles()).toEqual(['Shared page'])
    expect(commitCount(remote)).toBe(commits)
  })

  it('reports an unreachable or missing repository without leaking the address', async () => {
    const a = device('Device A', 1_000_000)
    a.page('Mine')
    const missing = join(ROOT, 'secret-token-ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'nope.git')
    const status = await a.setup(missing)
    expect(status).toMatchObject({ configured: false, lastError: { code: 'repo-not-found' } })
    const said = JSON.stringify(status)
    expect(said).not.toContain('ghp_')
    expect(said).not.toContain(ROOT.replace(/\\/g, '\\\\'))
    expect(await a.setup('https://user:token@example.com/repo.git')).toMatchObject({ lastError: { code: 'invalid-url' } })
    expect(await a.setup('ext::sh -c "touch pwned"')).toMatchObject({ lastError: { code: 'invalid-url' } })
    expect(a.spawns.every(({ args }) => !args.some((arg) => arg.includes('ext::') || arg.includes('token@')))).toBe(true)
  })

  it('goes quiet when the repository disappears and resumes when it is back', async () => {
    const { remote, a, pageId } = await pair()
    const hidden = `${remote}.away`
    execFileSync(
      process.platform === 'win32' ? 'cmd.exe' : 'mv',
      process.platform === 'win32' ? ['/d', '/c', 'move', remote, hidden] : [remote, hidden],
      { stdio: 'ignore' }
    )
    a.text(pageId, 'written while the remote was away')
    const down = await a.engine.now()
    expect(down.lastError?.code).toBe('repo-not-found')
    expect(down.state).toBe('error')
    await a.engine.now()
    // Listed once, not once per attempt.
    expect(a.engine.status().activity.filter((entry) => entry.error === 'repo-not-found')).toHaveLength(1)
    execFileSync(
      process.platform === 'win32' ? 'cmd.exe' : 'mv',
      process.platform === 'win32' ? ['/d', '/c', 'move', hidden, remote] : [hidden, remote],
      { stdio: 'ignore' }
    )
    await sync(a)
    expect(remoteFiles(remote).get(`pages/${pageId}.json`)!.toString()).toContain('written while the remote was away')
  })

  it('handles a 5,000-block workspace: timings', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const PAGES = 50
    const PER_PAGE = 99
    const ids: string[] = []
    for (let p = 0; p < PAGES; p++) {
      const page = a.repo.createTree(
        {
          type: 'page',
          props: { title: [[`Page ${p}`]] },
          children: Array.from({ length: PER_PAGE }, (_, i) => ({
            type: 'text' as const,
            props: { title: [[`Paragraph ${i} of page ${p}: the quick brown fox jumps over the lazy dog.`]] }
          }))
        },
        null
      )
      ids.push(page.id)
    }
    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      const start = performance.now()
      await fn()
      return Math.round(performance.now() - start)
    }
    const firstUpload = await time(async () => expect((await a.setup(remote)).lastError).toBeUndefined())
    const b = device('Device B', 2_000_000)
    const firstDownload = await time(async () => expect((await b.setup(remote)).lastError).toBeUndefined())
    expect(b.repo.syncRows()).toHaveLength(PAGES * (PER_PAGE + 1))
    const idle = await time(() => sync(a))
    a.repo.update(a.repo.getTree(ids[7])[5].id, { props: { title: [['edited']] } })
    const oneEdit = await time(() => sync(a))
    b.repo.update(b.repo.getTree(ids[20])[9].id, { props: { title: [['edited on B']] } })
    const mergeDown = await time(() => sync(b))
    // The parts that are sel's own work, without git.
    const rows = a.repo.syncRows()
    const { fingerprintPages, workspaceFromRows } = await import('./format')
    const { mergeWorkspace } = await import('./merge')
    const t0 = performance.now()
    fingerprintPages(rows)
    const scan = performance.now() - t0
    const ws = workspaceFromRows(rows, a.repo.rootOrder())
    const t1 = performance.now()
    mergeWorkspace(ws, ws, workspaceFromRows(b.repo.syncRows(), b.repo.rootOrder()))
    const merge = performance.now() - t1
    console.log(
      `[sync timing] 5,000 blocks in ${PAGES} pages: first upload ${firstUpload} ms, first download ${firstDownload} ms, idle cycle ${idle} ms, one edited page up ${oneEdit} ms, merge of one remote page ${mergeDown} ms; fingerprint scan ${scan.toFixed(1)} ms, three-way merge ${merge.toFixed(1)} ms`
    )
    expect(git(remote, 'show', '--name-only', '--format=', 'main').trim().split('\n')).toEqual([`pages/${ids[20]}.json`])
    expect(firstUpload).toBeLessThan(60_000)
    expect(firstDownload).toBeLessThan(60_000)
    expect(oneEdit).toBeLessThan(20_000)
    expect(scan).toBeLessThan(2000)
    expect(merge).toBeLessThan(5000)
  }, 180_000)
})
