import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, ChangeEvent } from '../../shared/types'
import { ChangeFeed } from '../changes'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import * as markdown from '../markdown'
import { ToolHost } from '../ai/toolhost'
import { ToolError } from '../ai/tools'
import { EXTERNAL_TOOL_SPECS, TOOL_NAMES, WRITE_TOOL_NAMES } from '../ai/toolspecs'
import { callWriteTool } from '../ai/writes'
import { ExternalEndpoint, pipeName, type EndpointOptions } from './endpoint'
import { DISCOVERY_FILE, EXTERNAL_MESSAGES, defaultDiscoveryPath, parseDiscovery } from './protocol'
import { createEndpoint } from './service'
import { connectSnippets } from './snippets'

const NOW = Date.UTC(2026, 9, 15, 12)

function tasksDatabase(repo: Repository, props: Record<string, unknown> = {}): Block {
  return repo.create({
    type: 'database',
    parentId: null,
    props: {
      title: [['Tasks']],
      schema: {
        title: { id: 'title', name: 'Name', type: 'title' },
        s: { id: 's', name: 'Status', type: 'select', options: [{ id: 'o1', name: 'Doing', color: 'blue' }, { id: 'o2', name: 'Done', color: 'green' }] },
        t: { id: 't', name: 'Tags', type: 'multi_select', options: [{ id: 'g1', name: 'home', color: 'gray' }, { id: 'g2', name: 'work', color: 'red' }] },
        d: { id: 'd', name: 'Due', type: 'date' },
        c: { id: 'c', name: 'Done', type: 'checkbox' },
        n: { id: 'n', name: 'Points', type: 'number' },
        x: { id: 'x', name: 'Edited', type: 'last_edited_time' }
      },
      ...props
    }
  })
}

const write = (repo: Repository, name: string, args: unknown): string => callWriteTool({ repo, markdown }, name, args)

