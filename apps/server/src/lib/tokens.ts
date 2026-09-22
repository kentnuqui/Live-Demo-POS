import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import type { UserRole } from '@towns/shared'

export interface AccessClaims {
  sub: string
  role: UserRole
  branchId: string | null
  typ: 'access'
}

const ACCESS_TTL = '15m'
const REFRESH_DAYS = 30

export function signAccessToken(user: { id: string; role: UserRole; branchId: string | null }): string {
  const claims: AccessClaims = {
    sub: user.id,
    role: user.role,
    branchId: user.branchId,
    typ: 'access'
  }
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL })
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET)
  if (typeof payload === 'string' || payload.typ !== 'access' || typeof payload.sub !== 'string') {
    throw new Error('Invalid access token')
  }
  return payload as AccessClaims
}

export function newRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(48).toString('base64url')
  const hash = hashToken(token)
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000)
  return { token, hash, expiresAt }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
