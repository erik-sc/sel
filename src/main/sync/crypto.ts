import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { LEGACY_NAME } from '../../shared/legacy'
import type { EncryptionParams } from './format'

/**
 * Optional client-side encryption of what goes into the repository.
 *
 * The key comes from the passphrase with scrypt and a random salt; the salt and the scrypt
 * parameters are public (they live in sel.json), the passphrase and the key never leave
 * this device. Every file is sealed with AES-256-GCM under a fresh nonce; the names of pages
 * and images are replaced by a keyed hash, and the real name travels inside the sealed file.
 * A small sealed constant in sel.json tells a wrong passphrase apart from damaged data.
 */

export interface Keys {
  /** AES-256-GCM key. */
  enc: Buffer
  /** HMAC key for file names. */
  name: Buffer
}

const MAGIC = Buffer.from('SLD1')
const NONCE_BYTES = 12
const TAG_BYTES = 16
const CHECK_TEXT = 'sel-key-check'
/** What a repository encrypted under the app's earlier name sealed instead. */
const LEGACY_CHECK_TEXT = `${LEGACY_NAME}-key-check`
const DEFAULT_COST = { N: 1 << 15, r: 8, p: 1 } as const
const MAX_INFLATED = 512 * 1024 * 1024

export class WrongKeyError extends Error {
  constructor() {
    super('The data cannot be decrypted with this key')
  }
}

function derive(passphrase: string, salt: Buffer, cost: { N: number; r: number; p: number }): Promise<Keys> {
  return new Promise((resolve, reject) => {
    // NFKC: the same passphrase typed on another keyboard or system gives the same key.
    scrypt(passphrase.normalize('NFKC'), salt, 64, { N: cost.N, r: cost.r, p: cost.p, maxmem: 256 * cost.N * cost.r + 1024 * 1024 }, (err, key) => {
      if (err) reject(err)
      else resolve({ enc: Buffer.from(key.subarray(0, 32)), name: Buffer.from(key.subarray(32, 64)) })
    })
  })
}

export function sealCheck(keys: Keys): string {
  return seal(keys, 'check', Buffer.from(CHECK_TEXT)).toString('base64')
}

/** True when `keys` are the ones the repository was encrypted with. */
export function keysMatch(keys: Keys, params: EncryptionParams): boolean {
  try {
    const opened = open(keys, Buffer.from(params.check, 'base64'))
    if (opened.name !== 'check') return false
    return [CHECK_TEXT, LEGACY_CHECK_TEXT].some((text) => {
      const expected = Buffer.from(text)
      return opened.bytes.length === expected.length && timingSafeEqual(opened.bytes, expected)
    })
  } catch {
    return false
  }
}

/** A new salt and the key for `passphrase`, with the public parameters to store in sel.json. */
export async function createEncryption(passphrase: string, cost: { N: number; r: number; p: number } = DEFAULT_COST): Promise<{ params: EncryptionParams; keys: Keys }> {
  const salt = randomBytes(16)
  const keys = await derive(passphrase, salt, cost)
  return { params: { v: 1, kdf: 'scrypt', N: cost.N, r: cost.r, p: cost.p, salt: salt.toString('base64'), check: sealCheck(keys) }, keys }
}

/** The key for `passphrase` under a repository's parameters; null when the passphrase is wrong. */
export async function unlockEncryption(passphrase: string, params: EncryptionParams): Promise<Keys | null> {
  const keys = await derive(passphrase, Buffer.from(params.salt, 'base64'), params)
  return keysMatch(keys, params) ? keys : null
}

/** The name a file gets in an encrypted repository: nothing of the real one shows. */
export function hiddenName(keys: Keys, name: string): string {
  return createHmac('sha256', keys.name).update(name).digest('hex').slice(0, 40)
}

/**
 * Seals `bytes` under their real `name`. Layout: magic, nonce, ciphertext, tag; the plaintext
 * is a flag (1: deflated), the length of the name, the name, the content.
 */
export function seal(keys: Keys, name: string, bytes: Uint8Array, compress = false): Buffer {
  const label = Buffer.from(name, 'utf8')
  if (label.length > 0xffff) throw new Error('Name too long')
  const head = Buffer.alloc(3)
  head[0] = compress ? 1 : 0
  head.writeUInt16BE(label.length, 1)
  const body = compress ? deflateRawSync(bytes) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keys.enc, nonce)
  cipher.setAAD(MAGIC)
  const sealed = Buffer.concat([cipher.update(head), cipher.update(label), cipher.update(body), cipher.final()])
  return Buffer.concat([MAGIC, nonce, sealed, cipher.getAuthTag()])
}

/** Opens a sealed file. Throws `WrongKeyError` when the key is wrong or a single bit was changed. */
export function open(keys: Keys, data: Uint8Array): { name: string; bytes: Buffer } {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (buffer.length < MAGIC.length + NONCE_BYTES + TAG_BYTES + 3 || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new WrongKeyError()
  const nonce = buffer.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES)
  const tag = buffer.subarray(buffer.length - TAG_BYTES)
  const sealed = buffer.subarray(MAGIC.length + NONCE_BYTES, buffer.length - TAG_BYTES)
  let plain: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', keys.enc, nonce)
    decipher.setAAD(MAGIC)
    decipher.setAuthTag(tag)
    plain = Buffer.concat([decipher.update(sealed), decipher.final()])
  } catch {
    throw new WrongKeyError()
  }
  const length = plain.readUInt16BE(1)
  if (plain.length < 3 + length) throw new WrongKeyError()
  const name = plain.subarray(3, 3 + length).toString('utf8')
  const body = plain.subarray(3 + length)
  return { name, bytes: plain[0] === 1 ? inflateRawSync(body, { maxOutputLength: MAX_INFLATED }) : body }
}

export function exportKeys(keys: Keys): { enc: string; name: string } {
  return { enc: keys.enc.toString('base64'), name: keys.name.toString('base64') }
}

export function importKeys(raw: unknown): Keys | null {
  if (raw === null || typeof raw !== 'object') return null
  const { enc, name } = raw as { enc?: unknown; name?: unknown }
  if (typeof enc !== 'string' || typeof name !== 'string') return null
  const keys = { enc: Buffer.from(enc, 'base64'), name: Buffer.from(name, 'base64') }
  return keys.enc.length === 32 && keys.name.length === 32 ? keys : null
}
