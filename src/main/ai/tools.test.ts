import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Block, BlockProps, BlockType, SearchResult } from '../../shared/types'
import { BASE_ARGS, buildArgs, buildSpawn, SYSTEM_PROMPT_TOOLS, toolArgs } from './command'
import { ToolHost, toolScript } from './toolhost'
import { callTool, ToolError, toolActivity, type ToolSource } from './tools'
import { ALLOWED_TOOLS, TOOL_NAMES, TOOL_SPECS } from './toolspecs'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 14)

function block(id: string, type: BlockType, title: string, extra: Partial<Block> = {}, props: BlockProps = {}): Block {
  return {
    id,
    type,
    parentId: null,
    content: [],
    props: { title: title ? [[title]] : [], ...props },
    createdAt: NOW,
    updatedAt: NOW,
    trashedAt: null,
    ...extra
  }
}

/** A small workspace: two areas, a database of tasks, an empty page, a duplicate and an old page. */
function workspace(): { source: ToolSource; blocks: Map<string, Block> } {
  const list: Block[] = [
    block('projects-1', 'page', 'Projects', { content: ['launch-01', 'text-001', 'tasks-001'] }, { icon: '🚀' }),
    block('launch-01', 'page', 'Launch', { parentId: 'projects-1', content: ['text-002'] }),
    block('text-002', 'text', 'Ship on Friday', { parentId: 'launch-01' }),
    block('text-001', 'text', 'All current work', { parentId: 'projects-1' }),
    block(
      'tasks-001',
      'database',
      'Tasks',
      { parentId: 'projects-1', content: ['row-0001', 'row-0002'] },
      {
        schema: {
          title: { id: 'title', name: 'Name', type: 'title' },
          s: { id: 's', name: 'Status', type: 'select', options: [{ id: 'o1', name: 'Doing', color: 'blue' }] },
          d: { id: 'd', name: 'Due', type: 'date' },
          c: { id: 'c', name: 'Done', type: 'checkbox' }
        }
      }
    ),
    block('row-0001', 'page', 'Write the brief', { parentId: 'tasks-001' }, { values: { s: 'o1', d: { start: '2026-10-20' }, c: true } }),
    block('row-0002', 'page', 'Book a room', { parentId: 'tasks-001' }),
    block('notes-001', 'page', 'Notes', { content: ['empty-01'] }),
    block('empty-01', 'page', '', { parentId: 'notes-001', updatedAt: NOW - 400 * DAY }),
    block('launch-02', 'page', 'launch', { parentId: 'notes-001', updatedAt: NOW - 200 * DAY }),
    block('gone-001', 'page', 'Gone', { trashedAt: NOW })
  ]
  list.find((b) => b.id === 'notes-001')!.content.push('launch-02')
  const blocks = new Map(list.map((b) => [b.id, b]))
  const get = (id: string): Block | null => blocks.get(id) ?? null
  const pagesUnder = (id: string): Block[] =>
    (get(id)?.content ?? []).flatMap((child) => {
      const b = get(child)
      return b && (b.type === 'page' || b.type === 'database') ? [b] : []
    })
  const source: ToolSource = {
    get,
    ancestors: (id) => {
      const out: Block[] = []
      for (let cursor = get(id)?.parentId ?? null; cursor; cursor = get(cursor)?.parentId ?? null) out.unshift(get(cursor)!)
      return out
    },
    listRoot: () => ['projects-1', 'notes-001', 'gone-001'].map((id) => get(id)!),
    listChildren: pagesUnder,
    listRecent: (limit) =>
      [...blocks.values()]
        .filter((b) => b.type === 'page' || b.type === 'database')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit),
    listDatabases: () => [get('tasks-001')!],
    search: (text) =>
      [...blocks.values()]
        .filter((b) => (b.props.title?.[0]?.[0] ?? '').toLowerCase().includes(text.toLowerCase()))
        .map((b): SearchResult => {
          const page = b.type === 'text' ? b.parentId! : b.id
          return {
            id: b.id,
            pageId: page,
            title: get(page)?.props.title?.[0]?.[0] ?? '',
            ...(b.type === 'text' ? { snippet: b.props.title?.[0]?.[0] } : {}),
            path: []
          }
        }),
    pageToMarkdown: (id) => ({
      title: 'x',
      markdown: `# ${get(id)?.props.title?.[0]?.[0] ?? ''}\n\n${(get(id)?.content ?? []).map((c) => get(c)?.props.title?.[0]?.[0] ?? '').join('\n')}`
    }),
    children: (id) => (get(id)?.content ?? []).flatMap((c) => (get(c) ? [get(c)!] : []))
  }
  return { source, blocks }
}

