import {
  aggregateKitchenStatus,
  KITCHEN_STATUS_STEP,
  serviceStatusForKitchen,
  type KitchenBoardDto,
  type KitchenStatus,
  type KitchenTicketDto
} from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { context, publish } from '../lib/context.js'
import { todayInTimeZone, zonedDayRange } from '../lib/day.js'
import { prisma } from '../lib/prisma.js'
import { transaction, type Tx } from '../lib/transaction.js'
import { backfillBranchTickets, submissionInclude, toKitchenTicket, type KitchenSubmissionRow } from './kitchen-submission.service.js'

/**
 * Opens a ticket the first time a check is fired, and brings it back if the pass already finished it.
 * A later addition while the ticket is still up does not reset the pass.
 * Check status, totals, and payments are not part of this patch.
 */
export async function kitchenOpenPatch(
  tx: Tx,
  order: { branchId: string; kitchenStatus: KitchenStatus | null; ticketNumber: number | null },
  now: Date
): Promise<{ kitchenStatus: 'NEW'; kitchenStartedAt: Date; kitchenCompletedAt: null; ticketNumber: number; serviceStatus: null } | Record<string, never>> {
  if (order.kitchenStatus && order.kitchenStatus !== 'COMPLETED') return {}
  const ticketNumber = order.ticketNumber ?? (await nextTicketNumber(tx, order.branchId))
  return {
    kitchenStatus: 'NEW',
    kitchenStartedAt: now,
    kitchenCompletedAt: null,
    ticketNumber,
    serviceStatus: null
  }
}

/**
 * Rewrites the parent pass from every firing on the check.
 * Ready to serve only when every firing is done. A new addition pulls a finished pass back.
 */
export async function syncOrderPass(tx: Tx, orderId: string): Promise<void> {
  const [order, submissions] = await Promise.all([
    tx.order.findUnique({ where: { id: orderId }, select: { status: true, kitchenCompletedAt: true } }),
    tx.kitchenSubmission.findMany({ where: { orderId }, select: { kitchenStatus: true } })
  ])
  if (!order) return
  const kitchenStatus = aggregateKitchenStatus(submissions.map((row) => row.kitchenStatus))
  if (!kitchenStatus) return
  const finished = kitchenStatus === 'COMPLETED'
  const keepService = order.status === 'COMPLETED' || order.status === 'CANCELLED'
  const serviceStatus = keepService ? undefined : serviceStatusForKitchen(kitchenStatus)
  await tx.order.update({
    where: { id: orderId },
    data: {
      kitchenStatus,
      kitchenCompletedAt: finished ? (order.kitchenCompletedAt ?? new Date()) : null,
      ...(serviceStatus !== undefined ? { serviceStatus } : {})
    }
  })
}

/** Active firings plus today's finished ones. Each addition is its own card. */
export async function listKitchen(branchId: string): Promise<KitchenBoardDto> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } })
  if (!branch) throw new AppError(404, 'Branch not found')
  await transaction(prisma, async (tx) => {
    await backfillBranchTickets(tx, branchId)
  })
  const range = zonedDayRange(todayInTimeZone(branch.timezone), branch.timezone)
  const [activeRows, completedRows] = await Promise.all([
    prisma.kitchenSubmission.findMany({
      where: {
        branchId,
        kitchenStatus: { in: ['NEW', 'PREPARING', 'READY'] },
        order: { status: { not: 'CANCELLED' } }
      },
      include: submissionInclude,
      orderBy: [{ startedAt: 'asc' }, { sequence: 'asc' }]
    }),
    prisma.kitchenSubmission.findMany({
      where: {
        branchId,
        kitchenStatus: 'COMPLETED',
        completedAt: { gte: range.start, lt: range.end },
        order: { status: { not: 'CANCELLED' } }
      },
      include: submissionInclude,
      orderBy: { completedAt: 'desc' },
      take: 40
    })
  ])
  return {
    serverTime: new Date().toISOString(),
    active: tickets(activeRows),
    completed: tickets(completedRows)
  }
}

/**
 * Moves one firing a single step forward.
 * Repeating the current step is a no-op so a double tap cannot skip ahead.
 * The parent pass follows every firing. Payment rows and check totals are not written.
 */
export async function advanceKitchen(
  branchId: string,
  ticketId: string,
  status: 'PREPARING' | 'READY' | 'COMPLETED'
): Promise<KitchenTicketDto> {
  const result = await transaction(prisma, async (tx) => {
    const hinted = await tx.kitchenSubmission.findUnique({ where: { id: ticketId }, select: { orderId: true } })
    const orderId = hinted?.orderId ?? ticketId
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`
    const submissionId = hinted ? ticketId : await onlyOpenSubmission(tx, ticketId)
    const existing = await tx.kitchenSubmission.findUnique({ where: { id: submissionId }, include: submissionInclude })
    if (!existing) throw new AppError(404, 'Order not found')
    if (existing.branchId !== branchId) throw new AppError(403, 'Outside your branch')
    if (existing.order.status === 'CANCELLED') throw new AppError(409, 'This order was cancelled')
    if (existing.kitchenStatus === status) return { submission: existing, changed: false }
    if (KITCHEN_STATUS_STEP[existing.kitchenStatus] !== status) throw new AppError(409, 'That step is not available')
    const submission = await tx.kitchenSubmission.update({
      where: { id: submissionId },
      data: {
        kitchenStatus: status,
        completedAt: status === 'COMPLETED' ? new Date() : null
      },
      include: submissionInclude
    })
    await syncOrderPass(tx, submission.orderId)
    return { submission, changed: true }
  })
  const ticket = toKitchenTicket(result.submission)
  if (!ticket) throw new AppError(409, 'This order is not on the kitchen board')
  if (result.changed) publish(context(), branchId, 'order.updated', { orderId: result.submission.orderId })
  return ticket
}

async function nextTicketNumber(tx: Tx, branchId: string): Promise<number> {
  await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR UPDATE`
  const latest = await tx.order.aggregate({
    where: { branchId, ticketNumber: { not: null } },
    _max: { ticketNumber: true }
  })
  return (latest._max.ticketNumber ?? 1000) + 1
}

/** Older clients advance by order id. That is safe only while the check has one open firing. */
async function onlyOpenSubmission(tx: Tx, orderId: string): Promise<string> {
  const rows = await tx.kitchenSubmission.findMany({
    where: { orderId, kitchenStatus: { not: 'COMPLETED' } },
    orderBy: { sequence: 'asc' },
    select: { id: true }
  })
  if (rows.length === 1 && rows[0]) return rows[0].id
  if (rows.length === 0) throw new AppError(409, 'This order is not on the kitchen board')
  throw new AppError(409, 'That step is not available')
}

function tickets(rows: KitchenSubmissionRow[]): KitchenTicketDto[] {
  const seen = new Map<string, KitchenTicketDto>()
  for (const row of rows) {
    const ticket = toKitchenTicket(row)
    if (!ticket) continue
    seen.set(ticket.id, ticket)
  }
  return [...seen.values()]
}