describe('the writing tools', () => {
  let repo: Repository
  let clock = NOW
  beforeEach(() => {
    clock = NOW
    repo = openTestRepository(':memory:', { clock: () => clock })
  })

  it('create a page from Markdown, at the top or inside a page', () => {
    const made = write(repo, 'create_page', { markdown: '# Trip\n\nPack the **bags**.\n\n- [ ] passport' })
    const id = /\[([^\]]+)\]/.exec(made)?.[1] ?? ''
    expect(made).toMatch(/^Created Trip \[.+\], in the top level\.$/)
    const page = repo.get(id)!
    expect(page.parentId).toBeNull()
    expect(repo.children(id).map((b) => b.type)).toEqual(['text', 'to_do'])

    // An explicit title wins, and a leading heading of the text stays a heading.
    const inside = write(repo, 'create_page', { title: 'Packing', markdown: '# List\n\nsocks', parent: id })
    const child = repo.get(/\[([^\]]+)\]/.exec(inside)![1])!
    expect(child.parentId).toBe(id)
    expect(child.props.title).toEqual([['Packing']])
    expect(repo.children(child.id).map((b) => b.type)).toEqual(['heading_1', 'text'])
    expect(inside).toContain('in Trip')

    expect(() => write(repo, 'create_page', { parent: 'nope-0000' })).toThrow(ToolError)
    const db = tasksDatabase(repo)
    expect(() => write(repo, 'create_page', { parent: db.id })).toThrow(/is a database: add a row to it with add_database_row/)
  })

  it('append to the end of a page, leaving what is there, and keep its earlier state in the history', () => {
    const page = markdown.importMarkdownText(repo, 'First line', null, 'Diary')
    clock += 60 * 60_000
    expect(repo.listVersions(page.id)).toHaveLength(0)
    const said = write(repo, 'append_to_page', { id: page.id, markdown: '# Later\n\nSecond line\n\n- one\n- two' })
    expect(said).toBe(`Added 4 blocks to the end of Diary [${page.id}].`)
    const texts = repo.children(page.id).map((b) => `${b.type}:${(b.props.title as string[][])?.[0]?.[0] ?? ''}`)
    expect(texts).toEqual(['text:First line', 'heading_1:Later', 'text:Second line', 'bulleted_list:one', 'bulleted_list:two'])
    // The page as it was before the app wrote to it can be brought back.
    const versions = repo.listVersions(page.id)
    expect(versions).toHaveLength(1)
    expect(versions[0].kind).toBe('auto')
    expect(repo.getVersion(versions[0].id).blocks.length).toBeLessThan(repo.getTree(page.id).length)

    expect(() => write(repo, 'append_to_page', { id: page.id, markdown: '   ' })).toThrow('That Markdown holds nothing to add.')
    expect(() => write(repo, 'append_to_page', { id: page.id })).toThrow('Give the Markdown to add.')
    expect(() => write(repo, 'append_to_page', { id: 'nope-0000', markdown: 'x' })).toThrow('No page has that id.')
  })

  it('add a row with values by property name, checked against the schema', () => {
    const db = tasksDatabase(repo)
    const said = write(repo, 'add_database_row', {
      database: db.id,
      values: { Name: 'Write the brief', Status: 'doing', Tags: ['home', 'work'], Due: '2026-10-20T09:30', done: 'yes', Points: '3' }
    })
    const row = repo.get(/row Write the brief \[([^\]]+)\]/.exec(said)![1])!
    expect(row.parentId).toBe(db.id)
    expect(row.props.title).toEqual([['Write the brief']])
    expect(row.props.values).toEqual({ s: 'o1', t: ['g1', 'g2'], d: { start: '2026-10-20T09:30' }, c: true, n: 3 })

    const refuse = (values: unknown): string => {
      try {
        write(repo, 'add_database_row', { database: db.id, values })
      } catch (err) {
        expect(err).toBeInstanceOf(ToolError)
        return (err as Error).message
      }
      throw new Error('accepted')
    }
    expect(refuse({ Owner: 'me' })).toBe('Tasks has no property “Owner”. Its properties: “Name”, “Status”, “Tags”, “Due”, “Done”, “Points”.')
    expect(refuse({ Status: 'Later' })).toBe('Status has no option “Later”. Its options: “Doing”, “Done”.')
    expect(refuse({ Due: 'next friday' })).toMatch(/^Due: a date is "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"/)
    expect(refuse({ Due: '2026-02-30' })).toMatch(/^Due: a date/)
    expect(refuse({ Points: 'many' })).toBe('Points: give a number.')
    expect(refuse({ Edited: 1 })).toBe('Edited is computed: it cannot be set.')
    expect(refuse([])).toBe('Give the values as an object of property names.')
    expect(repo.children(db.id)).toHaveLength(1)
    // A linked view adds to the database it shows.
    const view = repo.create({ type: 'database', parentId: null, props: { title: [['Mine']], sourceId: db.id } })
    write(repo, 'add_database_row', { database: view.id, values: { Name: 'Through the view', Due: { start: '2026-10-21', end: '2026-10-23' } } })
    expect(repo.children(db.id).map((r) => r.props.values?.['d'])).toEqual([{ start: '2026-10-20T09:30' }, { start: '2026-10-21', end: '2026-10-23' }])
  })

  it('update a row: the values named change, null clears, the rest stays', () => {
    const db = tasksDatabase(repo)
    const row = repo.create({ type: 'page', parentId: db.id, props: { title: [['Book a room']], values: { s: 'o1', c: false, n: 2 } } })
    clock += 60 * 60_000
    const said = write(repo, 'update_database_row', { id: row.id, values: { Status: 'Done', Due: '2026-11-01', Points: null, Name: 'Book the room' } })
    expect(said).toBe(`Updated Book the room [${row.id}] in Tasks [${db.id}] (database): Status, Due, Points, Name.`)
    expect(repo.get(row.id)!.props.values).toEqual({ s: 'o2', c: false, d: { start: '2026-11-01' } })
    // A row's values belong to the history of its database.
    expect(repo.listVersions(db.id).length).toBeGreaterThan(0)
    expect(() => write(repo, 'update_database_row', { id: row.id, values: {} })).toThrow('Give at least one value to set.')
    expect(() => write(repo, 'update_database_row', { id: db.id, values: { Name: 'x' } })).toThrow('No row of a database has that id.')
  })

  it('refuse to write into a built-in database with a message that can be read', () => {
    const builtin = tasksDatabase(repo, { system: 'tasks' })
    expect(builtin.props.system).toBe('tasks')
    expect(() => write(repo, 'append_to_page', { id: builtin.id, markdown: 'hello' })).toThrow(`Tasks [${builtin.id}] (database) is a database: add a row to it with add_database_row.`)
    expect(() => write(repo, 'create_page', { parent: builtin.id })).toThrow(/is a database/)
    expect(() => write(repo, 'update_database_row', { id: builtin.id, values: { Name: 'Renamed' } })).toThrow('No row of a database has that id.')
    // Rows of it come and go as in any database.
    expect(write(repo, 'add_database_row', { database: builtin.id, values: { Name: 'Buy milk' } })).toContain('Buy milk')
    expect(repo.get(builtin.id)!.props.system).toBe('tasks')
  })
})

