// What sel keeps of Google on this computer: the OAuth client, the sign-in, the calendar it
// made and what it has put there.
//
// SECURITY: the client secret and the refresh token are credentials. They are kept only here,
// in one file under the profile directory, encrypted with the operating system's key store
// (Electron `safeStorage`), never in the database or the settings (which sync and export), never
// logged, and never handed to a window. Free of Electron imports: the cipher is passed in.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { cleanGoogleClientId, cleanGoogleClientSecret } from '../../shared/google'

export interface Cipher {
  isAvailable(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

export interface GoogleState {
  clientId: string | null
  clientSecret: string | null
  refreshToken: string | null
  /** The calendar sel made in the account. */
  calendarId: string | null
  /** What is in that calendar: the event's id, and a mark of what it says. */
  pushed: Record<string, string>
  lastSync: number | null
}

const EMPTY: GoogleState = { clientId: null, clientSecret: null, refreshToken: null, calendarId: null, pushed: {}, lastSync: null }

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value && value.length <= max ? value : null)

function clean(raw: unknown): GoogleState {
  const value = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const pushed: Record<string, string> = {}
  const stored = value['pushed']
  if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [id, mark] of Object.entries(stored)) {
      if (/^[a-v0-9]{5,64}$/u.test(id) && typeof mark === 'string' && mark.length <= 64) pushed[id] = mark
    }
  }
  const last = value['lastSync']
  return {
    clientId: cleanGoogleClientId(value['clientId']),
    clientSecret: cleanGoogleClientSecret(value['clientSecret']),
    refreshToken: text(value['refreshToken'], 2048),
    calendarId: text(value['calendarId'], 512),
    pushed,
    lastSync: typeof last === 'number' && Number.isFinite(last) && last > 0 ? last : null
  }
}

export class GoogleStore {
  private cache: GoogleState | null = null

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher
  ) {}

  /** False where nothing can be kept safely: the feature is then not offered. */
  available(): boolean {
    return this.cipher.isAvailable()
  }

  read(): GoogleState {
    if (this.cache) return this.cache
    let state = { ...EMPTY }
    if (this.available()) {
      try {
        state = clean(JSON.parse(this.cipher.decrypt(readFileSync(this.file))))
      } catch {
        // No file yet, or one this computer's key store cannot open: start over, signed out.
      }
    }
    this.cache = state
    return state
  }

  write(patch: Partial<GoogleState>): GoogleState {
    if (!this.available()) throw new Error('This computer has no secure storage, so the sign-in cannot be kept.')
    const next = clean({ ...this.read(), ...patch })
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    writeFileSync(temp, this.cipher.encrypt(JSON.stringify(next)), { mode: 0o600 })
    renameSync(temp, this.file)
    this.cache = next
    return next
  }

  clear(): void {
    this.cache = { ...EMPTY }
    rmSync(this.file, { force: true })
  }
}
