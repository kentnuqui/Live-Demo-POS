import { randomUUID } from 'node:crypto'
import type { OrderStatus, Prisma } from '@prisma/client'
import { OPEN_ORDER_STATUSES, priceItems, type DiningProgress } from '@towns/shared'
import type { OrderDto } from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { toOrderDto } from '../lib/mappers.js'
import type { Tx } from '../lib/transaction.js'

export const orderInclude = {
  items: { 
    include: {
      modifiers: { orderBy: { createdAt: 'asc' as const } }
    },
    orderBy: { createdAt: 'asc' as const } 
  },
  payments: { orderBy: { createdAt: 'asc' as const } },
  refunds: { orderBy: { createdAt: 'asc' as const } },
  table: { select: { id: true, label: true } },
  server: { select: { id: true, firstName: true, lastName: true } }
} satisfies Prisma.OrderInclude

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>

export async function loadOrder(tx: Tx, orderId: string): Promise<OrderRow> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: orderInclude })
  if (!order) throw new AppError(404, 'Order not found')
  return order
}

export function present(order: OrderRow): OrderDto {
  return toOrderDto(order)
}

export function assertMutable(status: OrderStatus): void {
  if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'BILLING') {
    throw new AppError(409, 'This check can no longer be changed')
  }
  if (!OPEN_ORDER_STATUSES.includes(status)) {
    throw new AppError(409, 'This check can no longer be changed')
  }
}

export function progressFor(status: OrderStatus): DiningProgress {
  switch (status) {
    case 'OPEN':
      return 'SEATED'
    case 'SENT':
      return 'ORDERED'
    case 'PREPARING':
      return 'PREPARING'
    case 'READY':
    case 'SERVED':
      return 'SERVED'
    case 'BILLING':
      return 'BILLING'
    case 'COMPLETED':
    case 'CANCELLED':
      return 'COMPLETED'
    default:
      return 'SEATED'
  }
}

/** Rewrites totals from the current items and the branch tax settings. */
export async function recalculate(tx: Tx, orderId: string): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } })
  const settings = await tx.branchSettings.findUniqueOrThrow({ where: { branchId: order.branchId } })
  const priced = priceItems(order.items, settings, { kind: order.discountKind, value: order.discountValue })
  await tx.order.update({
    where: { id: orderId },
    data: {
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      serviceChargeCents: priced.serviceChargeCents,
      totalCents: priced.totalCents
    }
  })
}

export function newId(id?: string): string {
  return id ?? randomUUID()
}
