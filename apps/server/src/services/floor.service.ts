import { randomBytes, randomUUID } from 'node:crypto'
import { OPEN_ORDER_STATUSES, type LayoutInput, type TableInput } from '@towns/shared'
import type { FloorPlanDto } from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { context, publish, type ServiceContext } from '../lib/context.js'
import { toFloorTable } from '../lib/mappers.js'
import { transaction, type Tx } from '../lib/transaction.js'

const HOLD_BEFORE_MS = 2 * 60 * 60 * 1000
const HOLD_AFTER_MS = 30 * 60 * 1000

/** A confirmed reservation holds the table from two hours before until thirty minutes after. */
export function reservationHoldsTable(reservedAt: Date, now = Date.now()): boolean {
  const delta = reservedAt.getTime() - now
  return delta <= HOLD_BEFORE_MS && delta >= -HOLD_AFTER_MS
}

/**
 * Recomputes a table's status from open checks and upcoming reservations.
 * Cleaning is left alone until a person marks the table available.
 */
export async function reconcileTable(tx: Tx, tableId: string): Promise<void> {
  const table = await tx.diningTable.findUnique({ where: { id: tableId } })
  if (!table) return

  const open = await tx.order.findFirst({
    where: { tableId, status: { in: [...OPEN_ORDER_STATUSES] } },
    orderBy: { createdAt: 'desc' }
  })
  if (open) {
    await tx.diningTable.update({
      where: { id: tableId },
      data: { status: open.status === 'BILLING' ? 'BILLING' : 'OCCUPIED' }
    })
    return
  }

  const reservations = await tx.reservation.findMany({
    where: { tableId, status: { in: ['CONFIRMED', 'PENDING'] } }
  })
  if (reservations.some((row) => reservationHoldsTable(row.reservedAt))) {
    await tx.diningTable.update({ where: { id: tableId }, data: { status: 'RESERVED' } })
    return
  }

  if (table.status === 'CLEANING') return
  if (table.status !== 'AVAILABLE') {
    await tx.diningTable.update({ where: { id: tableId }, data: { status: 'AVAILABLE' } })
  }
}

/**
 * Frees a table after the party leaves it.
 * Another open check keeps the table seated. A nearby reservation keeps it reserved.
 * Otherwise it goes to cleaning so the next party is not seated on a dirty table.
 */
export async function releaseTable(tx: Tx, tableId: string | null): Promise<void> {
  if (!tableId) return
  const stillOpen = await tx.order.findFirst({
    where: { tableId, status: { in: [...OPEN_ORDER_STATUSES] } }
  })
  if (stillOpen) {
    await reconcileTable(tx, tableId)
    return
  }
  const reservations = await tx.reservation.findMany({
    where: { tableId, status: { in: ['CONFIRMED', 'PENDING'] } }
  })
  if (reservations.some((row) => reservationHoldsTable(row.reservedAt))) {
    await tx.diningTable.update({ where: { id: tableId }, data: { status: 'RESERVED' } })
    return
  }
  await tx.diningTable.update({ where: { id: tableId }, data: { status: 'CLEANING' } })
}