describe('the workspace tools', () => {
  const { source } = workspace()
  const call = (name: string, args: unknown = {}): string => callTool(source, name, args, NOW)

  it('are listed with a schema each, and only these are allowed', () => {
    expect(TOOL_NAMES).toEqual(['search', 'outline', 'read_page', 'read_database', 'recent', 'audit'])
    for (const spec of TOOL_SPECS) expect(spec.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(ALLOWED_TOOLS).toEqual(TOOL_NAMES.map((name) => `mcp__sel__${name}`))
  })

  it('search the workspace and say where each page is', () => {
    expect(call('search', { query: 'launch' })).toBe('- Launch [launch-01], in Projects\n- launch [launch-02], in Notes')
    expect(call('search', { query: 'friday' })).toBe('- Launch [launch-01], in Projects: “Ship on Friday”')
    expect(call('search', { query: 'zebra' })).toBe('Nothing matches “zebra”.')
    expect(() => call('search', { query: '  ' })).toThrow(ToolError)
  })

  it('show the tree with ids, sizes, dates and what is empty, and leave the Trash out', () => {
    const tree = call('outline', { depth: 3 })
    expect(tree).toContain('- 🚀 Projects [projects-1] (edited 2026-10-14)')
    expect(tree).toContain('  - Tasks [tasks-001] (database) (2 rows, edited 2026-10-14)')
    expect(tree).toContain('  - Untitled [empty-01] (edited 2025-09-09, empty)')
    expect(tree).not.toContain('Gone')
    expect(call('outline', { depth: 1 })).toContain('  - (2 more inside)')
    expect(call('outline', { root: 'notes-001' })).toMatch(/^Inside Notes \[notes-001\], in the top level:/)
    expect(() => call('outline', { root: 'gone-001' })).toThrow('No page has that id.')
  })

  it('read a page with where it is and what is inside, and a database with its rows', () => {
    const page = call('read_page', { id: 'projects-1' })
    expect(page).toMatch(/^Page 🚀 Projects \[projects-1\], in the top level\. Edited 2026-10-14\./)
    expect(page).toContain('Inside it: Launch [launch-01]; Tasks [tasks-001] (database)')
    expect(page).toContain('All current work')
    const tasks = call('read_database', { id: 'tasks-001' })
    expect(tasks).toContain('Database Tasks [tasks-001] (database), in Projects. 2 rows.')
    expect(tasks).toContain('Properties: Name (title), Status (select: Doing), Due (date), Done (checkbox)')
    expect(tasks).toContain('- Write the brief [row-0001] | Status: Doing | Due: 2026-10-20 | Done: yes')
    expect(tasks).toContain('- Book a room [row-0002]')
    expect(call('read_database', { id: 'tasks-001', offset: 1, limit: 1 })).toContain('Rows 2–2:')
    expect(call('read_database', { id: 'tasks-001', limit: 1 })).toContain('(1 more: read again with offset 1)')
    expect(call('read_page', { id: 'tasks-001' })).toContain('Database Tasks')
    expect(() => call('read_database', { id: 'projects-1' })).toThrow('No database has that id.')
    expect(() => call('read_page', { id: 'gone-001' })).toThrow(ToolError)
  })

  it('audit what a workspace in order would not have', () => {
    const audit = call('audit')
    expect(audit).toContain('Same title more than once:\n- Launch: [launch-01] in Projects; [launch-02] in Notes')
    expect(audit).toContain('Untitled:\n- [empty-01] in Notes [notes-001]')
    expect(audit).toContain('Empty pages:\n- Untitled [empty-01] in Notes [notes-001]')
    expect(audit).toMatch(/Untouched for more than 120 days, the oldest first:\n- Untitled \[empty-01\][^\n]*\n- launch \[launch-02\]/)
    expect(audit).not.toContain('Databases without rows')
  })

  it('refuse what they do not know, and say in a few words what they are doing', () => {
    expect(() => call('write_page', { id: 'projects-1' })).toThrow('There is no tool called write_page.')
    expect(toolActivity(source, 'read_page', { id: 'launch-01' })).toBe('reading “Launch”')
    expect(toolActivity(source, 'search', { query: 'plans' })).toBe('searching for “plans”')
    expect(toolActivity(source, 'outline', {})).toBe('looking over the workspace')
    expect(toolActivity(source, 'audit', null)).toBe('checking the workspace')
  })
})

describe('the tool host', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sel-tools-'))
  const { source } = workspace()
  const host = new ToolHost({ source: () => source, dir, execPath: process.execPath, script: join(dir, 'mcp.js') })
  afterAll(() => {
    host.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers only a token it granted, and stops when the grant ends', async () => {
    const seen: string[] = []
    const grant = await host.grant((activity) => seen.push(activity))
    const config = JSON.parse(readFileSync(grant.configPath, 'utf8')) as {
      mcpServers: { sel: { command: string; args: string[]; env: Record<string, string> } }
    }
    const server = config.mcpServers.sel
    expect(server.command).toBe(process.execPath)
    expect(server.args).toEqual([join(dir, 'mcp.js')])
    expect(server.env['ELECTRON_RUN_AS_NODE']).toBe('1')
    const token = server.env['SEL_TOOLS_TOKEN']
    expect(token).toMatch(/^[0-9a-f]{48}$/)
    expect(host.answer(JSON.stringify({ token, id: 1, name: 'read_page', args: { id: 'launch-01' } }))).toMatchObject({
      id: 1,
      text: expect.stringContaining('Ship on Friday')
    })
    expect(seen).toEqual(['reading “Launch”'])
    expect(host.answer(JSON.stringify({ token, id: 2, name: 'read_page', args: { id: 'nope-0000' } }))).toEqual({
      id: 2,
      error: 'No page or database has that id.'
    })
    expect(host.answer(JSON.stringify({ token: 'f'.repeat(48), id: 3, name: 'audit' }))).toEqual({ id: 3, error: 'This request is over.' })
    expect(host.answer('not json')).toEqual({ id: null, error: 'Not understood.' })
    grant.release()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(existsSync(grant.configPath)).toBe(false)
    expect(host.answer(JSON.stringify({ token, id: 4, name: 'audit' }))).toEqual({ id: 4, error: 'This request is over.' })
  })

  it('serves the MCP server script over the pipe, end to end', async () => {
    // The script as built: esbuild (a dependency of the build) bundles it as the app's build does.
    const { build } = await import('esbuild')
    const script = join(dir, 'mcp.js')
    await build({
      entryPoints: [join(__dirname, '..', 'mcp.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: script,
      logLevel: 'silent'
    })
    const grant = await host.grant()
    const { env } = (JSON.parse(readFileSync(grant.configPath, 'utf8')) as { mcpServers: { sel: { env: Record<string, string> } } })
      .mcpServers.sel
    const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    const replies: Record<string, unknown>[] = []
    let buffer = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) replies.push(JSON.parse(line) as Record<string, unknown>)
    })
    const send = (message: unknown): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }
    const reply = async (id: number): Promise<Record<string, unknown>> => {
      for (let wait = 0; wait < 100; wait++) {
        const found = replies.find((entry) => entry['id'] === id)
        if (found) return found
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error(`no reply ${id}`)
    }
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
    })
    expect(await reply(1)).toMatchObject({ result: { protocolVersion: '2025-06-18', serverInfo: { name: 'sel' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(((await reply(2))['result'] as { tools: { name: string }[] }).tools.map((tool) => tool.name)).toEqual(TOOL_NAMES)
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'launch' } } })
    expect(await reply(3)).toMatchObject({
      result: { content: [{ type: 'text', text: expect.stringContaining('Launch [launch-01]') }], isError: false }
    })
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_page', arguments: { id: 'nope-0000' } } })
    expect(await reply(4)).toMatchObject({ result: { isError: true } })
    grant.release()
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'audit', arguments: {} } })
    expect(await reply(5)).toMatchObject({ result: { content: [{ text: 'This request is over.' }], isError: true } })
    child.stdin.end()
    await new Promise((resolve) => child.once('close', resolve))
  }, 20_000)
})

