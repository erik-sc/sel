// Settings → Sync. A chunk of its own, fetched when the section is first shown.
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import { SYNC_LIMITS, type SyncError, type SyncMode, type SyncSetup, type SyncStatus } from '@shared/sync'
import { Segmented } from '@/appearance/controls'
import { setHistoryPage, setSettingsOpen } from '@/store/ui'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'
import { SyncAlert, SyncBusy, SyncDone, SyncOff, SyncPending } from './icons'
import { conflictCount, describeActivity, lastSynced, passphraseProblem, plural, summarize, urlProblem, when } from './labels'
import { acceptStatus, useSync } from './store'
import './sync.css'

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' }
]

const LOST_PASSPHRASE =
  'If you lose the passphrase, the copy in the repository cannot be read by anyone, you included. The pages on your devices are not affected.'
const OPAQUE = 'File names and contents are hidden in the repository, so its history shows no readable differences.'

/** Re-renders every half minute, so that "5 minutes ago" stays true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function SyncSection(): JSX.Element {
  const status = useSync((state) => state.status)
  const loaded = useSync((state) => state.loaded)

  // The section may be the first thing to ask about sync on a device that never used it.
  useEffect(() => {
    let alive = true
    window.api.sync
      .status()
      .then((next) => {
        if (alive) acceptStatus(next, true)
      })
      .catch((error: unknown) => console.error('could not load the state of sync', error))
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="settings2-scroll sync">
      {!loaded ? <div aria-busy="true" /> : status.configured ? <Connected status={status} /> : <Setup status={status} />}
    </div>
  )
}

// ----------------------------------------------------------------- not set up

function Setup({ status }: { status: SyncStatus }): JSX.Element {
  const [url, setUrl] = useState('')
  const [device, setDevice] = useState(status.deviceName)
  const [deviceEdited, setDeviceEdited] = useState(false)
  const [encrypt, setEncrypt] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [repeat, setRepeat] = useState('')
  const [mode, setMode] = useState<SyncMode>('merge')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<SyncError | null>(null)
  const [touched, setTouched] = useState(false)
  const ids = { url: useId(), device: useId(), pass: useId(), repeat: useId(), help: useId() }

  // A question or a problem appears below the form: bring it into view.
  const answer = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (problem) answer.current?.scrollIntoView({ block: 'nearest' })
  }, [problem])

  // The name of this computer arrives with the first answer from the main process.
  useEffect(() => {
    if (!deviceEdited) setDevice(status.deviceName)
  }, [status.deviceName, deviceEdited])

  // The repository is already encrypted: its passphrase is asked for once, with nothing to choose.
  // It stays part of the request through the questions that may follow.
  const [existing, setExisting] = useState(false)
  const locked = existing || problem?.code === 'passphrase-required' || problem?.code === 'wrong-passphrase'
  const choosing = problem?.code === 'needs-choice'
  const foreign = problem?.code === 'not-sel-repo'
  const badUrl = urlProblem(url, status.localRemotes === true)
  const badPass = encrypt || locked ? passphraseProblem(passphrase, locked ? null : repeat) : null
  const needsPass = (encrypt || locked) && (passphrase === '' || (!locked && repeat !== passphrase))
  const ready = url.trim() !== '' && !badUrl && !badPass && !needsPass && !busy

  const run = (extra: Partial<SyncSetup> = {}): void => {
    if (!ready) {
      setTouched(true)
      return
    }
    const input: SyncSetup = { remoteUrl: url.trim(), ...extra }
    if (device.trim()) input.deviceName = device.trim()
    if (encrypt || locked) input.passphrase = passphrase
    if (choosing) input.mode = mode
    setBusy(true)
    window.api.sync
      .setup(input)
      .then((next) => {
        if (next.configured) {
          setProblem(null)
          acceptStatus(next, true)
          if (!next.lastError) toast('This device now syncs with the repository.', { kind: 'success' })
          return
        }
        if (next.lastError?.code === 'passphrase-required' || next.lastError?.code === 'wrong-passphrase') setExisting(true)
        setProblem(next.lastError ?? { code: 'failed', message: 'Sync could not be set up.' })
      })
      .catch((error: unknown) => {
        console.error('sync setup failed', error)
        setProblem({ code: 'failed', message: error instanceof Error && error.message ? error.message : 'Sync could not be set up.' })
      })
      .finally(() => setBusy(false))
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    run()
  }

  const chooseGit = (): void => {
    window.api.sync.pickGit().then(
      (next) => {
        if (!next) return
        if (next.lastError) setProblem(next.lastError)
        else {
          setProblem(null)
          toast('Git was found. You can start syncing now.', { kind: 'success' })
        }
      },
      (error: unknown) => notifyError('Could not choose the program.', error)
    )
  }

  // Changing the address starts over: what was asked about the previous one no longer applies.
  const editUrl = (value: string): void => {
    setUrl(value)
    setProblem(null)
    setExisting(false)
  }

  return (
    <form onSubmit={submit} noValidate>
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Sync between your devices</h3>
        </div>
        <p className="sync-lede">
          sel can keep your pages the same on all your devices by saving them to a private git repository that you own. Each device reads
          and writes there in the background, and changes made on two devices are merged.
        </p>
        <ul className="sync-needs">
          <li>A private repository that is yours, for example on GitHub. Start with an empty one.</li>
          <li>Git on this computer, signed in to that account. sel uses it as it is and stores no password or token.</li>
        </ul>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Repository</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row is-stacked">
            <div className="ap-row-text">
              <label className="ap-row-label" htmlFor={ids.url}>
                Repository address
              </label>
              <span className={badUrl ? 'ap-row-help is-error' : 'ap-row-help'} id={ids.help} role={badUrl ? 'alert' : undefined}>
                {badUrl ??
                  (touched && !url.trim()
                    ? 'Enter the address of your repository.'
                    : 'The HTTPS or SSH address, as the repository page shows it under "Code".')}
              </span>
            </div>
            <div className="ap-row-control">
              <input
                id={ids.url}
                className={badUrl ? 'ap-field is-wide is-invalid' : 'ap-field is-wide'}
                value={url}
                maxLength={SYNC_LIMITS.url}
                spellCheck={false}
                autoComplete="off"
                placeholder="https://github.com/you/notes.git"
                aria-invalid={badUrl !== null}
                aria-describedby={ids.help}
                disabled={busy}
                onChange={(event) => editUrl(event.target.value)}
              />
            </div>
            <details className="sync-how">
              <summary>How do I create one?</summary>
              <ol>
                <li>On github.com, choose New repository.</li>
                <li>Give it a name, select Private, and leave everything else unticked so that it starts empty.</li>
                <li>Create it, then copy the HTTPS address shown on the next page and paste it here.</li>
                <li>
                  If git has never been used with GitHub on this computer, sign in once: install Git for Windows (it includes Git Credential
                  Manager) or run <code className="sync-code">gh auth login</code>.
                </li>
              </ol>
            </details>
          </div>
          <div className="ap-row">
            <div className="ap-row-text">
              <label className="ap-row-label" htmlFor={ids.device}>
                Name of this device
              </label>
              <span className="ap-row-help">Shown in the activity of your other devices.</span>
            </div>
            <div className="ap-row-control">
              <input
                id={ids.device}
                className="ap-field sync-text"
                value={device}
                maxLength={SYNC_LIMITS.deviceName}
                spellCheck={false}
                disabled={busy}
                onChange={(event) => {
                  setDeviceEdited(true)
                  setDevice(event.target.value)
                }}
              />
            </div>
          </div>
          {!locked && (
            <div className="ap-row">
              <div className="ap-row-text">
                <span className="ap-row-label">Encrypt with a passphrase</span>
                <span className="ap-row-help">
                  Optional. The repository then holds nothing anyone can read without the passphrase, and your connected calendars sync too.
                </span>
              </div>
              <div className="ap-row-control">
                <Segmented
                  label="Encrypt with a passphrase"
                  value={encrypt ? 'on' : 'off'}
                  options={ON_OFF}
                  onChange={(value) => setEncrypt(value === 'on')}
                />
              </div>
            </div>
          )}
          {(encrypt || locked) && (
            <div className="ap-row">
              <div className="ap-row-text">
                <label className="ap-row-label" htmlFor={ids.pass}>
                  {locked ? 'Passphrase of this repository' : 'Passphrase'}
                </label>
                <span
                  className={badPass || problem?.code === 'wrong-passphrase' ? 'ap-row-help is-error' : 'ap-row-help'}
                  role={badPass ? 'alert' : undefined}
                >
                  {badPass ??
                    (locked
                      ? problem?.code === 'wrong-passphrase'
                        ? problem.message
                        : 'This repository is encrypted. Enter its passphrase.'
                      : `At least ${SYNC_LIMITS.passphraseMin} characters. You will type it once on each device.`)}
                </span>
              </div>
              <div className="ap-row-control sync-passphrase">
                <input
                  id={ids.pass}
                  type="password"
                  className="ap-field sync-text"
                  value={passphrase}
                  maxLength={SYNC_LIMITS.passphraseMax}
                  autoComplete="new-password"
                  aria-label={locked ? 'Passphrase of this repository' : 'Passphrase'}
                  disabled={busy}
                  onChange={(event) => setPassphrase(event.target.value)}
                />
                {!locked && (
                  <input
                    id={ids.repeat}
                    type="password"
                    className="ap-field sync-text"
                    value={repeat}
                    maxLength={SYNC_LIMITS.passphraseMax}
                    autoComplete="new-password"
                    placeholder="Again"
                    aria-label="Passphrase, again"
                    disabled={busy}
                    onChange={(event) => setRepeat(event.target.value)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
        {encrypt && !locked && (
          <p className="ap-note sync-warning">
            {LOST_PASSPHRASE} {OPAQUE}
          </p>
        )}

        {choosing && (
          <fieldset className="sync-choice">
            <legend>This device already has pages, and so does the repository. What should happen to the pages of this device?</legend>
            <label className="sync-option">
              <input type="radio" name="sync-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span>
                <span className="sync-option-title">Merge this device's pages into the workspace</span>
                <span className="sync-option-help">Every page of both ends up on all your devices.</span>
              </span>
            </label>
            <label className="sync-option">
              <input type="radio" name="sync-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span>
                <span className="sync-option-title">Replace this device's pages with the workspace</span>
                <span className="sync-option-help">
                  Pages the workspace does not have are saved to version history and moved to the trash. Nothing is deleted.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        {problem && !choosing && problem.code !== 'passphrase-required' && problem.code !== 'wrong-passphrase' && (
          <div className="sync-problem" role="alert">
            <p>{problem.message}</p>
            {foreign && (
              <p className="sync-problem-help">
                sel can still use it: it will add its own files next to what is there and will not change or delete anything else. An empty
                repository of its own is the tidier choice.
              </p>
            )}
            <div className="sync-problem-actions">
              {foreign && (
                <Button disabled={busy} onClick={() => run({ useAnyway: true })}>
                  Use this repository anyway
                </Button>
              )}
              {problem.code === 'git-not-found' && <Button onClick={chooseGit}>Choose git…</Button>}
            </div>
          </div>
        )}

        <div className="sync-actions" ref={answer}>
          <Button type="submit" variant="primary" disabled={busy} aria-disabled={!ready}>
            {busy ? 'Connecting…' : choosing ? 'Continue' : locked ? 'Unlock and start syncing' : 'Start syncing'}
          </Button>
          {busy && (
            <span className="sync-progress" role="status">
              <SyncBusy /> Reaching the repository and syncing for the first time. A large workspace can take a minute.
            </span>
          )}
        </div>
      </section>
    </form>
  )
}

// ------------------------------------------------------------------ connected

function StateIcon({ status }: { status: SyncStatus }): JSX.Element {
  const { tone } = summarize(status)
  if (status.state === 'syncing') return <SyncBusy size={18} />
  if (status.paused || status.state === 'offline') return <SyncOff size={18} />
  if (tone === 'attention') return <SyncAlert size={18} />
  return status.pending > 0 ? <SyncPending size={18} /> : <SyncDone size={18} />
}

function Connected({ status }: { status: SyncStatus }): JSX.Element {
  const now = useNow()
  const [working, setWorking] = useState<'now' | 'pause' | 'disconnect' | 'unlock' | 'encrypt' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [unlock, setUnlock] = useState('')
  const summary = summarize(status)
  const syncing = status.state === 'syncing'
  const code = status.lastError?.code
  const locked = code === 'passphrase-required' || code === 'wrong-passphrase'
  const unlockId = useId()

  const act = (kind: NonNullable<typeof working>, call: () => Promise<SyncStatus | null>, failed: string): void => {
    setWorking(kind)
    call()
      .then((next) => {
        if (next) acceptStatus(next, true)
      })
      .catch((error: unknown) => notifyError(failed, error))
      .finally(() => setWorking(null))
  }

  const review = (pageId: string): void => {
    setSettingsOpen(false)
    setHistoryPage(pageId)
  }

  return (
    <>
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Sync</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <span className={`sync-state is-${summary.tone}`} aria-hidden="true">
              <StateIcon status={status} />
            </span>
            <div className="ap-row-text">
              <span className="ap-row-label" role="status">
                {summary.label}
              </span>
              <span className="ap-row-help">
                {lastSynced(status, now)}
                {status.pending > 0 && !syncing ? `. ${plural(status.pending, 'page')} waiting to upload` : ''}
              </span>
            </div>
            <div className="ap-row-control">
              <Button
                disabled={working !== null}
                onClick={() => act('pause', () => window.api.sync.pause(!status.paused), 'Could not change that.')}
              >
                {status.paused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                variant="primary"
                disabled={syncing || working !== null}
                onClick={() => act('now', () => window.api.sync.now(), 'Sync could not be started.')}
              >
                {syncing || working === 'now' ? 'Syncing…' : 'Sync now'}
              </Button>
            </div>
          </div>
        </div>

        {status.lastError && !syncing && (
          <div className="sync-problem" role="alert">
            <p>{status.lastError.message}</p>
            {locked && (
              <form
                className="sync-problem-actions"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (unlock.length >= SYNC_LIMITS.passphraseMin)
                    act('unlock', () => window.api.sync.unlock(unlock).finally(() => setUnlock('')), 'Could not unlock the repository.')
                }}
              >
                <label className="sync-visually-hidden" htmlFor={unlockId}>
                  Passphrase of this repository
                </label>
                <input
                  id={unlockId}
                  type="password"
                  className="ap-field sync-text"
                  value={unlock}
                  maxLength={SYNC_LIMITS.passphraseMax}
                  autoComplete="off"
                  placeholder="Passphrase"
                  onChange={(event) => setUnlock(event.target.value)}
                />
                <Button type="submit" disabled={working !== null || unlock.length < SYNC_LIMITS.passphraseMin}>
                  {working === 'unlock' ? 'Unlocking…' : 'Unlock'}
                </Button>
              </form>
            )}
            {code === 'git-not-found' && (
              <div className="sync-problem-actions">
                <Button onClick={() => act('now', () => window.api.sync.pickGit(), 'Could not choose the program.')}>Choose git…</Button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Repository</h3>
        </div>
        <div className="ap-list">
          <Fact label="Address" value={status.remoteUrl ?? ''} mono />
          <Fact label="Branch" value={status.branch} mono />
          <Fact label="This device" value={status.deviceName} />
          <Fact
            label="Git"
            value={status.gitVersion ? `Version ${status.gitVersion}, signed in by itself. sel stores no token.` : 'Not checked yet'}
          />
          <Encryption
            status={status}
            busy={working !== null || syncing}
            onChange={(passphrase) =>
              act('encrypt', () => window.api.sync.setEncryption(passphrase), 'The encryption could not be changed.')
            }
            working={working === 'encrypt'}
          />
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">Recent activity</h3>
        </div>
        {status.activity.length === 0 ? (
          <p className="ap-note">Nothing has been synced yet.</p>
        ) : (
          <ol className="ap-list sync-activity">
            {status.activity.map((entry) => (
              <li className="ap-row" key={entry.at}>
                <div className="ap-row-text">
                  <span className={entry.error ? 'ap-row-label sync-activity-failed' : 'ap-row-label'}>{describeActivity(entry)}</span>
                  {entry.conflicts.length > 0 && (
                    <span className="ap-row-help">
                      {plural(conflictCount(entry), 'block')} changed on both devices. The other{' '}
                      {conflictCount(entry) === 1 ? 'version is' : 'versions are'} in the history of{' '}
                      {entry.conflicts.map((page, index) => (
                        <span key={page.pageId}>
                          {index > 0 && ', '}
                          <button type="button" className="sync-link" onClick={() => review(page.pageId)}>
                            {page.title}
                          </button>
                        </span>
                      ))}
                      .
                    </span>
                  )}
                </div>
                <time className="sync-activity-time" dateTime={new Date(entry.at).toISOString()}>
                  {when(entry.at, now)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">This device</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">Stop syncing on this device</span>
              <span className="ap-row-help">
                {confirming
                  ? 'Your pages stay on this device, and the repository is left exactly as it is. Disconnect?'
                  : 'Your pages stay here and in the repository. Nothing is deleted anywhere.'}
              </span>
            </div>
            <div className="ap-row-control">
              {confirming ? (
                <>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    disabled={working !== null}
                    onClick={() => {
                      setConfirming(false)
                      act('disconnect', () => window.api.sync.disconnect({ keepRemote: true }), 'Could not disconnect.')
                    }}
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button onClick={() => setConfirming(true)}>Disconnect…</Button>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="ap-row">
      <div className="ap-row-text">
        <span className="ap-row-label">{label}</span>
      </div>
      <span className={mono ? 'sync-fact is-mono' : 'sync-fact'}>{value}</span>
    </div>
  )
}

/** Turning encryption on or off, or changing the passphrase: a re-upload, explained before it happens. */
function Encryption({
  status,
  busy,
  working,
  onChange
}: {
  status: SyncStatus
  busy: boolean
  working: boolean
  onChange: (passphrase: string | null) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [repeat, setRepeat] = useState('')
  const problem = passphraseProblem(passphrase, repeat)
  const ready = passphrase !== '' && repeat === passphrase && !problem

  useEffect(() => {
    if (!working) return
    setOpen(false)
    setPassphrase('')
    setRepeat('')
  }, [working])

  return (
    <div className="ap-row is-stacked">
      <div className="ap-row-text">
        <span className="ap-row-label">Encryption</span>
        <span className="ap-row-help">
          {working
            ? 'Uploading everything again in its new form…'
            : status.encrypted
              ? `On. ${OPAQUE}`
              : 'Off. Anyone who can open the repository can read your pages. Connected calendars sync only when it is on.'}
        </span>
      </div>
      {!open && (
        <div className="sync-fact">
          <Button disabled={busy} onClick={() => setOpen(true)}>
            {status.encrypted ? 'Change…' : 'Turn on…'}
          </Button>
        </div>
      )}
      {open && (
        <form
          className="ap-row-control sync-encrypt"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) onChange(passphrase)
          }}
        >
          <p className="sync-encrypt-note">
            Everything is uploaded again{status.encrypted ? ' under the new passphrase' : ', encrypted, with your connected calendars'}.
            Your other devices will ask for the passphrase the next time they sync.{' '}
            {status.encrypted ? 'Turning encryption off removes your calendars from the repository. ' : ''}
            {LOST_PASSPHRASE}
          </p>
          <input
            type="password"
            className="ap-field sync-text"
            value={passphrase}
            maxLength={SYNC_LIMITS.passphraseMax}
            autoComplete="new-password"
            placeholder={status.encrypted ? 'New passphrase' : 'Passphrase'}
            aria-label={status.encrypted ? 'New passphrase' : 'Passphrase'}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <input
            type="password"
            className="ap-field sync-text"
            value={repeat}
            maxLength={SYNC_LIMITS.passphraseMax}
            autoComplete="new-password"
            placeholder="Again"
            aria-label="Passphrase, again"
            onChange={(event) => setRepeat(event.target.value)}
          />
          {problem && (
            <span className="ap-row-help is-error" role="alert">
              {problem}
            </span>
          )}
          <div className="sync-encrypt-actions">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {status.encrypted && (
              <Button disabled={busy} onClick={() => onChange(null)}>
                Turn off encryption
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={busy || !ready}>
              {status.encrypted ? 'Change passphrase' : 'Encrypt and upload again'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