/** Floor plans, table geometry, the live check, and the next reservation. */
export async function getFloor(branchId: string): Promise<FloorPlanDto[]> {
  const [plans, settings] = await Promise.all([
    prisma.floorPlan.findMany({
      where: { branchId },
      include: { tables: { orderBy: { label: 'asc' } } },
      orderBy: { name: 'asc' }
    }),
    prisma.branchSettings.findUnique({ where: { branchId } })
  ])
  const tableIds = plans.flatMap((plan) => plan.tables.map((table) => table.id))
  if (tableIds.length === 0) {
    return plans.map((plan) => ({
      id: plan.id,
      branchId: plan.branchId,
      name: plan.name,
      isDefault: plan.isDefault,
      tables: []
    }))
  }

  const [orders, reservations, tokens] = await Promise.all([
    prisma.order.findMany({
      where: { tableId: { in: tableIds }, status: { in: [...OPEN_ORDER_STATUSES] } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.reservation.findMany({
      where: { tableId: { in: tableIds }, status: { in: ['CONFIRMED', 'PENDING'] } },
      orderBy: { reservedAt: 'asc' }
    }),
    prisma.qrToken.findMany({ where: { tableId: { in: tableIds }, isActive: true } })
  ])

  const currency = settings?.currency ?? 'USD'
  return plans.map((plan) => ({
    id: plan.id,
    branchId: plan.branchId,
    name: plan.name,
    isDefault: plan.isDefault,
    tables: plan.tables.map((table) => {
      const openHere = orders.filter((order) => order.tableId === table.id)
      const active = openHere[0]
      const upcoming = reservations.find(
        (row) => row.tableId === table.id && row.reservedAt.getTime() > Date.now() - HOLD_AFTER_MS
      )
      const qr = tokens.find((token) => token.tableId === table.id) ?? null
      return toFloorTable({
        table,
        qr,
        openOrderCount: openHere.length,
        activeOrder: active
          ? {
              id: active.id,
              status: active.status,
              progress: active.progress,
              guestCount: active.guestCount,
              guestName: active.guestName,
              totalCents: active.totalCents,
              currency: active.currency || currency,
              openedAt: active.createdAt.toISOString()
            }
          : null,
        nextReservation: upcoming
          ? {
              id: upcoming.id,
              guestName: upcoming.guestName,
              guestCount: upcoming.guestCount,
              reservedAt: upcoming.reservedAt.toISOString(),
              type: upcoming.type
            }
          : null
      })
    })
  }))
}

function defaultSize(shape: TableInput['shape']): { width: number; height: number } {
  if (shape === 'BAR') return { width: 22, height: 12 }
  if (shape === 'ROUND') return { width: 14, height: 16 }
  if (shape === 'RECTANGLE') return { width: 18, height: 14 }
  return { width: 14, height: 16 }
}

/** Adds a table and a guest QR token. Layout editing is a separate, lighter write. */
export async function createTable(branchId: string, input: TableInput, ctx?: Partial<ServiceContext>) {
  const current = context(ctx)
  const plan = await current.db.floorPlan.findFirst({ where: { branchId, isDefault: true } })
  if (!plan) throw new AppError(404, 'Floor plan not found')
  const size = defaultSize(input.shape)
  const table = await current.db.diningTable.create({
    data: {
      branchId,
      floorPlanId: plan.id,
      label: input.label.trim(),
      zone: input.zone,
      shape: input.shape,
      seats: input.seats,
      posX: input.posX ?? 8,
      posY: input.posY ?? 8,
      width: input.width ?? size.width,
      height: input.height ?? size.height,
      id: input.id,
      qrTokens: {
        create: {
          branchId,
          token: randomBytes(9).toString('base64url')
        }
      }
    }
  })
  publish(current, branchId, 'floor.updated', { tableId: table.id })
  return table.id
}

/** Persists drag positions. One write per table, inside a single transaction. */
export async function saveLayout(branchId: string, input: LayoutInput, ctx?: Partial<ServiceContext>) {
  const current = context(ctx)
  await transaction(current.db, async (tx) => {
    const ids = input.tables.map((table) => table.id)
    const found = await tx.diningTable.findMany({ where: { id: { in: ids }, branchId }, select: { id: true } })
    if (found.length !== ids.length) throw new AppError(404, 'A table is not on this floor')
    for (const table of input.tables) {
      await tx.diningTable.update({
        where: { id: table.id },
        data: { posX: table.posX, posY: table.posY, width: table.width, height: table.height }
      })
    }
  })
  publish(current, branchId, 'floor.updated')
}

/** Staff release a table after cleaning, or send it back to cleaning. */
export async function setTableStatus(
  branchId: string,
  tableId: string,
  status: 'AVAILABLE' | 'CLEANING',
  ctx?: Partial<ServiceContext>
) {
  const current = context(ctx)
  const table = await current.db.diningTable.findFirst({ where: { id: tableId, branchId } })
  if (!table) throw new AppError(404, 'Table not found')
  const open = await current.db.order.findFirst({
    where: { tableId, status: { in: [...OPEN_ORDER_STATUSES] } }
  })
  if (open) throw new AppError(409, 'This table still has an open check')
  await current.db.diningTable.update({ where: { id: tableId }, data: { status } })
  if (status === 'AVAILABLE') {
    await transaction(current.db, async (tx) => {
      await reconcileTable(tx, tableId)
    })
  }
  publish(current, branchId, 'floor.updated', { tableId })
}

export async function deleteTable(branchId: string, tableId: string) {
  const table = await prisma.diningTable.findFirst({ where: { id: tableId, branchId } })
  if (!table) throw new AppError(404, 'Table not found')
  if (table.status !== 'AVAILABLE') throw new AppError(409, 'Only an available table can be removed')
  await prisma.$transaction(async (tx) => {
    await tx.tombstone.create({ data: { id: randomUUID(), branchId, entity: 'table', entityId: tableId } })
    await tx.diningTable.delete({ where: { id: tableId } })
  })
  publish(context(), branchId, 'floor.updated', { tableId })
}
