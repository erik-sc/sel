// A stand-in for the Claude Code program, for tests and for driving the UI without the real one.
// It mimics `claude --print --output-format stream-json --include-partial-messages`: it reads the
// prompt from stdin and writes one JSON event per line (system/init, text deltas, the assistant
// message, the result). It never touches the network.
//
// A marker in the prompt selects a behaviour: [[fake:slow]] [[fake:instant]] [[fake:echo]]
// [[fake:error-login]] [[fake:error-rate]] [[fake:error-stderr]] [[fake:huge]] [[fake:hang]]
// [[fake:hang-tree]] [[fake:noise]] [[fake:nostream]] [[fake:noresult]] [[fake:bigline]] [[fake:max-turns]]
// A file `fake-delay` in the working directory holds the pause between words, in ms.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)

if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write('2.1.296 (Claude Code)\n')
  process.exit(0)
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
  if (task.startsWith('Continue writing'))
    return 'The next step is to agree on the date with everyone involved, so that the announcement and the release notes can be prepared in time.'
  if (task.startsWith('Give Herman your counsel'))
    return `From where I stand (${/^You are ([A-Za-z]+),/.exec(prompt)?.[1] ?? 'a member'}): the date is the part to look at again before anything else is promised.`
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
  const init = { type: 'system', subtype: 'init', session_id: 'fake', model: 'fake-model', tools: [], mcp_servers: [] }

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
    const body = JSON.stringify({ argv, stdin: prompt, cwd: process.cwd(), envKeys: Object.keys(process.env).sort() })
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
    total_cost_usd: 0
  })
}

main().then(
  () => undefined,
  (err) => {
    process.stderr.write(String(err) + '\n')
    process.exit(1)
  }
)
