// A stand-in for the Claude Code program, for tests and for driving the UI without the real one.
// It mimics `claude --print --output-format stream-json --include-partial-messages`: it reads the
// prompt from stdin and writes one JSON event per line (system/init, text deltas, the assistant
// message, the result). It never touches the network.
//
// A marker in the prompt selects a behaviour: [[fake:slow]] [[fake:instant]] [[fake:echo]]
// [[fake:error-login]] [[fake:error-rate]] [[fake:error-stderr]] [[fake:huge]] [[fake:hang]]
// [[fake:hang-tree]] [[fake:noise]] [[fake:nostream]] [[fake:noresult]] [[fake:bigline]] [[fake:max-turns]]
// A file `fake-delay` in the working directory holds the pause between words, in ms.
// `mcp list` prints a few servers; `--mcp-config` and `--settings` decide the tools of the init event.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)

if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write('2.1.296 (Claude Code)\n')
  process.exit(0)
}

// `mcp list`: a few servers, printed as the real program prints them.
if (argv[0] === 'mcp' && argv[1] === 'list') {
  process.stdout.write(
    [
      'Checking MCP server health…',
      '',
      'claude.ai Fake: https://fake.example/mcp?ref=1 - ✔ Connected',
      'claude.ai Fake Mail: https://mail.fake.example/mcp/v1 - ! Needs authentication',
      'plugin:tools:thing: https://thing.example/mcp (HTTP) - ! Needs authentication',
      'local-thing: node C:\\tools\\thing.mjs - ✔ Connected',
      ''
    ].join('\n')
  )
  process.exit(0)
}

/** The value after a flag, or null. */
const flag = (name) => {
  const index = argv.indexOf(name)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null
}
const readJson = (path) => {
  try {
    return path ? JSON.parse(readFileSync(path, 'utf8')) : null
  } catch {
    return null
  }
}

/**
 * The MCP servers and tools a real run would list for the files it was given: two made-up tools
 * for each server of `--mcp-config` but sel's, and three for the connector "claude.ai Fake" when
 * the `--settings` file lets its address in and `--strict-mcp-config` does not keep it out.
 */
