import { Prisma, type MenuStation } from '@prisma/client'
import {
  allocateCancellation,
  firedCount,
  formatKitchenLines,
  type KitchenStatus,
  type KitchenSubmissionKind,
  type KitchenTicketDto
} from '@towns/shared'
import { newId } from './order-support.js'
import type { Tx } from '../lib/transaction.js'

export const submissionInclude = {
  items: {
    include: { modifiers: { orderBy: { createdAt: 'asc' as const } } },
    orderBy: { createdAt: 'asc' as const }
  },
  order: {
    include: {
      table: { select: { label: true } },
      server: { select: { firstName: true, lastName: true } }
    }
  }
} satisfies Prisma.KitchenSubmissionInclude

export type KitchenSubmissionRow = Prisma.KitchenSubmissionGetPayload<{ include: typeof submissionInclude }>

export interface SubmissionLine {
  id: string
  name: string
  quantity: number
  notes: string
  station: MenuStation
  modifiers: Array<{ name: string; priceCents: number }>
}

interface FiredOrder {
  id: string
  branchId: string
  serverId: string | null
  kitchenStatus: KitchenStatus | null
  kitchenStartedAt: Date | null
  kitchenCompletedAt: Date | null
  items: Array<{
    id: string
    name: string
    quantity: number
    notes: string
    station: MenuStation
    voided: boolean
    firedQuantity: number
    sentAt: Date | null
    modifiers: Array<{ modifierName: string; priceCents: number }>
  }>
}

/** Names the person on the audit line. Missing staff stay readable. */
export async function staffName(tx: Tx, actorId?: string | null): Promise<string> {
  if (!actorId) return 'Staff'
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true } })
  if (!user) return 'Staff'
  const name = `${user.firstName} ${user.lastName}`.trim()
  return name || 'Staff'
}

/** Appends one dispute line for a firing, an addition, or a cancellation. */
export async function recordOrderEvent(
  tx: Tx,
  order: { id: string; branchId: string },
  kind: 'ITEMS_ADDED' | 'ITEMS_SENT' | 'ITEMS_CANCELLED' | 'ORDER_CANCELLED',
  actorId: string | null | undefined,
  summary: string
): Promise<void> {
  await tx.orderEvent.create({
    data: {
      id: newId(),
      orderId: order.id,
      branchId: order.branchId,
      kind,
      actorId: actorId ?? null,
      summary
    }
  })
}

export async function describeAction(
  tx: Tx,
  actorId: string | null | undefined,
  verb: 'added' | 'sent' | 'cancelled',
  lines: ReadonlyArray<{ name: string; quantity: number }>
): Promise<string> {
  const name = await staffName(tx, actorId)
  return `${name} ${verb} ${formatKitchenLines(lines)}`
}

/**
 * Checks already on the pass before submissions existed get one initial firing.
 * The snapshot uses the fired quantity, so unsent food is not copied onto that ticket.
 */
export async function ensureInitialSubmission(tx: Tx, order: FiredOrder): Promise<void> {
  const existing = await tx.kitchenSubmission.count({ where: { orderId: order.id } })
  if (existing > 0 || !order.kitchenStatus) return
  const lines = firedLines(order)
  if (lines.length === 0) return
  await tx.kitchenSubmission.create({
    data: {
      id: newId(),
      orderId: order.id,
      branchId: order.branchId,
      sequence: 1,
      kind: 'INITIAL',
      kitchenStatus: order.kitchenStatus,
      startedAt: order.kitchenStartedAt ?? new Date(),
      completedAt: order.kitchenCompletedAt,
      sentById: order.serverId,
      items: { create: lines.map(lineData) }
    }
  })
}

