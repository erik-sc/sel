/**
 * Sync against real git, what goes wrong: interrupted cycles, broken clones, foreign repositories, first-sync choices.
 * Skipped, with a message, on a computer without git (see ./harness.ts).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openTestRepository } from '../db/testing'
import { SyncEngine, type SyncStep } from './engine'
import { bareRemote, commitCount, device, git, pair, plain, PNG, remoteFiles, ROOT, suite, sync, unique } from './harness'

suite('sync with real git: recovery', () => {
  it('gives up for now when other devices keep winning the race', async () => {
    const { a, b, pageId, blocks } = await pair()
    a.repo.update(blocks[0], { props: { title: [['from A']] } })
    let n = 0
    a.hook = async (step) => {
      if (step !== 'push') return
      b.text(pageId, `racing ${++n}`)
      await sync(b)
    }
    const status = await a.engine.now()
    expect(status).toMatchObject({ state: 'error', lastError: { code: 'conflict-retry-exhausted' } })
    expect(n).toBe(5)
    a.hook = null
    await sync(a, b)
    expect(a.texts(pageId)).toEqual(b.texts(pageId))
    expect(a.texts(pageId)).toHaveLength(8)
  })

  it('recovers from a cycle interrupted at every step', async () => {
    const { remote, a, b, pageId, blocks } = await pair()
    const steps: SyncStep[] = ['fetch', 'apply', 'write', 'commit', 'push', 'record']
    let round = 0
    for (const at of steps) {
      round++
      // Something to download and something to upload in every round.
      b.repo.update(blocks[1], { props: { title: [[`b round ${round}`]] } })
      await sync(b)
      a.repo.update(blocks[0], { props: { title: [[`a round ${round}`]] } })
      let crashed = false
      a.hook = (step) => {
        if (step === at && !crashed) {
          crashed = true
          throw new Error(`simulated crash before ${at}`)
        }
      }
      const failed = await a.engine.now()
      expect(crashed, at).toBe(true)
      expect(failed.lastError?.code, at).toBe('failed')
      // The database is consistent whatever happened: either nothing or the whole merge.
      expect(a.texts(pageId)[0], at).toBe(`a round ${round}`)
      a.hook = null
      await sync(a, b)
      expect(a.texts(pageId), at).toEqual([`a round ${round}`, `b round ${round}`, 'three'])
      expect(b.texts(pageId), at).toEqual(a.texts(pageId))
    }
    // An interrupted cycle never reports a conflict twice or invents one.
    expect(a.engine.status().activity.flatMap((entry) => entry.conflicts)).toEqual([])
    expect(git(remote, 'fsck', '--no-dangling').trim()).toBe('')
  })

  it('repairs its clone: stale locks, a dirty tree, a detached head, a half-finished merge', async () => {
    const { a, b, pageId, blocks } = await pair()
    const clone = join(a.dir, 'sync', 'repo')
    git(clone, 'checkout', '-q', '--detach')
    writeFileSync(join(clone, '.git', 'index.lock'), '')
    writeFileSync(join(clone, '.git', 'HEAD.lock'), '')
    mkdirSync(join(clone, '.git', 'refs', 'heads'), { recursive: true })
    writeFileSync(join(clone, '.git', 'refs', 'heads', 'main.lock'), '')
    writeFileSync(join(clone, '.git', 'MERGE_HEAD'), `${git(clone, 'rev-parse', 'HEAD').trim()}\n`)
    writeFileSync(join(clone, 'stray-file.txt'), 'left over')
    writeFileSync(join(clone, 'pages', `${pageId}.json`), 'garbage that is not a page')
    rmSync(join(clone, 'workspace.json'))
    a.repo.update(blocks[0], { props: { title: [['after the mess']] } })
    await sync(a, b)
    expect(b.texts(pageId)[0]).toBe('after the mess')
    expect(existsSync(join(clone, 'stray-file.txt'))).toBe(false)
    expect(existsSync(join(clone, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(git(clone, 'status', '--porcelain').trim()).toBe('')
    expect(git(clone, 'symbolic-ref', 'HEAD').trim()).toBe('refs/heads/main')
  })

  it('makes a fresh clone when the old one is unusable, and merges again from the saved base', async () => {
    const { a, b, pageId, blocks } = await pair()
    const clone = join(a.dir, 'sync', 'repo')
    // Both sides have work the other does not know.
    a.repo.update(blocks[0], { props: { title: [['kept from A']] } })
    b.repo.update(blocks[2], { props: { title: [['kept from B']] } })
    b.repo.delete(blocks[1])
    await sync(b)
    for (const variant of ['objects', 'head', 'gone'] as const) {
      if (variant === 'objects') rmSync(join(clone, '.git', 'objects'), { recursive: true, force: true })
      if (variant === 'head') writeFileSync(join(clone, '.git', 'HEAD'), 'this is not a head\n')
      if (variant === 'gone') rmSync(clone, { recursive: true, force: true })
      a.text(pageId, `added after ${variant}`)
      await sync(a)
    }
    await sync(b)
    const expected = ['kept from A', 'kept from B', 'added after objects', 'added after head', 'added after gone']
    expect(a.texts(pageId)).toEqual(expected)
    expect(b.texts(pageId)).toEqual(expected)
  })

  it('never touches a repository that happens to hold its folder, even when its own clone is broken', async () => {
    // The profile sits inside somebody's working copy, with uncommitted work in it.
    const outer = unique('outer')
    mkdirSync(outer)
    git(outer, 'init', '-q', '-b', 'trunk')
    writeFileSync(join(outer, 'tracked.txt'), 'committed\n')
    git(outer, 'add', '-A')
    git(outer, '-c', 'user.name=Owner', '-c', 'user.email=owner@example.com', 'commit', '-q', '-m', 'theirs')
    writeFileSync(join(outer, 'tracked.txt'), 'edited and not committed\n')
    writeFileSync(join(outer, 'untracked.txt'), 'precious\n')
    const outerHead = git(outer, 'rev-parse', 'HEAD').trim()

    const remote = bareRemote()
    const repo = openTestRepository()
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Inside']] } })
    const seen: Readonly<Record<string, string>>[] = []
    const engine = new SyncEngine({
      repo,
      dir: join(outer, 'profile', 'sync'),
      filesDir: join(outer, 'profile', 'files'),
      hostName: 'Nested',
      allowLocal: true,
      secrets: { load: () => null, save: () => undefined },
      acceptImage: () => true,
      onSpawn: (_args, env) => seen.push(env)
    })
    expect((await engine.setup({ remoteUrl: remote })).lastError).toBeUndefined()
    const clone = join(outer, 'profile', 'sync', 'repo')
    for (const variant of ['head', 'objects', 'config', 'all'] as const) {
      if (variant === 'head') writeFileSync(join(clone, '.git', 'HEAD'), 'garbage\n')
      if (variant === 'objects') rmSync(join(clone, '.git', 'objects'), { recursive: true, force: true })
      if (variant === 'config') writeFileSync(join(clone, '.git', 'config'), '[core\nbroken')
      if (variant === 'all') rmSync(join(clone, '.git'), { recursive: true, force: true })
      repo.create({ type: 'text', parentId: page.id, props: { title: [[`after ${variant}`]] } })
      const status = await engine.now()
      expect(status.lastError, `${variant}: ${status.lastError?.message}`).toBeUndefined()
      // The enclosing repository is exactly as it was: same commit, same branch, same uncommitted work, no new remote.
      expect(git(outer, 'rev-parse', 'HEAD').trim(), variant).toBe(outerHead)
      expect(git(outer, 'symbolic-ref', 'HEAD').trim(), variant).toBe('refs/heads/trunk')
      expect(readFileSync(join(outer, 'tracked.txt'), 'utf8'), variant).toBe('edited and not committed\n')
      expect(readFileSync(join(outer, 'untracked.txt'), 'utf8'), variant).toBe('precious\n')
      expect(git(outer, 'remote').trim(), variant).toBe('')
      expect(git(outer, 'branch', '--format=%(refname:short)').trim(), variant).toBe('trunk')
    }
    expect(remoteFiles(remote).get(`pages/${page.id}.json`)!.toString()).toContain('after all')
    // Every git that ran was pinned to the clone.
    expect(seen.length).toBeGreaterThan(10)
    for (const env of seen) {
      expect(env['GIT_DIR']).toBe(join(clone, '.git'))
      expect(env['GIT_WORK_TREE']).toBe(clone)
      expect(env['GIT_CEILING_DIRECTORIES']).toBe(join(outer, 'profile', 'sync'))
    }
  })

  it('refuses a repository that has files and no sel data, unless told to use it anyway', async () => {
    const remote = bareRemote()
    const work = unique('work')
    mkdirSync(work)
    git(work, 'init', '-q', '-b', 'main')
    writeFileSync(join(work, 'README.md'), '# Someone else\'s project\n')
    mkdirSync(join(work, 'src'))
    writeFileSync(join(work, 'src', 'main.c'), 'int main(void) { return 0; }\n')
    git(work, 'add', '-A')
    git(work, '-c', 'user.name=Other', '-c', 'user.email=other@example.com', 'commit', '-q', '-m', 'initial')
    git(work, 'push', '-q', remote, 'main')

    const a = device('Device A', 1_000_000)
    const page = a.page('Mine')
    const refused = await a.setup(remote)
    expect(refused).toMatchObject({ configured: false, state: 'needs-setup', lastError: { code: 'not-sel-repo' } })
    expect(a.repo.getSetting('sync.remoteUrl')).toBeNull()
    expect(existsSync(join(a.dir, 'sync', 'repo'))).toBe(false)
    expect(commitCount(remote)).toBe(1)

    const accepted = await a.setup(remote, { useAnyway: true })
    expect(accepted.lastError).toBeUndefined()
    const files = remoteFiles(remote)
    // Their files are all still there, untouched; sel's are next to them.
    expect(files.get('README.md')!.toString()).toBe('# Someone else\'s project\n')
    expect(files.get('src/main.c')!.toString()).toContain('int main')
    expect(files.has('SEL.md')).toBe(true)
    expect(files.has(`pages/${page.id}.json`)).toBe(true)
    // And they stay there through later syncs, also from a second device.
    a.repo.delete(page.id)
    a.repo.deleteForever(page.id)
    await sync(a)
    const b = device('Device B', 2_000_000)
    expect((await b.setup(remote, { mode: 'merge' })).lastError).toBeUndefined()
    b.page('From B')
    await sync(b)
    const later = remoteFiles(remote)
    expect(later.has('src/main.c')).toBe(true)
    expect(later.get('README.md')!.toString()).toBe('# Someone else\'s project\n')
    expect(later.has(`pages/${page.id}.json`)).toBe(false)
  })

  it('asks what to do with local pages when the repository already holds a workspace', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    a.page('From A')
    await a.setup(remote)

    const b = device('Device B', 2_000_000)
    const mine = b.page('Was on B')
    b.text(mine.id, 'a line on B')
    const asked = await b.setup(remote)
    expect(asked).toMatchObject({ configured: false, lastError: { code: 'needs-choice' } })
    expect(b.titles()).toEqual(['Was on B'])

    // Merge (the default choice): a union, the ids differ.
    const merged = await b.setup(remote, { mode: 'merge' })
    expect(merged.lastError).toBeUndefined()
    expect(b.titles().sort()).toEqual(['From A', 'Was on B'])
    await sync(a)
    expect(a.titles().sort()).toEqual(['From A', 'Was on B'])

    // Replace: this device's pages get a saved version and go to the trash; nothing is deleted.
    const c = device('Device C', 3_000_000)
    const old = c.page('Was on C')
    c.text(old.id, 'kept in history')
    const replaced = await c.setup(remote, { mode: 'replace' })
    expect(replaced.lastError).toBeUndefined()
    expect(c.titles().sort()).toEqual(['From A', 'Was on B'])
    expect(c.repo.listTrash().map((p) => p.id)).toEqual([old.id])
    expect(c.repo.listVersions(old.id).map((v) => v.label)).toContain('Before replacing with the synced workspace')
    expect(c.repo.getTree(old.id).map((b) => plain(b.props.title))).toEqual(['Was on C', 'kept in history'])
  })

  it('replaces with the workspace on a device that already has some of its pages', async () => {
    // A device that was connected before (same ids), went its own way, and now chooses Replace.
    const { remote, a, b, pageId, blocks } = await pair()
    await b.engine.disconnect()
    b.repo.update(blocks[0], { props: { title: [['B went its own way']] } })
    const onlyB = b.page('Only on B')
    a.repo.update(blocks[1], { props: { title: [['the workspace moved on']] } })
    await sync(a)
    const status = await b.setup(remote, { mode: 'replace' })
    expect(status.lastError).toBeUndefined()
    // The shared page is the workspace's, and stays where it is; the page only B had is in the trash.
    expect(b.titles()).toEqual(['Shared page'])
    expect(b.texts(pageId)).toEqual(['one', 'the workspace moved on', 'three'])
    expect(b.repo.listTrash().map((p) => p.id)).toEqual([onlyB.id])
    expect(b.repo.listVersions(pageId).map((v) => v.label)).toContain('Before replacing with the synced workspace')
    const kept = b.repo.listVersions(pageId).find((v) => v.label === 'Before replacing with the synced workspace')!
    expect(b.repo.getVersion(kept.id).blocks.map((block) => plain(block.props.title))).toContain('B went its own way')
    expect(b.repo.getSetting('sync.firstMode')).toBeNull()
    await sync(a)
    expect(a.texts(pageId)).toEqual(['one', 'the workspace moved on', 'three'])
    expect(a.titles()).toEqual(['Shared page'])
  })

  it('keeps no key from a setup that was not completed', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    a.page('Secret')
    await a.setup(remote, { passphrase: 'correct horse battery' })
    const b = device('Device B', 2_000_000)
    b.page('Local')
    expect((await b.setup(remote, { passphrase: 'wrong horse battery' })).lastError?.code).toBe('wrong-passphrase')
    expect(b.secrets.value).toBeNull()
    // The passphrase was right and a question follows: the key waits for the answer.
    expect((await b.setup(remote, { passphrase: 'correct horse battery' })).lastError?.code).toBe('needs-choice')
    expect(b.secrets.value).not.toBeNull()
    expect((await b.setup(remote, { mode: 'merge' })).lastError).toBeUndefined()
    expect(b.titles().sort()).toEqual(['Local', 'Secret'])
    await b.engine.disconnect()
    expect(b.secrets.value).toBeNull()
  })

  it('reads a repository written when the app was called Selida, and renames what is in it on the next upload', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const name = '0b0f6c2e-1111-4222-8333-444455556666.png'
    writeFileSync(join(a.filesDir, name), PNG)
    const page = a.page('Pictures')
    const image = a.repo.create({ type: 'image', parentId: page.id, props: { url: `sel-file://files/${name}` } })
    const words = a.page('Words')
    a.text(words.id, 'nothing to rename here')
    await a.setup(remote)

    // The same repository as the earlier app left it.
    const work = unique('work')
    git(ROOT, 'clone', '-q', remote, work)
    const rewrite = (path: string, from: string, to: string): void => writeFileSync(join(work, path), readFileSync(join(work, path), 'utf8').replaceAll(from, to))
    git(work, 'mv', 'sel.json', 'selida.json')
    rewrite('selida.json', '"app": "sel"', '"app": "selida"')
    rewrite('README.md', '<!-- sel:managed -->', '<!-- selida:managed -->')
    rewrite(`pages/${page.id}.json`, 'sel-file://', 'selida-file://')
    git(work, 'add', '-A')
    git(work, '-c', 'user.name=Device A', '-c', 'user.email=selida@localhost', 'commit', '-q', '-m', 'Sync from Device A')
    git(work, 'push', '-q', 'origin', 'main')
    expect(remoteFiles(remote).get(`pages/${page.id}.json`)!.toString()).toContain(`selida-file://files/${name}`)
    expect(remoteFiles(remote).get('selida.json')!.toString()).toContain('"app": "selida"')

    // A second device joins it as it is: the page and its image arrive under today's address.
    const b = device('Device B', 2_000_000)
    expect((await b.setup(remote)).lastError).toBeUndefined()
    expect(b.titles().sort()).toEqual(['Pictures', 'Words'])
    expect(b.repo.get(image.id)?.props.url).toBe(`sel-file://files/${name}`)
    expect(readFileSync(join(b.filesDir, name)).equals(PNG)).toBe(true)

    // Whoever uploads next brings the repository over, and no file is lost on the way.
    await sync(a, b)
    const files = remoteFiles(remote)
    expect([...files.keys()].sort()).toEqual(['README.md', `files/${name}`, `pages/${page.id}.json`, `pages/${words.id}.json`, 'sel.json', 'workspace.json'].sort())
    expect(JSON.parse(files.get('sel.json')!.toString())).toMatchObject({ app: 'sel', format: 1 })
    expect(files.get('README.md')!.toString()).toContain('<!-- sel:managed -->')
    expect(files.get(`pages/${page.id}.json`)!.toString()).toContain(`sel-file://files/${name}`)
    expect(files.get(`pages/${page.id}.json`)!.toString()).not.toContain('selida')
    expect(a.repo.get(image.id)?.props.url).toBe(`sel-file://files/${name}`)

    // Both devices carry on from there.
    a.text(words.id, 'written after the rename')
    await sync(a, b)
    expect(b.texts(words.id)).toEqual(['nothing to rename here', 'written after the rename'])
    expect(a.titles().sort()).toEqual(['Pictures', 'Words'])
  })
})
