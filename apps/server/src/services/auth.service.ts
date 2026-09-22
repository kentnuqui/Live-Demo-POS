import bcrypt from 'bcryptjs'
import type { User } from '@prisma/client'
import type { AuthSessionDto } from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { hashToken, newRefreshToken, signAccessToken } from '../lib/tokens.js'
import { pinLookup } from '../lib/pin.js'
import { toUserDto } from '../lib/mappers.js'

async function issueSession(user: User): Promise<AuthSessionDto> {
  const refresh = newRefreshToken()
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt }
  })
  return {
    accessToken: signAccessToken(user),
    refreshToken: refresh.token,
    user: toUserDto(user)
  }
}

/** Email sign-in for managers and office staff. */
export async function login(email: string, password: string): Promise<AuthSessionDto> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user?.passwordHash || !user.isActive) {
    throw new AppError(401, 'Email or password is incorrect')
  }
  const matches = await bcrypt.compare(password, user.passwordHash)
  if (!matches) throw new AppError(401, 'Email or password is incorrect')
  return issueSession(user)
}

/** Floor sign-in. PINs are unique across the restaurant so the pad does not ask for a name. */
export async function loginWithPin(pin: string): Promise<AuthSessionDto> {
  const user = await prisma.user.findUnique({ where: { pinLookup: pinLookup(pin) } })
  if (!user?.isActive) throw new AppError(401, 'PIN is incorrect')
  return issueSession(user)
}

/** Rotates the refresh token so a stolen copy of the previous one cannot be reused. */
export async function refresh(refreshToken: string): Promise<AuthSessionDto> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: true }
  })
  if (!existing || existing.revokedAt || existing.expiresAt.getTime() < Date.now() || !existing.user.isActive) {
    throw new AppError(401, 'Session expired')
  }
  await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } })
  return issueSession(existing.user)
}

export async function logout(refreshToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() }
  })
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user?.isActive) throw new AppError(401, 'Sign in required')
  return toUserDto(user)
}
