/**
 * Sync against real git, the everyday flows: upload, download, edits both ways, conflicts, files, settings, races.
 * Skipped, with a message, on a computer without git (see ./harness.ts).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SyncEngine } from './engine'
import { bareRemote, commitCount, device, git, pair, plain, PNG, remoteFiles, suite, sync } from './harness'

const CALENDAR = 'https://calendar.google.com/calendar/ical/me%40example.com/private-SECRETTOKEN123/basic.ics'
const PASSPHRASE = 'a passphrase for the test'

suite('sync with real git: flows', () => {
  it('uploads a workspace to an empty repository in the documented layout', async () => {
    const remote = bareRemote()
    const a = device('Desk', 1_000_000)
    const page = a.page('Projects')
    a.text(page.id, 'First line')
    const sub = a.page('Nested', page.id)
    a.text(sub.id, 'Inside the nested page')

    const status = await a.setup(remote)
    expect(status).toMatchObject({ configured: true, state: 'idle', branch: 'main', deviceName: 'Desk', encrypted: false, pending: 0 })
    expect(status.lastSyncAt).toBeGreaterThan(0)
    expect(status.gitVersion).toMatch(/^\d+\.\d+/)

    const files = remoteFiles(remote)
    expect([...files.keys()].sort()).toEqual(['README.md', `pages/${page.id}.json`, `pages/${sub.id}.json`, 'sel.json', 'workspace.json'].sort())
    expect(JSON.parse(files.get('sel.json')!.toString())).toMatchObject({ app: 'sel', format: 1, createdBy: 'Desk' })
    expect(files.get('README.md')!.toString()).toContain('Do not edit these files by hand')
    expect(JSON.parse(files.get('workspace.json')!.toString()).root).toEqual([page.id])
    // One page per file, up to the nested page; one block per line; still one JSON document.
    const text = files.get(`pages/${page.id}.json`)!.toString()
    const lines = text.trimEnd().split('\n')
    expect(lines).toHaveLength(4)
    const parsed = JSON.parse(text) as { page: string; blocks: { id: string; type: string }[] }
    expect(parsed.page).toBe(page.id)
    expect(parsed.blocks.map((b) => b.type).sort()).toEqual(['page', 'text'])
    expect(parsed.blocks.map((b) => b.id)).toEqual([...parsed.blocks.map((b) => b.id)].sort())
    expect(text).not.toContain('Inside the nested page')
    expect(git(remote, 'log', '-1', '--format=%an <%ae>|%s', 'main').trim()).toBe('Desk <sel@localhost>|Sync from Desk')
    expect(git(remote, 'log', '-1', '--format=%b', 'main')).toContain('sel-sync: pages=2 removed=0')
    // Nothing of the user's global git configuration was touched, and nothing was forced.
    for (const { args } of a.spawns) {
      if (args.includes('push')) expect(args.some((arg) => arg === '--force' || arg === '-f' || arg.startsWith('+') || arg.includes('force'))).toBe(false)
      expect(args.includes('--global') || args.includes('--system')).toBe(false)
    }
  })

  it('downloads the workspace on a second device: tree, search and root order', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const first = a.page('Alpha')
    a.text(first.id, 'Searchable sentence about otters')
    const second = a.page('Beta')
    a.repo.create({ type: 'to_do', parentId: second.id, props: { title: [['Buy milk']], checked: true } })
    await a.setup(remote)

    const b = device('Device B', 2_000_000)
    const status = await b.setup(remote)
    expect(status.lastError).toBeUndefined()
    expect(b.titles()).toEqual(['Alpha', 'Beta'])
    expect(b.texts(first.id)).toEqual(['Searchable sentence about otters'])
    expect(b.repo.getTree(second.id)[1]).toMatchObject({ type: 'to_do', props: { checked: true } })
    expect(b.repo.search('otters').map((hit) => hit.pageId)).toEqual([first.id])
    // Timestamps are the ones of the device that wrote the blocks.
    expect(b.repo.get(first.id)?.updatedAt).toBe(a.repo.get(first.id)?.updatedAt)
    expect(b.applied).toBe(1)
    expect(status.activity[0]).toMatchObject({ received: 2, sent: 0, from: 'Device A', conflicts: [] })
    // Nothing to upload: the second device made no commit.
    expect(commitCount(remote)).toBe(1)
  })

  it('carries alternating edits back and forth', async () => {
    const { remote, a, b, pageId, blocks } = await pair()
    a.repo.update(blocks[0], { props: { title: [['one, edited on A']] } })
    a.text(pageId, 'four')
    await sync(a, b)
    expect(b.texts(pageId)).toEqual(['one, edited on A', 'two', 'three', 'four'])

    b.repo.update(blocks[1], { props: { title: [['two, edited on B']] } })
    b.repo.delete(blocks[2])
    const added = b.page('Made on B')
    await sync(b, a)
    expect(a.texts(pageId)).toEqual(['one, edited on A', 'two, edited on B', 'four'])
    expect(a.titles()).toEqual(['Shared page', 'Made on B'])
    expect(a.repo.get(added.id)).toMatchObject({ type: 'page' })

    // Moving to the trash and reordering the root travel too.
    a.repo.move(added.id, null, null)
    a.repo.delete(pageId)
    await sync(a, b)
    expect(b.titles()).toEqual(['Made on B'])
    expect(b.repo.listTrash().map((p) => p.id)).toEqual([pageId])
    b.repo.restore(pageId)
    await sync(b, a)
    expect(a.titles().sort()).toEqual(['Made on B', 'Shared page'])
    // A cycle with nothing to do makes no commit.
    const before = commitCount(remote)
    await sync(a, b, a)
    expect(commitCount(remote)).toBe(before)
  })

  it('merges offline edits to different blocks and different keys without conflict', async () => {
    const { a, b, pageId, blocks } = await pair()
    const todo = a.repo.create({ type: 'to_do', parentId: pageId, props: { title: [['task']], checked: false } })
    await sync(a, b)
    // Both offline.
    a.repo.update(blocks[0], { props: { title: [['A changed one']] } })
    a.repo.update(todo.id, { props: { checked: true } })
    b.repo.update(blocks[2], { props: { title: [['B changed three']] } })
    b.repo.update(todo.id, { props: { title: [['task, reworded']] } })
    await sync(a, b, a)
    for (const d of [a, b]) {
      expect(d.texts(pageId)).toEqual(['A changed one', 'two', 'B changed three', 'task, reworded'])
      expect(d.repo.get(todo.id)?.props).toMatchObject({ checked: true, title: [['task, reworded']] })
      expect(d.engine.status().activity.flatMap((entry) => entry.conflicts)).toEqual([])
    }
  })

  it('keeps the losing local state in version history when both devices changed the same block', async () => {
    const { a, b, pageId, blocks } = await pair()
    // B edits first (its clock is ahead, so its edit is the later one), A edits and syncs first.
    b.repo.update(blocks[0], { props: { title: [['B wins']] } })
    a.repo.update(blocks[0], { props: { title: [['A loses']] } })
    a.repo.update(blocks[1], { props: { title: [['A only']] } })
    await sync(a)
    // B: its own block is later, so the remote's version is the one that is not kept.
    const onB = await b.engine.now()
    expect(onB.lastError).toBeUndefined()
    expect(b.texts(pageId)).toEqual(['B wins', 'A only', 'three'])
    expect(onB.activity[0].conflicts).toEqual([{ pageId, title: 'Shared page', blocks: 1 }])
    const keptOnB = b.repo.listVersions(pageId).filter((v) => v.kind === 'sync')
    expect(keptOnB.map((v) => v.label)).toEqual(['From Device A, not kept by sync'])
    const theirs = b.repo.getVersion(keptOnB[0].id)
    expect(theirs.blocks.map((block) => plain(block.props.title))).toContain('A loses')

    // A: receives B's block. Nothing conflicts there any more (it has not changed since), so
    // its old text is replaced like any received edit; the page history still has it.
    await sync(a)
    expect(a.texts(pageId)).toEqual(['B wins', 'A only', 'three'])

    // The other direction: the local edit is the older one and loses.
    a.repo.update(blocks[2], { props: { title: [['A, earlier']] } })
    b.repo.update(blocks[2], { props: { title: [['B, later']] } })
    await sync(b)
    const onA = await a.engine.now()
    expect(a.texts(pageId)).toEqual(['B wins', 'A only', 'B, later'])
    expect(onA.activity[0].conflicts).toEqual([{ pageId, title: 'Shared page', blocks: 1 }])
    const keptOnA = a.repo.listVersions(pageId).filter((v) => v.kind === 'sync')
    expect(keptOnA.map((v) => v.label)).toEqual(['Before sync from Device B'])
    const mine = a.repo.getVersion(keptOnA[0].id)
    expect(mine.blocks.map((block) => plain(block.props.title))).toContain('A, earlier')
    await sync(b, a)
    expect(a.texts(pageId)).toEqual(b.texts(pageId))
  })

  it('announces changed blocks and reset pages to the windows when a merge is applied', async () => {
    const { a, pageId, blocks } = await pair()
    const b = device('Device C', 3_000_000)
    let changes: string[] = []
    let resets: string[] = []
    const engine = new SyncEngine({
      repo: b.repo,
      dir: join(b.dir, 'sync'),
      filesDir: b.filesDir,
      hostName: 'Device C',
      allowLocal: true,
      secrets: { load: () => null, save: () => undefined },
      acceptImage: () => true,
      onApplied: () => {
        changes = b.repo.drainChanges()
        resets = b.repo.drainResets()
      }
    })
    const remote = a.engine.status().remoteUrl as string
    await engine.setup({ remoteUrl: remote })
    expect(changes).toEqual(expect.arrayContaining([pageId, ...blocks]))
    expect(resets).toEqual([pageId])
    a.repo.update(blocks[0], { props: { title: [['changed']] } })
    await sync(a)
    changes = []
    await engine.now()
    expect(changes).toEqual(expect.arrayContaining([blocks[0]]))
    expect(resets).toEqual([pageId])
  })

  it('resolves delete against edit: the edit survives, an untouched block goes', async () => {
    const { a, b, pageId, blocks } = await pair()
    a.repo.delete(blocks[0])
    a.repo.delete(blocks[1])
    b.repo.update(blocks[0], { props: { title: [['one, still needed']] } })
    await sync(a, b, a)
    for (const d of [a, b]) expect(d.texts(pageId)).toEqual(['one, still needed', 'three'])
  })

  it('brings a page back for a block edited on another device after the page was deleted for good', async () => {
    const { a, b, pageId, blocks } = await pair()
    a.repo.delete(pageId)
    a.repo.deleteForever(pageId)
    b.repo.update(blocks[1], { props: { title: [['edited after the delete']] } })
    await sync(a, b, a)
    for (const d of [a, b]) {
      expect(d.titles()).toEqual(['Shared page'])
      expect(d.texts(pageId)).toEqual(['edited after the delete'])
    }
  })

  it('round-trips images referenced by pages', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const name = '0b0f6c2e-1111-4222-8333-444455556666.png'
    writeFileSync(join(a.filesDir, name), PNG)
    const page = a.page('Pictures')
    a.repo.create({ type: 'image', parentId: page.id, props: { url: `sel-file://files/${name}` } })
    // Never uploaded: nothing refers to it.
    writeFileSync(join(a.filesDir, 'unused-picture.png'), PNG)
    await a.setup(remote)
    expect([...remoteFiles(remote).keys()].filter((path) => path.startsWith('files/'))).toEqual([`files/${name}`])

    const b = device('Device B', 2_000_000)
    await b.setup(remote)
    expect(readFileSync(join(b.filesDir, name)).equals(PNG)).toBe(true)
    expect(readdirSync(b.filesDir)).toEqual([name])
  })

  it('does not store a file from the repository that is not an image, or whose name is not one the app writes', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const name = 'aaaaaaaa-1111-4222-8333-444455556666.png'
    writeFileSync(join(a.filesDir, name), Buffer.from('#!/bin/sh\necho not an image, whatever the name says\n'))
    const page = a.page('Odd')
    a.repo.create({ type: 'image', parentId: page.id, props: { url: `sel-file://files/${name}` } })
    a.repo.create({ type: 'image', parentId: page.id, props: { url: 'sel-file://files/../../evil.png' } })
    await a.setup(remote)
    const b = device('Device B', 2_000_000)
    await b.setup(remote)
    expect(readdirSync(b.filesDir)).toEqual([])
    expect(b.texts(page.id)).toHaveLength(2)
  })

  it('round-trips the appearance settings and merges them per token', async () => {
    const { a, b } = await pair()
    a.repo.setSetting('appearance', { version: 1, light: { '--accent': '#ff0000' }, dark: {}, shared: {}, customCss: '', presetId: null })
    a.repo.setSetting('sync.appearanceAt', 5000)
    await sync(a)
    const onB = await b.engine.now()
    expect(b.repo.getSetting('appearance')).toMatchObject({ light: { '--accent': '#ff0000' } })
    expect(onB.activity[0]).toMatchObject({ appearance: true })

    // Different tokens on each device: both stay.
    a.repo.setSetting('appearance', { version: 1, light: { '--accent': '#ff0000', '--radius-m': '2px' }, dark: {}, shared: {}, customCss: '', presetId: null })
    a.repo.setSetting('sync.appearanceAt', 6000)
    b.repo.setSetting('appearance', { version: 1, light: { '--accent': '#ff0000' }, dark: { '--accent': '#00ff00' }, shared: {}, customCss: '.x{}', presetId: null })
    b.repo.setSetting('sync.appearanceAt', 7000)
    await sync(a, b, a)
    const expected = { light: { '--accent': '#ff0000', '--radius-m': '2px' }, dark: { '--accent': '#00ff00' }, customCss: '.x{}' }
    expect(a.repo.getSetting('appearance')).toMatchObject(expected)
    expect(b.repo.getSetting('appearance')).toMatchObject(expected)
    // Window state, tabs, AI and history settings never leave the device.
    a.repo.setSetting('ai.model', 'opus')
    a.repo.setSetting('windowBounds', { x: 1 })
    a.repo.setSetting('history.enabled', false)
    await sync(a, b)
    expect(b.repo.getSetting('ai.model')).toBeNull()
    expect(b.repo.getSetting('windowBounds')).toBeNull()
    expect(b.repo.getSetting('history.enabled')).toBeNull()
  })

  it('carries the home to the other device', async () => {
    const { remote, a, b, pageId } = await pair()
    a.repo.setSetting('home', { kind: 'page', id: pageId })
    a.repo.setSetting('sync.homeAt', 5000)
    await sync(a, b)
    expect(b.repo.getSetting('home')).toEqual({ kind: 'page', id: pageId })
    expect(b.repo.getSetting('sync.homeAt')).toBe(5000)
    expect(JSON.parse(remoteFiles(remote).get('settings/home.json')!.toString())).toEqual({ format: 1, updatedAt: 5000, value: { kind: 'page', id: pageId } })
    // What sel does at start-up is chosen per device: it stays where it was set.
    a.repo.setSetting('shell.startup', 'home')
    await sync(a, b)
    expect(b.repo.getSetting('shell.startup')).toBeNull()
    // Nothing changed since: nothing more to upload.
    const commits = commitCount(remote)
    await sync(a, b)
    expect(commitCount(remote)).toBe(commits)
  })

  it('keeps the later home when both devices chose one', async () => {
    const { a, b, pageId } = await pair()
    a.repo.setSetting('home', { kind: 'page', id: pageId })
    a.repo.setSetting('sync.homeAt', 6000)
    b.repo.setSetting('home', { kind: 'screen', route: '_today' })
    b.repo.setSetting('sync.homeAt', 7000)
    await sync(a, b, a)
    expect(a.repo.getSetting('home')).toEqual({ kind: 'screen', route: '_today' })
    expect(b.repo.getSetting('home')).toEqual({ kind: 'screen', route: '_today' })

    // The other way round: the device that syncs first has the later choice.
    a.repo.setSetting('home', { kind: 'screen', route: '_tasks' })
    a.repo.setSetting('sync.homeAt', 9000)
    b.repo.setSetting('home', { kind: 'screen', route: '_calendar' })
    b.repo.setSetting('sync.homeAt', 8000)
    await sync(b, a, b)
    expect(a.repo.getSetting('home')).toEqual({ kind: 'screen', route: '_tasks' })
    expect(b.repo.getSetting('home')).toEqual({ kind: 'screen', route: '_tasks' })
  })

  it('clears the home on the other device when it is cleared', async () => {
    const { remote, a, b, pageId } = await pair()
    a.repo.setSetting('home', { kind: 'page', id: pageId })
    a.repo.setSetting('sync.homeAt', 5000)
    await sync(a, b)
    expect(b.repo.getSetting('home')).toEqual({ kind: 'page', id: pageId })
    b.repo.setSetting('home', null)
    b.repo.setSetting('sync.homeAt', 6000)
    await sync(b, a)
    expect(a.repo.getSetting('home')).toBeNull()
    expect(JSON.parse(remoteFiles(remote).get('settings/home.json')!.toString())).toMatchObject({ updatedAt: 6000, value: null })
    // And set again from there.
    a.repo.setSetting('home', { kind: 'screen', route: '_notebook' })
    a.repo.setSetting('sync.homeAt', 7000)
    await sync(a, b)
    expect(b.repo.getSetting('home')).toEqual({ kind: 'screen', route: '_notebook' })
  })

  it('carries the home in an encrypted repository, sealed like the rest', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const b = device('Device B', 2_000_000)
    const page = a.page('Start here')
    a.repo.setSetting('home', { kind: 'page', id: page.id })
    a.repo.setSetting('sync.homeAt', 5000)
    expect((await a.setup(remote, { passphrase: PASSPHRASE })).lastError).toBeUndefined()
    expect((await b.setup(remote, { passphrase: PASSPHRASE })).lastError).toBeUndefined()
    expect(b.repo.getSetting('home')).toEqual({ kind: 'page', id: page.id })
    const file = remoteFiles(remote).get('settings/home.json')
    expect(file).toBeDefined()
    expect(file!.toString('latin1')).not.toContain(page.id)
  })

  it('never puts the version history table, local settings or calendars in an unencrypted repository', async () => {
    const { remote, a, b, pageId } = await pair()
    a.repo.saveVersion(pageId, 'A secret label')
    a.repo.setSetting('shell.tabs', [{ id: 'tab-secret' }])
    a.calendars.add({ label: 'Work', url: CALENDAR, color: 'green' })
    a.repo.setSetting('briefing.databases', [pageId])
    a.repo.setSetting('sync.briefingAt', 5_000_000)
    a.text(pageId, 'another line')
    await sync(a, b)
    const files = remoteFiles(remote)
    const everything = [...files.values()].map((bytes) => bytes.toString()).join('\n')
    expect(everything).not.toContain('A secret label')
    expect(everything).not.toContain('tab-secret')
    expect(everything).not.toContain('SECRETTOKEN')
    expect(everything).not.toContain('calendar.google.com')
    expect(everything).toContain('another line')
    expect(files.has('settings/calendars.json')).toBe(false)
    expect(git(remote, 'log', '--all', '-p', '--text')).not.toContain('SECRETTOKEN')
    expect(b.calendars.list()).toEqual([])
    expect(b.repo.getSetting('briefing.databases')).toBeNull()
  })

  it('carries calendars and the task databases between devices of an encrypted repository', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const b = device('Device B', 2_000_000)
    a.page('Shared page')
    const work = a.calendars.add({ label: 'Work', url: CALENDAR, color: 'green' })
    expect((await a.setup(remote, { passphrase: PASSPHRASE })).lastError).toBeUndefined()
    expect((await b.setup(remote, { passphrase: PASSPHRASE })).lastError).toBeUndefined()

    // A adds a calendar, sync: B has it, address and all.
    expect(b.calendars.list()).toEqual([{ id: expect.any(String), label: 'Work', host: 'calendar.google.com', color: 'green', enabled: true }])
    const onB = b.calendars.list()[0].id
    expect(onB).not.toBe(work.id)
    expect(b.calendars.urlOf(onB)).toBe(CALENDAR)
    // Only ever sealed: no file of the repository, and nothing in its history, shows the address.
    const files = remoteFiles(remote)
    expect(files.has('settings/calendars.json')).toBe(true)
    const everything = [...files.values()].map((bytes) => bytes.toString('latin1')).join('\n')
    expect(everything).not.toContain('SECRETTOKEN')
    expect(everything).not.toContain('calendar.google.com')
    expect(git(remote, 'log', '--all', '-p', '--text')).not.toContain('SECRETTOKEN')

    // Edits on both devices merge field by field; each keeps its own id.
    a.calendars.update(work.id, { label: 'Office' })
    b.calendars.update(onB, { color: 'red' })
    await sync(a, b, a)
    expect(a.calendars.get(work.id)).toMatchObject({ label: 'Office', color: 'red' })
    expect(b.calendars.get(onB)).toMatchObject({ label: 'Office', color: 'red' })
    // The same field on both: the later edit (B's clock is ahead).
    a.calendars.update(work.id, { label: 'From A' })
    b.calendars.update(onB, { label: 'From B' })
    await sync(a, b, a)
    expect(a.calendars.get(work.id)?.label).toBe('From B')
    expect(b.calendars.get(onB)?.label).toBe('From B')
    expect(a.forgotten).toEqual([])

    // A removal propagates, and the reader forgets what it had read from that calendar.
    const home = b.calendars.add({ label: 'Home', url: 'https://p01-caldav.icloud.com/published/2/home-SECRETTOKEN', color: 'blue' })
    await sync(b, a)
    expect(a.calendars.list().map((entry) => entry.label)).toEqual(['From B', 'Home'])
    const homeOnA = a.calendars.list()[1].id
    a.calendars.remove(homeOnA)
    await sync(a, b)
    expect(b.calendars.list().map((entry) => entry.label)).toEqual(['From B'])
    expect(b.forgotten).toEqual([home.id])
    expect(b.calendars.get(home.id)).toBeNull()

    // Which databases feed Today goes along.
    const tasks = a.page('Tasks')
    a.repo.setSetting('briefing.databases', [tasks.id])
    a.repo.setSetting('sync.briefingAt', 5_000_000)
    await sync(a, b)
    expect(b.repo.getSetting('briefing.databases')).toEqual([tasks.id])

    // Nothing changed: nothing more to upload.
    const commits = commitCount(remote)
    await sync(a, b)
    expect(commitCount(remote)).toBe(commits)
  })

  it('syncs without the calendars on a device that has no key store for them', async () => {
    const remote = bareRemote()
    const a = device('Device A', 1_000_000)
    const b = device('Device B', 2_000_000)
    a.calendars.add({ label: 'Work', url: CALENDAR, color: 'green' })
    await a.setup(remote, { passphrase: PASSPHRASE })
    b.keyStore.available = false
    expect((await b.setup(remote, { passphrase: PASSPHRASE })).lastError).toBeUndefined()
    expect(b.calendars.list()).toEqual([])
    b.page('From B')
    await sync(b, a)
    // B's missing calendars removed nothing.
    expect(a.calendars.list().map((entry) => entry.label)).toEqual(['Work'])
    // With a key store, the next sync brings them.
    b.keyStore.available = true
    await sync(b)
    expect(b.calendars.list().map((entry) => entry.label)).toEqual(['Work'])
  })

  it('writes the calendars when encryption is turned on, and removes them when it is turned off', async () => {
    const { remote, a, b } = await pair()
    a.calendars.add({ label: 'Work', url: CALENDAR, color: 'green' })
    await sync(a)
    expect(remoteFiles(remote).has('settings/calendars.json')).toBe(false)

    expect((await a.engine.setEncryption(PASSPHRASE)).lastError).toBeUndefined()
    expect(remoteFiles(remote).has('settings/calendars.json')).toBe(true)
    expect((await b.engine.unlock(PASSPHRASE)).lastError).toBeUndefined()
    expect(b.calendars.list().map((entry) => entry.label)).toEqual(['Work'])

    expect((await a.engine.setEncryption(null)).lastError).toBeUndefined()
    const files = remoteFiles(remote)
    expect(files.has('settings/calendars.json')).toBe(false)
    expect([...files.values()].map((bytes) => bytes.toString('latin1')).join('\n')).not.toContain('SECRETTOKEN')
    // A change made afterwards stays on the device; what each device has is kept.
    a.calendars.add({ label: 'Home', url: 'https://p01-caldav.icloud.com/published/2/home-SECRETTOKEN', color: 'blue' })
    await sync(b, a, b)
    expect(remoteFiles(remote).has('settings/calendars.json')).toBe(false)
    expect(b.calendars.list().map((entry) => entry.label)).toEqual(['Work'])
    expect(a.calendars.list().map((entry) => entry.label)).toEqual(['Work', 'Home'])
  })

  it('starts over when another device pushes between the fetch and the push', async () => {
    const { remote, a, b, pageId, blocks } = await pair()
    a.repo.update(blocks[0], { props: { title: [['from A']] } })
    b.repo.update(blocks[1], { props: { title: [['from B']] } })
    let raced = 0
    a.hook = async (step) => {
      if (step !== 'push' || raced++) return
      // B gets its commit in first: A's push is no longer a fast-forward.
      await sync(b)
    }
    await sync(a)
    expect(raced).toBeGreaterThan(1)
    a.hook = null
    expect(a.texts(pageId)).toEqual(['from A', 'from B', 'three'])
    await sync(b)
    expect(b.texts(pageId)).toEqual(['from A', 'from B', 'three'])
    // No push was ever forced: the history is linear and contains both devices' commits.
    const authors = git(remote, 'log', '--format=%an', 'main').trim().split('\n')
    expect(authors).toEqual(expect.arrayContaining(['Device A', 'Device B']))
    expect(git(remote, 'rev-list', '--merges', '--count', 'main').trim()).toBe('0')
  })
})
