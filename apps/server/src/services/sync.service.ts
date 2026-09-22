import { z } from 'zod'
import {
  addItemsSchema,
  canAccessBranch,
  discountSchema,
  layoutSchema,
  paymentSchema,
  refundSchema,
  orderCreateSchema,
  orderPatchSchema,
  reservationSchema,
  splitSchema,
  tableSchema,
  tableStatusSchema,
  transferSchema,
  type SyncOperationInput,
  type SyncPullDto,
  type SyncPushInput
} from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError, SyncOpError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { emitBranch } from '../lib/events.js'
import { getFloor } from './floor.service.js'
import { listMenu } from './menu.service.js'
import { advanceOrder, addItems, createOrder, patchOrder, sendOrder, voidItem } from './order.service.js'
import { applyDiscount, billOrder, finishOrder, mergeOrders, payOrder, refundOrder, splitOrder, transferOrder } from './order-actions.service.js'
import { createReservation } from './reservation.service.js'
import { createTable, saveLayout, setTableStatus } from './floor.service.js'
import { toBranchDto, toOrderDto, toPrinterDto, toProfileDto, toReservationDto, toSettingsDto } from '../lib/mappers.js'
import { orderInclude } from './order-support.js'
import type { Tx } from '../lib/transaction.js'

const uuid = z.string().uuid()

function read<T>(schema: z.ZodType<T>, payload: Record<string, unknown>, operationId: string): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new SyncOpError(operationId, 'Invalid operation')
  return parsed.data
}

async function apply(actor: AuthUser, op: SyncOperationInput, tx: Tx) {
  const ctx = { db: tx, silent: true as const }
  switch (op.kind) {
    case 'order.create':
      await createOrder(actor, op.branchId, read(orderCreateSchema, op.payload, op.operationId), ctx)
      return
    case 'order.addItems': {
      const body = read(addItemsSchema.extend({ orderId: uuid }), op.payload, op.operationId)
      await addItems(body.orderId, body, ctx)
      return
    }
    case 'order.patch': {
      const body = read(orderPatchSchema.extend({ orderId: uuid }), op.payload, op.operationId)
      await patchOrder(body.orderId, body, ctx)
      return
    }
    case 'order.voidItem': {
      const body = read(z.object({ orderId: uuid, itemId: uuid }), op.payload, op.operationId)
      await voidItem(body.orderId, body.itemId, ctx)
      return
    }
    case 'order.send': {
      const body = read(z.object({ orderId: uuid }), op.payload, op.operationId)
      await sendOrder(body.orderId, ctx)
      return
    }
    case 'order.progress': {
      const body = read(
        z.object({ orderId: uuid, status: z.enum(['PREPARING', 'READY', 'SERVED']) }),
        op.payload,
        op.operationId
      )
      await advanceOrder(body.orderId, body.status, ctx)
      return
    }
    case 'order.transfer': {
      const body = read(transferSchema.extend({ orderId: uuid }), op.payload, op.operationId)
      await transferOrder(actor, body.orderId, body.tableId, ctx)
      return
    }
    case 'order.merge': {
      const body = read(z.object({ orderId: uuid, sourceOrderId: uuid }), op.payload, op.operationId)
      await mergeOrders(body.orderId, body.sourceOrderId, ctx)
      return
    }
    case 'order.split': {
      const body = read(splitSchema.extend({ orderId: uuid }), op.payload, op.operationId)
      await splitOrder(actor, body.orderId, body, ctx)
      return
    }
    case 'order.bill': {
      const body = read(z.object({ orderId: uuid }), op.payload, op.operationId)
      await billOrder(body.orderId, ctx)
      return
    }
    case 'order.discount': {
      const raw = read(z.object({ orderId: uuid }).passthrough(), op.payload, op.operationId)
      const discount = discountSchema.safeParse(raw)
      if (!discount.success) throw new SyncOpError(op.operationId, 'Invalid operation')
      await applyDiscount(raw.orderId, discount.data, ctx)
      return
    }
    case 'order.pay': {
      const body = read(paymentSchema.extend({ orderId: uuid }), op.payload, op.operationId)
      await payOrder(actor, body.orderId, body, ctx)
      return
    }
    case 'order.refund': {
      const body = read(refundSchema.extend({ orderId: uuid }), op.payload, op.operationId)
      await refundOrder(actor, body.orderId, body, ctx)
      return
    }
    case 'order.finish': {
      const body = read(z.object({ orderId: uuid }), op.payload, op.operationId)
      await finishOrder(body.orderId, ctx)
      return
    }
    case 'table.layout':
      await saveLayout(op.branchId, read(layoutSchema, op.payload, op.operationId), ctx)
      return
    case 'table.create':
      await createTable(op.branchId, read(tableSchema, op.payload, op.operationId), ctx)
      return
    case 'table.status': {
      const body = read(tableStatusSchema.extend({ tableId: uuid }), op.payload, op.operationId)
      await setTableStatus(op.branchId, body.tableId, body.status, ctx)
      return
    }
    case 'reservation.create':
      await createReservation(op.branchId, read(reservationSchema, op.payload, op.operationId), ctx)
      return
    default:
      throw new SyncOpError(op.operationId, 'Unknown operation')
  }
}