function mcpOf() {
  const config = readJson(flag('--mcp-config'))
  const settings = readJson(flag('--settings'))
  const servers = []
  const tools = []
  for (const name of Object.keys(config?.mcpServers ?? {})) {
    servers.push({ name, status: 'connected' })
    const prefix = `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}__`
    if (name !== 'sel') tools.push(`${prefix}list_items`, `${prefix}create_item`)
  }
  const urls = (settings?.allowedMcpServers ?? []).map((entry) => entry.serverUrl).filter(Boolean)
  if (!argv.includes('--strict-mcp-config') && urls.includes('https://fake.example/mcp')) {
    servers.push({ name: 'claude.ai Fake', status: 'connected' })
    tools.push('mcp__claude_ai_Fake__get_me', 'mcp__claude_ai_Fake__list_tickets', 'mcp__claude_ai_Fake__create_ticket')
  }
  return { servers, tools, config, settings }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const write = (text) => new Promise((resolve) => process.stdout.write(text, resolve))
const line = (event) => write(JSON.stringify(event) + '\n')
const delta = (text) =>
  line({
    type: 'stream_event',
    session_id: 'fake',
    parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
  })

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function section(prompt, name) {
  const match = new RegExp(`<<<${name} ([0-9a-f]+)>>>\\n(?:\\([^\\n]*\\)\\n)?([\\s\\S]*?)\\n<<<END ${name} \\1>>>`).exec(prompt)
  return match ? match[2] : ''
}

/** A plausible answer for the task in the prompt: enough for screenshots and for assertions. */
function answer(prompt) {
  const task = /^Task: (.*)$/m.exec(prompt)?.[1] ?? ''
  const text = section(prompt, 'TEXT').trim()
  const request = section(prompt, 'USER REQUEST').trim()
  const tidy = (value) =>
    value
      .replace(/[ \t]+/g, ' ')
      .replace(/\bteh\b/g, 'the')
      .replace(/\bi\b/g, 'I')
      .trim()
  if (task.startsWith('Summarize')) {
    return [
      'This page collects the plan for the spring release: what ships, who owns each part and what is still open.',
      '',
      '## Key points',
      '',
      '- The editor work is done and the sync work is **two weeks behind**.',
      '- Launch moves to the first week of May.',
      '- Pricing stays as it is until the next review.',
      '',
      '## Action items',
      '',
      '- [ ] Confirm the new launch date with marketing',
      '- [ ] Write the migration guide'
    ].join('\n')
  }
  if (task.startsWith('Suggest five titles')) {
    return [
      '🚀 Spring release plan',
      '🗓️ May launch checklist',
      '🧭 Where the release stands',
      '🛠️ Editor and sync status',
      '📌 Release notes draft'
    ].join('\n')
  }
  if (task.startsWith('Extract the action items'))
    return ['- [ ] Confirm the new launch date with marketing', '- [ ] Write the migration guide', '- [ ] Book the review meeting'].join(
      '\n'
    )
  if (task.startsWith('Turn') && task.includes('outline')) {
    return [
      '## Scope',
      '',
      '- Editor',
      '- Sync',
      '',
      '## Timeline',
      '',
      '- Launch in May',
      '',
      '## Open questions',
      '',
      '- Pricing review'
    ].join('\n')
  }
  // The routines (main/routines/prompts.ts): ids are read back from their sections, as a model would.
  const ids = (name) => [...section(prompt, name).matchAll(/\[([A-Za-z0-9_-]{8,64})\]/g)].map((match) => match[1])
  if (task.startsWith('Plan the user')) {
    const chosen = [...new Set(ids('TASKS'))].slice(0, 3)
    const free = /(\d{2}:\d{2})–(\d{2}:\d{2})/.exec(section(prompt, 'FREE'))
    const start = free ? free[1] : '10:00'
    const [h, m] = start.split(':').map(Number)
    const end = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const tasks = chosen.map((id, index) => ({ id, priority: `P${index + 1}`, ...(index === 0 ? { block: { start, end } } : {}) }))
    const body = [
      'A full day, but it fits if the first hour goes to what matters most.',
      '',
      '## Priorities',
      '',
      ...(chosen.length
        ? chosen.map((_, index) => `${index + 1}. The task ranked ${index + 1}, because it is due.`)
        : ['Nothing is due today.']),
      '',
      '## Postpone',
      '',
      '- Nothing needs to move.',
      '',
      '## Time blocks',
      '',
      `- ${start}–${end}: the first priority.`
    ].join('\n')
    return tasks.length
      ? `${body}\n\nApply sets these priorities and the block.\n\n\`\`\`sel-actions\n${JSON.stringify([{ do: 'update-tasks', tasks }])}\n\`\`\``
      : body
  }
  if (task.startsWith('Check in on the user')) return 'Two things are done and one is left. The afternoon has room for it.'
  if (task.startsWith('Draft the close of the user')) {
    const proposal = [
      { do: 'close-day', line: 'A steady day: the main things got done.', plans: ['Start with the report', 'Call the bank'] }
    ]
    return `## Done\n\n- The main tasks.\n\n## Left\n\n- One small thing.\n\n## Tomorrow\n\n- Start with the report.\n\nApply writes the line and the plans in Meditations.\n\n\`\`\`sel-actions\n${JSON.stringify(proposal)}\n\`\`\``
  }
  if (task.startsWith('Help the user unstick')) {
    const id = ids('STALLED TASK')[0]
    const proposal = [{ do: 'add-subtasks', task: id, titles: ['Find the papers', 'Write the first paragraph', 'Send it'] }]
    return `It may be stuck because it is too big to start.\n\nBreak it into three steps (or rewrite it as the next action, or let it go).\n\nApply adds the three steps.\n\n\`\`\`sel-actions\n${JSON.stringify(proposal)}\n\`\`\``
  }
  if (task.startsWith('Continue writing'))
    return 'The next step is to agree on the date with everyone involved, so that the announcement and the release notes can be prepared in time.'
  if (task.startsWith('Answer the question') && /\b(create|make|build|add)\b/i.test(request)) {
    const proposal = [
      { do: 'create-page', title: 'Launch checklist', icon: '🚀', markdown: '## Before\n\n- [ ] Confirm the date\n- [ ] Write the guide' }
    ]
    return `Here is a page for that.\n\n\`\`\`sel-actions\n${JSON.stringify(proposal)}\n\`\`\``
  }
  if (task.startsWith('Answer the question'))
    return `Here is what the page says about that:\n\n- The launch moves to **May**.\n- The sync work is the part that is late.\n\nYou asked: *${request.slice(0, 120)}*`
  if (task.startsWith('Turn the meeting transcript')) {
    return [
      '## Summary',
      '',
      'The team agreed on the May launch.',
      '',
      '## Decisions',
      '',
      '- Launch in May',
      '',
      '## Action items',
      '',
      '- [ ] **Ana** writes the guide by Friday',
      '',
      '## Open questions',
      '',
      '- Who reviews pricing?'
    ].join('\n')
  }
  if (task.startsWith('Follow the request'))
    return text
      ? `${tidy(text)}\n\n(Changed as asked: ${request.slice(0, 80)})`
      : `Here is a draft for: ${request.slice(0, 80)}\n\nA first paragraph that gets straight to the point.\n\n- One supporting idea\n- Another supporting idea`
  if (task.startsWith('Explain'))
    return `In short: ${tidy(text).slice(0, 140)}\n\n- It describes one idea in plain words.\n- Nothing else is implied.`
  if (task.startsWith('Translate')) return `[${/into (.*)\.$/.exec(task)?.[1] ?? 'English'}] ${tidy(text)}`
  if (task.includes('shorter')) return tidy(text).split(/(?<=[.!?])\s/)[0] ?? ''
  if (task.includes('longer') || task.startsWith('Develop'))
    return `${tidy(text)} This adds the detail that was missing: the reasons behind it, an example and what follows from it.`
  return tidy(text) || 'Done.'
}

async function main() {
  const prompt = await readStdin()
  const has = (mode) => prompt.includes(`[[fake:${mode}]]`)
  const mcp = mcpOf()
  const init = { type: 'system', subtype: 'init', session_id: 'fake', model: 'fake-model', tools: mcp.tools, mcp_servers: mcp.servers }

  if (has('error-stderr')) {
    process.stderr.write(
      '\u001b[31mError: something exploded\u001b[0m at C:\\Users\\secret\\AppData\\claude\\cli.js:10:3\n    at run (/home/secret/.claude/x.js:1:1)\n'
    )
    process.exit(2)
  }
  await line(init)
  if (has('error-login')) {
    await line({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', session_id: 'fake' })
    process.exit(1)
  }
  if (has('error-rate')) {
    await line({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: 'Claude AI usage limit reached|1760000000',
      session_id: 'fake'
    })
    process.exit(1)
  }
  if (has('hang') || has('hang-tree')) {
    let pids = String(process.pid)
    if (has('hang-tree')) {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      pids += `,${child.pid}`
    }
    await delta(`pids:${pids}`)
    setInterval(() => undefined, 1000)
    return
  }
  if (has('echo')) {
    const body = JSON.stringify({
      argv,
      stdin: prompt,
      cwd: process.cwd(),
      envKeys: Object.keys(process.env).sort(),
      settings: mcp.settings,
      servers: Object.keys(mcp.config?.mcpServers ?? {})
    })
    await delta(body)
    await line({ type: 'result', subtype: 'success', is_error: false, result: body, session_id: 'fake' })
    return
  }
  if (has('huge')) {
    const chunk = 'lorem ipsum dolor sit amet '.repeat(400)
    for (let i = 0; i < 60; i++) await delta(chunk)
    await line({ type: 'result', subtype: 'success', is_error: false, result: chunk.repeat(60), session_id: 'fake' })
    return
  }
  if (has('bigline')) {
    await write(`{"type":"junk","pad":"${'x'.repeat(5 * 1024 * 1024)}"}\n`)
  }

  const reply = answer(prompt)
  const pieces = reply.match(/\S+\s*|\s+/g) ?? []
  // A file named `fake-delay` in the working directory sets the pause between words (for screenshots).
  let delay = 12
  try {
    delay = Number.parseInt(readFileSync('fake-delay', 'utf8'), 10) || delay
  } catch {
    /* no file: the default */
  }
  const pause = has('slow') ? 120 : has('instant') ? 0 : delay
  if (has('noise')) {
    await write('Warning: this is not JSON\n')
    await write('\n')
    await write('[1,2,3]\n')
  }
  if (!has('nostream')) {
    for (const [index, piece] of pieces.entries()) {
      if (has('noise') && index === 1) {
        // One event written in two halves, with a pause in between.
        const whole =
          JSON.stringify({
            type: 'stream_event',
            event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }
          }) + '\n'
        await write(whole.slice(0, 25))
        await sleep(30)
        await write(whole.slice(25))
        continue
      }
      await delta(piece)
      if (pause) await sleep(pause)
    }
  }
  await line({
    type: 'assistant',
    session_id: 'fake',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'text', text: reply }] }
  })
  if (has('noresult')) return
  if (has('max-turns')) {
    await line({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 1, session_id: 'fake' })
    return
  }
  await line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1,
    num_turns: 1,
    result: reply,
    session_id: 'fake',
    // A routine's request reports a small cost, so that Settings → AI has one to show.
    total_cost_usd: prompt.includes('one of the routines the user turned on') ? 0.0123 : 0
  })
}

main().then(
  () => undefined,
  (err) => {
    process.stderr.write(String(err) + '\n')
    process.exit(1)
  }
)
