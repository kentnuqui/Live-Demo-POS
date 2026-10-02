import {
  canAccessBranch,
  cancelReasonText,
  firedCount,
  hasPermission,
  orderCancelBlock,
  type CancelOrderInput,
  type CancelOrderResultDto
} from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { context, publish, type ServiceContext } from '../lib/context.js'
import { pinLookup } from '../lib/pin.js'
import { transaction, type Tx } from '../lib/transaction.js'
import { releaseTable } from './floor.service.js'
import { cancelFiredQuantity, recordOrderEvent, staffName } from './kitchen-submission.service.js'
import { loadOrder, present } from './order-support.js'

/**
 * Cancels an open check without deleting anything.
 * The order, its items, payments, and kitchen firings stay on file. Fired food is marked cancelled
 * on its firing so the pass stops cooking it. The table is recalculated, so another open check
 * or a nearby reservation keeps it. One transaction: any failure leaves the check and table as they were.
 * Two terminals cancelling at once queue on the row lock; the second sees CANCELLED and is refused.
 */
export async function cancelOrder(
  actor: AuthUser,
  orderId: string,
  input: CancelOrderInput,
  ctx?: Partial<ServiceContext>
): Promise<CancelOrderResultDto> {
  const current = context(ctx)
  const result = await transaction(current.db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`
    const existing = await loadOrder(tx, orderId)
    const paidCents = existing.payments.reduce((sum, payment) => sum + payment.amountCents, 0)
    const blocked = orderCancelBlock({ status: existing.status, paidCents })
    if (blocked) throw new AppError(409, blocked)

    const approverId = await resolveApprover(tx, actor, existing.branchId, input.overridePin)
    const reason = cancelReasonText(input.reason, input.note)
    const now = new Date()

    let kitchenCancelled = false
    for (const item of existing.items) {
      if (item.voided) continue
      const fired = firedCount(item)
      if (fired <= 0) continue
      await cancelFiredQuantity(tx, item.id, fired)
      kitchenCancelled = true
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        progress: 'COMPLETED',
        closedAt: now,
        cancelledAt: now,
        cancelledById: actor.id,
        cancelApprovedById: approverId,
        cancelReason: reason
      }
    })

    let table: CancelOrderResultDto['table'] = null
    if (existing.tableId) {
      await tx.$queryRaw`SELECT id FROM dining_tables WHERE id = ${existing.tableId} FOR UPDATE`
      await releaseTable(tx, existing.tableId, 'AVAILABLE')
      const row = await tx.diningTable.findUnique({
        where: { id: existing.tableId },
        select: { id: true, label: true, status: true }
      })
      table = row
    }

    await recordOrderEvent(
      tx,
      existing,
      'ORDER_CANCELLED',
      actor.id,
      await describeCancel(tx, {
        actorId: actor.id,
        approverId,
        reason,
        previousStatus: existing.status,
        tableLabel: existing.table?.label ?? null,
        kitchenCancelled
      })
    )

    return { order: await loadOrder(tx, orderId), table, kitchenCancelled }
  })

  const { order } = result
  publish(current, order.branchId, 'order.updated', { orderId })
  publish(current, order.branchId, 'order.cancelled', {
    orderId,
    ticketNumber: order.ticketNumber,
    kitchen: result.kitchenCancelled
  })
  if (result.table) publish(current, order.branchId, 'floor.updated', { tableId: result.table.id })
  return { order: present(order), table: result.table }
}

/**
 * Managers cancel on their own authority and are not recorded as an approver.
 * Anyone else needs a manager PIN from this branch, the same PIN used to sign in.
 */
async function resolveApprover(tx: Tx, actor: AuthUser, branchId: string, pin?: string): Promise<string | null> {
  if (hasPermission(actor.role, 'orders.cancel')) return null
  if (!pin) throw new AppError(403, 'Manager approval is required to cancel an order.')
  const manager = await tx.user.findUnique({ where: { pinLookup: pinLookup(pin) } })
  if (!manager || !manager.isActive) throw new AppError(403, 'Manager PIN was not accepted.')
  if (!hasPermission(manager.role, 'orders.cancel')) throw new AppError(403, 'That PIN cannot approve a cancellation.')
  if (!canAccessBranch(manager.role, manager.branchId, branchId)) {
    throw new AppError(403, 'That manager is outside this branch.')
  }
  return manager.id
}

async function describeCancel(
  tx: Tx,
  input: {
    actorId: string
    approverId: string | null
    reason: string
    previousStatus: string
    tableLabel: string | null
    kitchenCancelled: boolean
  }
): Promise<string> {
  const parts = [
    `${await staffName(tx, input.actorId)} cancelled the order`,
    `Reason: ${input.reason}`,
    `Previous status: ${input.previousStatus}`
  ]
  if (input.tableLabel) parts.push(`Table ${input.tableLabel}`)
  if (input.kitchenCancelled) parts.push('Kitchen told to stop')
  if (input.approverId) parts.push(`Approved by ${await staffName(tx, input.approverId)}`)
  return parts.join(' · ')
}
