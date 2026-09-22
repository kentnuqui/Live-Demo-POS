import type { PrismaClient } from '@prisma/client'
import { prisma } from './prisma.js'
import type { Tx } from './transaction.js'
import { emitBranch } from './events.js'

export interface ServiceContext {
  db: PrismaClient | Tx
  silent?: boolean
  /** Split bills stay on a table that is already occupied, so the seat lock is skipped. */
  skipTableClaim?: boolean
}

export function context(partial?: Partial<ServiceContext>): ServiceContext {
  return {
    db: partial?.db ?? prisma,
    silent: partial?.silent ?? false,
    skipTableClaim: partial?.skipTableClaim ?? false
  }
}

export function publish(ctx: ServiceContext, branchId: string, event: string, data: unknown = {}): void {
  if (ctx.silent) return
  emitBranch(branchId, event, data)
}
