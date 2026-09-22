import { createHash } from 'node:crypto'
import { env } from '../config/env.js'

/**
 * Lookup key for a PIN. The raw PIN is never stored.
 * SHA-256 with a server pepper lets us find the staff member without scanning every hash.
 */
export function pinLookup(pin: string): string {
  return createHash('sha256').update(`${env.PIN_PEPPER}:${pin}`).digest('hex')
}