// ---- the endpoint ---------------------------------------------------------------

function tokenStore(): { loadToken: () => string | null; saveToken: (token: string) => void; saved: string[] } {
  const saved: string[] = []
  return { loadToken: () => saved.at(-1) ?? null, saveToken: (token) => void saved.push(token), saved }
}

describe('the endpoint for other apps', () => {
  const dirs: string[] = []
  const endpoints: ExternalEndpoint[] = []
  const make = (options: Partial<EndpointOptions> = {}): { endpoint: ExternalEndpoint; dir: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'sel-mcp-'))
    dirs.push(dir)
    const endpoint = new ExternalEndpoint({ userData: dir, ...tokenStore(), run: () => 'ok', changed: () => undefined, ...options })
    endpoints.push(endpoint)
    return { endpoint, dir }
  }
  const discovery = (dir: string): { pipe: string; token: string } => parseDiscovery(readFileSync(join(dir, DISCOVERY_FILE), 'utf8'))!
  afterEach(async () => {
    for (const endpoint of endpoints.splice(0)) await endpoint.stop(false)
  })
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('writes where it listens and its token, refuses any other token, and forgets both when turned off', async () => {
    const { endpoint, dir } = make()
    await endpoint.start()
    const found = discovery(dir)
    expect(found.pipe).toBe(pipeName(dir, found.token))
    if (process.platform !== 'win32') expect(statSync(join(dir, DISCOVERY_FILE)).mode & 0o777).toBe(0o600)
    expect(endpoint.answer(JSON.stringify({ token: found.token, id: 1, name: 'search', args: { query: 'x' } }))).toEqual({ id: 1, text: 'ok' })
    expect(endpoint.answer(JSON.stringify({ token: 'f'.repeat(48), id: 2, name: 'search' }))).toEqual({ id: 2, error: EXTERNAL_MESSAGES.refused })
    expect(endpoint.answer(JSON.stringify({ id: 3, name: 'search' }))).toEqual({ id: 3, error: EXTERNAL_MESSAGES.refused })
    expect(endpoint.answer('{oops')).toEqual({ id: null, error: 'Not understood.' })
    await endpoint.stop(false)
    expect(existsSync(join(dir, DISCOVERY_FILE))).toBe(true)
    // Closed, the endpoint answers nothing, even with the right token.
    expect(endpoint.answer(JSON.stringify({ token: found.token, id: 4, name: 'search' }))).toEqual({ id: 4, error: EXTERNAL_MESSAGES.refused })
    await endpoint.start()
    expect(discovery(dir).token).toBe(found.token)
    await endpoint.stop(true)
    expect(existsSync(join(dir, DISCOVERY_FILE))).toBe(false)
  })

  it('keeps its token across runs, and a new token shuts the old one out', async () => {
    const store = tokenStore()
    const first = make(store)
    await first.endpoint.start()
    const old = discovery(first.dir)
    await first.endpoint.stop(false)
    // The next run of the app: same profile, same token, same pipe.
    const again = new ExternalEndpoint({ userData: first.dir, ...store, run: () => 'ok', changed: () => undefined })
    endpoints.push(again)
    await again.start()
    expect(discovery(first.dir)).toEqual(old)
    await again.rotate()
    const fresh = discovery(first.dir)
    expect(fresh.token).not.toBe(old.token)
    expect(fresh.pipe).not.toBe(old.pipe)
    expect(store.saved.at(-1)).toBe(fresh.token)
    expect(again.answer(JSON.stringify({ token: old.token, id: 1, name: 'search' }))).toEqual({ id: 1, error: EXTERNAL_MESSAGES.refused })
    expect(again.answer(JSON.stringify({ token: fresh.token, id: 2, name: 'search' }))).toEqual({ id: 2, text: 'ok' })
  })

  it('limits calls per minute and the size of arguments, and lists which tool was called when, never what', async () => {
    let now = NOW
    const { endpoint, dir } = make({ limits: { perMinute: 3, argsChars: 100 }, now: () => now })
    await endpoint.start()
    const { token } = discovery(dir)
    const call = (id: number, name: string, args: unknown = {}): { error?: string; text?: string } => endpoint.answer(JSON.stringify({ token, id, name, args }))
    expect(call(1, 'read_page', { id: 'secret-page' }).text).toBe('ok')
    expect(call(2, 'search', { query: 'x'.repeat(200) }).error).toBe('That call is too large for sel (at most 0 KB of arguments).')
    expect(call(3, 'nonsense').text).toBe('ok')
    expect(call(4, 'search').error).toMatch(/^Too many calls: sel answers at most 3 a minute\./)
    now += 61_000
    expect(call(5, 'create_page').text).toBe('ok')
    expect(endpoint.calls.map((entry) => [entry.tool, entry.ok])).toEqual([
      ['create_page', true],
      ['search', false],
      ['unknown', true],
      ['search', false],
      ['read_page', true]
    ])
    expect(JSON.stringify(endpoint.calls)).not.toContain('secret')
  })

  it('says what the repository refused, but nothing of what the system said', async () => {
    const errors = [new ToolError('No page has that id.'), new Error('A built-in database cannot be moved'), Object.assign(new Error('SQLITE_BUSY: C:\\Users\\me\\sel.db'), { code: 'SQLITE_BUSY' })]
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { endpoint, dir } = make({
      run: () => {
        throw errors.shift()
      }
    })
    await endpoint.start()
    const { token } = discovery(dir)
    const call = (id: number): unknown => endpoint.answer(JSON.stringify({ token, id, name: 'append_to_page', args: {} }))
    expect(call(1)).toEqual({ id: 1, error: 'No page has that id.' })
    expect(call(2)).toEqual({ id: 2, error: 'A built-in database cannot be moved' })
    expect(call(3)).toEqual({ id: 3, error: 'That could not be done.' })
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('writes through the repository and tells the windows and sync what changed', async () => {
    const repo = openTestRepository()
    const delivered: ChangeEvent[] = []
    const feed = new ChangeFeed((change) => delivered.push(change), (flush) => flush())
    let synced = 0
    const dir = mkdtempSync(join(tmpdir(), 'sel-mcp-'))
    dirs.push(dir)
    // As ipc.ts wires it.
    const endpoint = await createEndpoint(repo, {
      userData: dir,
      ...tokenStore(),
      changed: () => {
        const ids = repo.drainChanges()
        feed.add('mcp', ids, repo.drainResets())
        if (ids.length) synced++
      }
    })
    endpoints.push(endpoint)
    await endpoint.start()
    const { token } = discovery(dir)
    const reply = endpoint.answer(JSON.stringify({ token, id: 1, name: 'create_page', args: { title: 'From Claude', markdown: 'Hello' } }))
    const id = /\[([^\]]+)\]/.exec(reply.text ?? '')![1]
    expect(repo.get(id)?.props.title).toEqual([['From Claude']])
    expect(delivered).toHaveLength(1)
    expect(delivered[0].origin).toBe('mcp')
    expect(delivered[0].ids).toContain(id)
    expect(synced).toBe(1)
    // Reading changes nothing, and tells nobody.
    expect(endpoint.answer(JSON.stringify({ token, id: 2, name: 'read_page', args: { id } })).text).toContain('Hello')
    expect(delivered).toHaveLength(1)
    expect(synced).toBe(1)
  })
})

