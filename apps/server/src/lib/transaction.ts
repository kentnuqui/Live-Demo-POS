import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from './prisma.js'

export type Tx = Prisma.TransactionClient

/**
 * Opens a transaction on the root client.
 * When a sync batch already holds a transaction, the same client is reused
 * so the batch stays all-or-nothing.
 */
export async function transaction<T>(db: PrismaClient | Tx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (db === prisma) {
    return prisma.$transaction((tx) => fn(tx))
  }
  return fn(db as Tx)
}

export function writer(db?: PrismaClient | Tx): PrismaClient | Tx {
  return db ?? prisma
}
