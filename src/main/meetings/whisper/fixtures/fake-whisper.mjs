// A stand-in for whisper.cpp's `whisper-cli`, for tests and for driving the UI without the real
// program. It takes the flags sel passes (-m -f -l -t -oj -of -pp -np), reads the WAV it is
// given, prints "progress" lines to stderr the way `-pp` does and writes `<-of>.json` in the
// shape `-oj` writes. It "hears" a sentence in every five seconds that are not silent, so the
// result follows the audio. It never touches the network.
//
// A file named `fake-whisper` in the working directory selects a behaviour (words, any order):
//   slow        pause between progress lines        error      print an error and exit 3
//   hang        never finish                        hang-tree  the same, with a child process
//   huge        megabytes of stderr and of JSON     bad-json   write something that is not JSON
//   fail-once   fail the first time, then work (leaves `fake-whisper-failed` behind)
//   blank       hear only [BLANK_AUDIO]
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const argv = process.argv.slice(2)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (argv.includes('--version')) {
  process.stdout.write('whisper.cpp version: 1.9.5\n')
  process.exit(0)
}
if (argv.includes('-h') || argv.includes('--help')) {
  process.stderr.write('\nusage: whisper-cli [options] file0 file1 ...\n\noptions:\n  -oj,       --output-json       [false  ] output result in a JSON file\n  -pp,       --print-progress    [false  ] print progress\n')
  process.exit(0)
}

function option(short, long) {
  const index = argv.findIndex((arg) => arg === short || arg === long)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined
}

const model = option('-m', '--model')
const input = option('-f', '--file')
const base = option('-of', '--output-file')
const language = option('-l', '--language') ?? 'en'

let mode = ''
try {
  mode = readFileSync('fake-whisper', 'utf8')
} catch {
  /* no file: the plain behaviour */
}
const has = (word) => mode.split(/\s+/).includes(word)

function stamp(ms) {
  const two = (n) => String(n).padStart(2, '0')
  const s = Math.floor(ms / 1000)
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)},${String(ms % 1000).padStart(3, '0')}`
}

async function main() {
  if (!model || !existsSync(model)) {
    process.stderr.write(`error: failed to open model '${model}'\n`)
    process.exit(1)
  }
  if (!input || !existsSync(input) || !base || !argv.includes('-oj')) {
    process.stderr.write(`error: failed to read audio file '${input}'\n`)
    process.exit(2)
  }
  if (has('error') || (has('fail-once') && !existsSync('fake-whisper-failed'))) {
    if (has('fail-once')) writeFileSync('fake-whisper-failed', '1')
    process.stderr.write(`\u001b[31merror\u001b[0m: failed to process audio at C:\\Users\\secret\\AppData\\Roaming\\sel\\recordings\\x\\mic.wav\n`)
    process.exit(3)
  }
  if (has('hang') || has('hang-tree')) {
    let pids = String(process.pid)
    if (has('hang-tree')) pids += `,${spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).pid}`
    writeFileSync('fake-whisper-pids', pids)
    process.stderr.write('whisper_print_progress_callback: progress =   5%\n')
    setInterval(() => undefined, 1000)
    return
  }

  const wav = readFileSync(input)
  const rate = wav.readUInt32LE(24)
  const data = wav.subarray(44)
  const samples = Math.floor(data.length / 2)
  const window = rate * 5
  const speaker = /system/i.test(basename(input)) ? 'the others said something' : 'I said something'
  const transcription = []
  for (let from = 0; from < samples; from += window) {
    const to = Math.min(samples, from + window)
    let sum = 0
    for (let i = from; i < to; i += 16) {
      const value = data.readInt16LE(i * 2) / 32768
      sum += value * value
    }
    const rms = Math.sqrt(sum / Math.max(1, Math.ceil((to - from) / 16)))
    const t0 = Math.round((from / rate) * 1000)
    const t1 = Math.round((to / rate) * 1000)
    const text = has('blank') || rms < 0.003 ? ' [BLANK_AUDIO]' : ` At ${stamp(t0).slice(3, 8)} ${speaker}${language === 'pt' ? ' em português' : ''}.`
    transcription.push({ timestamps: { from: stamp(t0), to: stamp(t1) }, offsets: { from: t0, to: t1 }, text })
  }

  for (let percent = 5; percent <= 100; percent += 5) {
    process.stderr.write(`whisper_print_progress_callback: progress = ${String(percent).padStart(3)}%\n`)
    if (has('slow')) await sleep(150)
  }
  if (has('huge')) {
    const noise = 'x'.repeat(64 * 1024) + '\n'
    for (let i = 0; i < 64; i++) await new Promise((resolve) => process.stderr.write(noise, resolve))
  }
  const result = {
    systeminfo: 'fake',
    model: { type: 'small', multilingual: true },
    params: { model, language, translate: false },
    result: { language: language === 'auto' ? 'en' : language },
    transcription
  }
  let json = JSON.stringify(result, null, '\t')
  if (has('bad-json')) json = '{ "transcription": ['
  if (has('huge')) json = JSON.stringify({ ...result, pad: 'y'.repeat(40 * 1024 * 1024) })
  writeFileSync(`${base}.json`, json)
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n')
  process.exit(1)
})