describe('the discovery file and the setup snippets', () => {
  it('accept only what sel writes', () => {
    const token = 'a'.repeat(48)
    expect(parseDiscovery(JSON.stringify({ version: 1, pipe: '\\\\.\\pipe\\x', token }))).toEqual({ version: 1, pipe: '\\\\.\\pipe\\x', token })
    for (const bad of ['', 'null', '[]', JSON.stringify({ version: 2, pipe: 'p', token }), JSON.stringify({ version: 1, pipe: '', token }), JSON.stringify({ version: 1, pipe: 'p', token: 'short' })]) {
      expect(parseDiscovery(bad)).toBeNull()
    }
  })

  it('are found in the profile folder of an installed sel', () => {
    expect(defaultDiscoveryPath('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me')).toBe(join('C:\\Users\\me\\AppData\\Roaming', 'sel', 'mcp.json'))
    expect(defaultDiscoveryPath('darwin', {}, '/Users/me')).toBe(join('/Users/me', 'Library', 'Application Support', 'sel', 'mcp.json'))
    expect(defaultDiscoveryPath('linux', {}, '/home/me')).toBe(join('/home/me', '.config', 'sel', 'mcp.json'))
  })

  it('name this install’s executable, run as Node, with the script and the discovery file', () => {
    const { claudeCode, claudeDesktop } = connectSnippets('C:\\Program Files\\sel\\sel.exe', 'C:\\Program Files\\sel\\resources\\app.asar\\out\\main\\mcp.js', 'C:\\Users\\me\\AppData\\Roaming\\sel\\mcp.json')
    expect(claudeCode).toBe(
      'claude mcp add --scope user --env ELECTRON_RUN_AS_NODE=1 sel -- "C:\\Program Files\\sel\\sel.exe" "C:\\Program Files\\sel\\resources\\app.asar\\out\\main\\mcp.js" --discovery "C:\\Users\\me\\AppData\\Roaming\\sel\\mcp.json"'
    )
    expect(JSON.parse(claudeDesktop)).toEqual({
      mcpServers: {
        sel: {
          command: 'C:\\Program Files\\sel\\sel.exe',
          args: ['C:\\Program Files\\sel\\resources\\app.asar\\out\\main\\mcp.js', '--discovery', 'C:\\Users\\me\\AppData\\Roaming\\sel\\mcp.json'],
          env: { ELECTRON_RUN_AS_NODE: '1' }
        }
      }
    })
  })
})