describe('the command line with the tools', () => {
  it('keeps every rule of the plain one, swapping safe mode for restricted mode and adding the one server', () => {
    const args = toolArgs('C:\\Users\\me\\AppData\\Roaming\\sel\\ai-sandbox\\tools-1.json', 14)
    expect(args).not.toContain('--safe-mode')
    expect(args).not.toContain('--setting-sources')
    for (const flag of ['--print', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--restricted'])
      expect(args).toContain(flag)
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--permission-prompts') + 1]).toBe('none')
    expect(args[args.indexOf('--max-turns') + 1]).toBe('14')
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(SYSTEM_PROMPT_TOOLS)
    expect(args[args.indexOf('--mcp-config') + 1]).toMatch(/tools-1\.json$/)
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(ALLOWED_TOOLS.join(','))
    expect(toolArgs('x', 999)[toolArgs('x', 999).indexOf('--max-turns') + 1]).toBe('24')
    // The system prompt stays safe to put on a cmd.exe line.
    expect(SYSTEM_PROMPT_TOOLS).toMatch(/^[A-Za-z ,.]+$/)
    expect(() => buildSpawn({ kind: 'cmd', path: 'C:\\claude.cmd' }, args)).not.toThrow()
  })

  it('falls back to no tools for a path that could not travel safely', () => {
    expect(buildArgs({ tools: { configPath: 'C:\\a&b\\tools.json', maxTurns: 4 } })).toEqual([...BASE_ARGS])
    expect(buildArgs({ tools: null })).toEqual([...BASE_ARGS])
    expect(buildArgs({ model: 'opus', tools: { configPath: '/tmp/t.json', maxTurns: 4 } }).slice(-2)).toEqual(['--model', 'opus'])
  })
})

describe('the server script', () => {
  it('is found next to the main bundle, also from a chunk', () => {
    const there = new Set([join('/app/out/main', 'mcp.js')])
    expect(toolScript('/app/out/main', (path) => there.has(path))).toBe(join('/app/out/main', 'mcp.js'))
    expect(toolScript('/app/out/main/chunks', (path) => there.has(path))).toBe(join('/app/out/main', 'mcp.js'))
  })
})
