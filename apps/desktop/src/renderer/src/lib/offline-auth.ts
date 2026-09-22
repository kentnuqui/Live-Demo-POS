import type { UserDto } from '@towns/shared'
import { localDb } from './local-db'

interface OfflineRecord {
  salt: string
  hash: string
  user: UserDto
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 120_000, hash: 'SHA-256' },
    key,
    256
  )
  return bytesToHex(bits)
}

/** Remembers a successful PIN on this terminal so the floor can open with the server down. */
export async function rememberPin(pin: string, user: UserDto): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(pin, salt)
  const record: OfflineRecord = { salt: bytesToHex(salt.buffer), hash, user }
  await localDb.kvSet('offline-auth', JSON.stringify(record))
}

export async function unlockOffline(pin: string): Promise<UserDto | null> {
  const raw = await localDb.kvGet('offline-auth')
  if (!raw) return null
  const record = JSON.parse(raw) as OfflineRecord
  const salt = new Uint8Array(record.salt.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? [])
  const hash = await derive(pin, salt)
  if (hash !== record.hash) return null
  return record.user
}

export async function cachedUser(): Promise<UserDto | null> {
  const raw = await localDb.kvGet('offline-auth')
  if (!raw) return null
  return (JSON.parse(raw) as OfflineRecord).user
}