/**
 * Applies an offline batch in one transaction.
 * Replaying the same batch is safe: each operation recognizes its own id.
 * If one operation fails, none of the batch is saved.
 */
export async function pushSync(actor: AuthUser, input: SyncPushInput) {
  await prisma.$transaction(
    async (tx) => {
      for (const op of input.operations) {
        if (!canAccessBranch(actor.role, actor.branchId, op.branchId)) {
          throw new SyncOpError(op.operationId, 'Outside your branch')
        }
        try {
          await apply(actor, op, tx)
        } catch (error) {
          if (error instanceof SyncOpError) throw error
          if (error instanceof AppError) throw new SyncOpError(op.operationId, error.message)
          throw error
        }
      }
    },
    { timeout: 20_000 }
  )

  const branches = [...new Set(input.operations.map((op) => op.branchId))]
  for (const branchId of branches) emitBranch(branchId, 'sync.applied', {})
  return {
    accepted: input.operations.length,
    conflicts: [],
    serverTime: new Date().toISOString()
  }
}

/** Changes since a timestamp, grouped so a terminal can replace its local cache. */
export async function pullSync(actor: AuthUser, branchId: string, lastSyncTimestamp?: string): Promise<SyncPullDto> {
  if (!canAccessBranch(actor.role, actor.branchId, branchId)) {
    throw new AppError(403, 'Outside your branch')
  }
  const since = lastSyncTimestamp ? new Date(lastSyncTimestamp) : new Date(0)
  if (Number.isNaN(since.getTime())) throw new AppError(400, 'Invalid timestamp')

  const [branch, profile, settings, printers, orders, reservations, deleted, tableChanges, menuChanges] =
    await Promise.all([
      prisma.branch.findUnique({ where: { id: branchId } }),
      prisma.restaurantProfile.findFirst({ orderBy: { createdAt: 'asc' } }),
      prisma.branchSettings.findUnique({ where: { branchId } }),
      prisma.printer.findMany({ where: { branchId, updatedAt: { gt: since } } }),
      prisma.order.findMany({ where: { branchId, updatedAt: { gt: since } }, include: orderInclude }),
      prisma.reservation.findMany({
        where: { branchId, updatedAt: { gt: since } },
        include: { table: { select: { label: true } } }
      }),
      prisma.tombstone.findMany({ where: { branchId, deletedAt: { gt: since } } }),
      prisma.diningTable.count({ where: { branchId, updatedAt: { gt: since } } }),
      prisma.menuCategory.count({
        where: {
          branchId,
          OR: [{ updatedAt: { gt: since } }, { items: { some: { updatedAt: { gt: since } } } }]
        }
      })
    ])

  if (!branch) throw new AppError(404, 'Branch not found')
  const floorChanged = tableChanges > 0 || deleted.some((row) => row.entity === 'table') || since.getTime() === 0
  const menuDeleted = deleted.some((row) => row.entity === 'menuCategory' || row.entity === 'menuItem')
  const menuUpdated = menuChanges > 0 || menuDeleted || since.getTime() === 0

  return {
    serverTime: new Date().toISOString(),
    branches: branch.updatedAt > since ? [toBranchDto(branch)] : [],
    profile: profile && profile.updatedAt > since ? toProfileDto(profile) : null,
    settings: settings && settings.updatedAt > since ? toSettingsDto(settings) : null,
    printers: printers.map(toPrinterDto),
    floorPlans: floorChanged ? await getFloor(branchId) : [],
    menu: menuUpdated ? await listMenu(branchId) : [],
    menuUpdated,
    orders: orders.map(toOrderDto),
    reservations: reservations.map(toReservationDto),
    deleted: deleted.map((row) => ({
      entity: row.entity,
      entityId: row.entityId,
      deletedAt: row.deletedAt.toISOString()
    }))
  }
}
