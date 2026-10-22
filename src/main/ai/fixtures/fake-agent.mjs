// A stand-in for another program connected to the council: it reads the prompt from stdin and
// prints a plain answer, with a colour sequence around it the way a terminal program might.
// It prints its arguments too, so that a test can see what it was started with.
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const prompt = Buffer.concat(chunks).toString('utf8')

if (prompt.includes('[[agent:fail]]')) {
  process.stderr.write('model not found\n')
  process.exit(3)
}
const who = /^You are ([A-Za-z]+),/.exec(prompt)?.[1] ?? 'nobody'
process.stdout.write(
  `\u001b[32m${who} says: mind the date.\u001b[0m\nargs=${JSON.stringify(process.argv.slice(2))} env=${process.env.FAKE_AGENT_HOME ?? ''}${process.env.SECRET_KEY ?? ''}\n`
)
