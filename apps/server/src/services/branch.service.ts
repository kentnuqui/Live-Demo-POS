import type { BranchInput } from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { toBranchDto } from '../lib/mappers.js'
import { transaction } from '../lib/transaction.js'

/** Branches the signed-in person is allowed to operate. */
export async function listBranches(actor: AuthUser) {
  const branches = await prisma.branch.findMany({
    where: actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN' ? {} : { id: actor.branchId ?? 'none' },
    orderBy: { name: 'asc' }
  })
  return branches.map(toBranchDto)
}

/** Opens a branch with empty settings and a blank floor so the rest of the app has a place to write. */
export async function createBranch(input: BranchInput) {
  return transaction(prisma, async (tx) => {
    const branch = await tx.branch.create({
      data: {
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        address: input.address?.trim() ?? '',
        city: input.city?.trim() ?? '',
        phone: input.phone?.trim() ?? '',
        timezone: input.timezone?.trim() || 'Asia/Tokyo',
        isActive: input.isActive ?? true,
        settings: { create: {} },
        floorPlans: { create: { name: 'Main floor', isDefault: true } }
      }
    })
    return toBranchDto(branch)
  })
}

export async function updateBranch(branchId: string, input: BranchInput) {
  const existing = await prisma.branch.findUnique({ where: { id: branchId } })
  if (!existing) throw new AppError(404, 'Branch not found')
  const branch = await prisma.branch.update({
    where: { id: branchId },
    data: {
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      address: input.address?.trim(),
      city: input.city?.trim(),
      phone: input.phone?.trim(),
      timezone: input.timezone?.trim(),
      isActive: input.isActive
    }
  })
  return toBranchDto(branch)
}