/** Creates the initial firing for every open pass that predates submissions. Safe to run twice. */
export async function backfillBranchTickets(tx: Tx, branchId: string): Promise<void> {
  const missing = await tx.order.findMany({
    where: { branchId, kitchenStatus: { not: null }, submissions: { none: {} }, status: { not: 'CANCELLED' } },
    include: {
      items: { include: { modifiers: { orderBy: { createdAt: 'asc' } } } }
    }
  })
  for (const order of missing) {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`
    const again = await tx.kitchenSubmission.count({ where: { orderId: order.id } })
    if (again > 0) continue
    await ensureInitialSubmission(tx, order)
  }
}

/** Stores one firing. The caller has already locked the order and chosen only the unsent lines. */
export async function createKitchenSubmission(
  tx: Tx,
  input: {
    orderId: string
    branchId: string
    sequence: number
    kind: KitchenSubmissionKind
    now: Date
    actorId?: string | null
    idempotencyKey?: string | null
    lines: SubmissionLine[]
  }
): Promise<KitchenSubmissionRow> {
  return tx.kitchenSubmission.create({
    data: {
      id: newId(),
      orderId: input.orderId,
      branchId: input.branchId,
      sequence: input.sequence,
      kind: input.kind,
      kitchenStatus: 'NEW',
      startedAt: input.now,
      sentById: input.actorId ?? null,
      idempotencyKey: input.idempotencyKey || null,
      items: { create: input.lines.map(lineData) }
    },
    include: submissionInclude
  })
}

export async function findSubmissionByKey(tx: Tx, idempotencyKey: string): Promise<KitchenSubmissionRow | null> {
  return tx.kitchenSubmission.findUnique({ where: { idempotencyKey }, include: submissionInclude })
}

/**
 * Reduces already-fired food on the newest firing first.
 * The check quantity is changed by the caller. This only tells the pass what to stop cooking.
 */
export async function cancelFiredQuantity(tx: Tx, orderItemId: string, amount: number): Promise<void> {
  if (amount <= 0) return
  const rows = await tx.kitchenSubmissionItem.findMany({
    where: { orderItemId },
    orderBy: { createdAt: 'desc' }
  })
  const next = allocateCancellation(rows, orderItemId, amount)
  for (const row of next) {
    const previous = rows.find((item) => item.id === row.id)
    if (!previous || previous.cancelledQuantity === row.cancelledQuantity) continue
    await tx.kitchenSubmissionItem.update({
      where: { id: row.id },
      data: { cancelledQuantity: row.cancelledQuantity }
    })
  }
}

/** What the pass should show for one firing. Payments and unsent food stay off it. */
export function toKitchenTicket(row: KitchenSubmissionRow): KitchenTicketDto | null {
  if (row.order.ticketNumber == null) return null
  const items = row.items.flatMap((item) => {
    const remaining = item.quantity - item.cancelledQuantity
    if (remaining <= 0 && item.cancelledQuantity <= 0) return []
    return [
      {
        id: item.id,
        name: item.name,
        quantity: Math.max(0, remaining),
        cancelledQuantity: item.cancelledQuantity,
        notes: item.notes,
        modifiers: item.modifiers.map((modifier) => ({ id: modifier.id, name: modifier.name }))
      }
    ]
  })
  if (items.length === 0) return null
  const serverName = row.order.server ? `${row.order.server.firstName} ${row.order.server.lastName}` : null
  return {
    id: row.id,
    orderId: row.orderId,
    ticketNumber: row.order.ticketNumber,
    sequence: row.sequence,
    kind: row.kind,
    type: row.order.type,
    kitchenStatus: row.kitchenStatus,
    tableLabel: row.order.table?.label ?? null,
    guestName: row.order.guestName,
    serverName,
    deliveryAddress: row.order.deliveryAddress,
    notes: row.order.notes,
    startedAt: row.startedAt.toISOString(),
    items
  }
}

export function sentUnits(row: { items: Array<{ quantity: number }> }): number {
  return row.items.reduce((sum, item) => sum + item.quantity, 0)
}

function firedLines(order: FiredOrder): SubmissionLine[] {
  return order.items.flatMap((item) => {
    if (item.voided) return []
    const quantity = firedCount(item)
    if (quantity <= 0) return []
    return [
      {
        id: item.id,
        name: item.name,
        quantity,
        notes: item.notes,
        station: item.station,
        modifiers: item.modifiers.map((modifier) => ({ name: modifier.modifierName, priceCents: modifier.priceCents }))
      }
    ]
  })
}

function lineData(line: SubmissionLine) {
  return {
    id: newId(),
    orderItemId: line.id,
    name: line.name,
    quantity: line.quantity,
    notes: line.notes,
    station: line.station,
    modifiers: {
      create: line.modifiers.map((modifier) => ({
        id: newId(),
        name: modifier.name,
        priceCents: modifier.priceCents
      }))
    }
  }
}