// ---- the server script, end to end ----------------------------------------------

describe('the server script for other apps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sel-mcp-script-'))
  const script = join(dir, 'mcp.js')
  const children: ChildProcessWithoutNullStreams[] = []

  beforeAll(async () => {
    // The script as built: esbuild (a dependency of the build) bundles it as the app's build does.
    const { build } = await import('esbuild')
    await build({ entryPoints: [join(__dirname, '..', 'mcp.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: script, logLevel: 'silent' })
  }, 30_000)

  afterAll(async () => {
    for (const child of children) {
      child.stdin.end()
      if (child.exitCode === null) await new Promise((resolve) => child.once('close', resolve))
    }
    rmSync(dir, { recursive: true, force: true })
  })

  /** Starts the script as an MCP client would: no grant in the environment, the discovery file on the command line. */
  function client(discoveryPath: string, env: Record<string, string> = {}): { send: (message: unknown) => void; reply: (id: number) => Promise<Record<string, unknown>> } {
    const clean = { ...process.env, ...env }
    if (!env['SEL_TOOLS_PIPE']) delete clean['SEL_TOOLS_PIPE']
    if (!env['SEL_TOOLS_TOKEN']) delete clean['SEL_TOOLS_TOKEN']
    const child = spawn(process.execPath, [script, '--discovery', discoveryPath], { env: clean, stdio: ['pipe', 'pipe', 'pipe'] })
    children.push(child)
    const replies: Record<string, unknown>[] = []
    let buffer = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) replies.push(JSON.parse(line) as Record<string, unknown>)
    })
    return {
      send: (message) => void child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...(message as object) })}\n`),
      reply: async (id) => {
        for (let wait = 0; wait < 200; wait++) {
          const found = replies.find((entry) => entry['id'] === id)
          if (found) return found
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error(`no reply ${id}`)
      }
    }
  }
  const text = (reply: Record<string, unknown>): { text: string; isError: boolean } => {
    const result = reply['result'] as { content: { text: string }[]; isError: boolean }
    return { text: result.content[0].text, isError: result.isError }
  }

  it('says to turn the setting on when there is no discovery file, and still lists every tool', async () => {
    const { send, reply } = client(join(dir, 'nowhere', DISCOVERY_FILE))
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    const init = (await reply(1))['result'] as { instructions: string }
    expect(init.instructions).not.toMatch(/read-only/i)
    expect(init.instructions).toContain('Nothing can be deleted')
    send({ id: 2, method: 'tools/list' })
    expect(((await reply(2))['result'] as { tools: { name: string }[] }).tools.map((tool) => tool.name)).toEqual(EXTERNAL_TOOL_SPECS.map((spec) => spec.name))
    send({ id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'x' } } })
    expect(text(await reply(3))).toEqual({ text: EXTERNAL_MESSAGES.off, isError: true })
  }, 20_000)

  it('says to open sel when nothing listens where the discovery file says', async () => {
    const path = join(dir, 'closed.json')
    writeFileSync(path, JSON.stringify({ version: 1, pipe: pipeName(dir, 'c'.repeat(48)), token: 'c'.repeat(48) }))
    const { send, reply } = client(path)
    send({ id: 1, method: 'tools/call', params: { name: 'outline', arguments: {} } })
    expect(text(await reply(1))).toEqual({ text: EXTERNAL_MESSAGES.closed, isError: true })
  }, 20_000)

  it('reads and writes through the running app, follows a new token, and is refused a stale one', async () => {
    const repo = openTestRepository()
    const userData = mkdtempSync(join(tmpdir(), 'sel-mcp-app-'))
    const endpoint = await createEndpoint(repo, { userData, ...tokenStore(), changed: () => void repo.drainChanges() })
    try {
      await endpoint.start()
      const path = join(userData, DISCOVERY_FILE)
      const { send, reply } = client(path)
      send({ id: 1, method: 'tools/call', params: { name: 'create_page', arguments: { title: 'Plans', markdown: 'Go **north**.' } } })
      const created = text(await reply(1))
      expect(created.isError).toBe(false)
      const id = /\[([^\]]+)\]/.exec(created.text)![1]
      expect(repo.get(id)?.props.title).toEqual([['Plans']])

      // A new token while the client runs: the script reads the file again and carries on.
      const stale = readFileSync(path, 'utf8')
      await endpoint.rotate()
      send({ id: 2, method: 'tools/call', params: { name: 'read_page', arguments: { id } } })
      expect(text(await reply(2))).toEqual({ text: expect.stringContaining('Go **north**.'), isError: false })

      // A copy of the old file is worth nothing now.
      const copy = join(userData, 'copy.json')
      writeFileSync(copy, JSON.stringify({ ...JSON.parse(stale), pipe: discovery(userData).pipe }))
      const other = client(copy)
      other.send({ id: 1, method: 'tools/call', params: { name: 'outline', arguments: {} } })
      expect(text(await other.reply(1))).toEqual({ text: EXTERNAL_MESSAGES.refused, isError: true })

      // The app closes: the file stays, and the client is told to open sel.
      await endpoint.stop(false)
      send({ id: 3, method: 'tools/call', params: { name: 'outline', arguments: {} } })
      expect(text(await reply(3))).toEqual({ text: EXTERNAL_MESSAGES.closed, isError: true })
    } finally {
      await endpoint.stop(true)
      rmSync(userData, { recursive: true, force: true })
    }
  }, 30_000)

  it('still gives Herman the reading tools only', async () => {
    const repo = openTestRepository()
    const page = markdown.importMarkdownText(repo, 'Body', null, 'Note')
    const { repositorySource } = await import('../ai/tools')
    const host = new ToolHost({ source: () => repositorySource(repo, markdown), dir, execPath: process.execPath, script })
    try {
      const grant = await host.grant()
      const { env } = (JSON.parse(readFileSync(grant.configPath, 'utf8')) as { mcpServers: { sel: { env: Record<string, string> } } }).mcpServers.sel
      const { send, reply } = client(join(dir, 'unused.json'), env)
      send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } })
      expect(((await reply(1))['result'] as { instructions: string }).instructions).toMatch(/^Read-only/)
      send({ id: 2, method: 'tools/list' })
      const names = ((await reply(2))['result'] as { tools: { name: string }[] }).tools.map((tool) => tool.name)
      expect(names).toEqual(TOOL_NAMES)
      for (const name of WRITE_TOOL_NAMES) expect(names).not.toContain(name)
      // Asked anyway, the grant knows no such tool, and nothing is written.
      send({ id: 3, method: 'tools/call', params: { name: 'append_to_page', arguments: { id: page.id, markdown: 'more' } } })
      expect(text(await reply(3))).toEqual({ text: 'There is no tool called append_to_page.', isError: true })
      expect(repo.children(page.id)).toHaveLength(1)
      grant.release()
    } finally {
      host.dispose()
    }
  }, 20_000)
})

function discovery(dir: string): { pipe: string; token: string } {
  return parseDiscovery(readFileSync(join(dir, DISCOVERY_FILE), 'utf8'))!
}
