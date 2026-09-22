import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { canAssignRole, type UserCreateInput, type UserUpdateInput } from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { pinLookup } from '../lib/pin.js'
import { toUserDto } from '../lib/mappers.js'

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function assertActorMayEdit(actor: AuthUser, targetBranchId: string | null): void {
  if (actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN') return
  if (!targetBranchId || actor.branchId !== targetBranchId) {
    throw new AppError(403, 'Outside your branch')
  }
}

/** Staff directory. Managers see their branch. Admins see the company. */
export async function listUsers(actor: AuthUser) {
  const users = await prisma.user.findMany({
    where: actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN' ? {} : { branchId: actor.branchId },
    orderBy: [{ role: 'asc' }, { firstName: 'asc' }]
  })
  return users.map(toUserDto)
}

/** Creates a staff account. Email and PIN can both be set; at least one sign-in method is required. */
export async function createUser(actor: AuthUser, input: UserCreateInput) {
  const email = clean(input.email)?.toLowerCase()
  const password = clean(input.password)
  const pin = clean(input.pin)
  if (!email && !pin) throw new AppError(400, 'Add an email or a PIN')
  if (email && !password) throw new AppError(400, 'Email sign-in needs a password')
  if (!canAssignRole(actor.role, input.role)) throw new AppError(403, 'You cannot grant that role')

  const branchId = input.branchId ?? null
  const needsBranch = input.role !== 'SUPER_ADMIN' && input.role !== 'ADMIN'
  if (needsBranch && !branchId) throw new AppError(400, 'Choose a branch')
  if (!needsBranch && branchId) throw new AppError(400, 'Company admins are not tied to one branch')
  if (actor.role === 'RESTAURANT_MANAGER' && branchId !== actor.branchId) {
    throw new AppError(403, 'Outside your branch')
  }
  if (branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } })
    if (!branch) throw new AppError(404, 'Branch not found')
  }

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: password ? await bcrypt.hash(password, 10) : null,
        pinLookup: pin ? pinLookup(pin) : null,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        role: input.role,
        branchId
      }
    })
    return toUserDto(user)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'That email or PIN is already in use')
    }
    throw error
  }
}

/** Updates staff. Blank password or PIN leaves the current secret in place. */
export async function updateUser(actor: AuthUser, userId: string, input: UserUpdateInput) {
  const existing = await prisma.user.findUnique({ where: { id: userId } })
  if (!existing) throw new AppError(404, 'Staff member not found')
  assertActorMayEdit(actor, existing.branchId)
  if (input.role && !canAssignRole(actor.role, input.role)) {
    throw new AppError(403, 'You cannot grant that role')
  }
  if (userId === actor.id && input.role && input.role !== existing.role) {
    throw new AppError(400, 'Ask another admin to change your role')
  }

  const email = input.email === undefined ? undefined : clean(input.email)?.toLowerCase() ?? null
  const password = clean(input.password)
  const pin = clean(input.pin)
  const nextRole = input.role ?? existing.role
  const nextBranch = input.branchId === undefined ? existing.branchId : input.branchId
  const needsBranch = nextRole !== 'SUPER_ADMIN' && nextRole !== 'ADMIN'
  if (needsBranch && !nextBranch) throw new AppError(400, 'Choose a branch')
  if (actor.role === 'RESTAURANT_MANAGER' && nextBranch !== actor.branchId) {
    throw new AppError(403, 'Outside your branch')
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        email,
        firstName: input.firstName?.trim(),
        lastName: input.lastName?.trim(),
        role: input.role,
        branchId: input.branchId,
        isActive: input.isActive,
        passwordHash: password ? await bcrypt.hash(password, 10) : undefined,
        pinLookup: pin ? pinLookup(pin) : undefined
      }
    })
    return toUserDto(user)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'That email or PIN is already in use')
    }
    throw error
  }
}

/** Soft-deactivates a staff account so historical checks keep their server name. */
export async function deactivateUser(actor: AuthUser, userId: string) {
  if (actor.id === userId) throw new AppError(400, 'You cannot deactivate yourself')
  const existing = await prisma.user.findUnique({ where: { id: userId } })
  if (!existing) throw new AppError(404, 'Staff member not found')
  assertActorMayEdit(actor, existing.branchId)
  if (!canAssignRole(actor.role, existing.role) && actor.role !== existing.role) {
    throw new AppError(403, 'You cannot change that account')
  }
  const user = await prisma.user.update({ where: { id: userId }, data: { isActive: false } })
  return toUserDto(user)
}
