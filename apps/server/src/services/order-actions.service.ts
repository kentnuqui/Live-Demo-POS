import type { DiscountInput, PaymentInput, RefundInput, SplitInput } from '@towns/shared'
import type { OrderDto } from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { context, publish, type ServiceContext } from '../lib/context.js'
import { transaction } from '../lib/transaction.js'
import { releaseTable } from './floor.service.js'
import { createOrder } from './order.service.js'
import { assertMutable, loadOrder, orderInclude, present, progressFor, recalculate } from './order-support.js'

function collected(order: { payments: Array<{ amountCents: number }> }): number {
  return order.payments.reduce((sum, payment) => sum + payment.amountCents, 0)
}

function returned(order: { refunds: Array<{ amountCents: number }> }): number {
  return order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
}

/** Stops two terminals from settling the same check at once. */
async function lockOrder(tx: Parameters<typeof loadOrder>[0], orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`
}

/** Moves a seated party onto another open table. The old table goes to cleaning. */
export async function transferOrder(
  actor: AuthUser,
  orderId: string,
  tableId: string,
  ctx?: Partial<ServiceContext>
): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    const existing = await loadOrder(tx, orderId)
    assertMutable(existing.status)
    if (!existing.tableId) throw new AppError(400, 'Only a seated check can move')
    if (existing.tableId === tableId) return existing
    const claimed = await tx.diningTable.updateMany({
      where: { id: tableId, branchId: existing.branchId, status: 'AVAILABLE' },
      data: { status: 'OCCUPIED' }
    })
    if (claimed.count !== 1) throw new AppError(409, 'That table is not open')
    const previous = existing.tableId
    await tx.order.update({ where: { id: orderId }, data: { tableId, serverId: existing.serverId ?? actor.id } })
    await releaseTable(tx, previous)
    return loadOrder(tx, orderId)
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  publish(current, order.branchId, 'floor.updated')
  return present(order)
}

/** Folds another open check into this one and cancels the source. */
export async function mergeOrders(
  orderId: string,
  sourceOrderId: string,
  ctx?: Partial<ServiceContext>
): Promise<OrderDto> {
  if (orderId === sourceOrderId) throw new AppError(400, 'Choose a different check')
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    const target = await loadOrder(tx, orderId)
    const source = await loadOrder(tx, sourceOrderId)
    if (source.status === 'CANCELLED' && source.mergedIntoId === target.id) return target
    assertMutable(target.status)
    assertMutable(source.status)
    if (target.branchId !== source.branchId) throw new AppError(400, 'Checks are from different branches')
    await tx.orderItem.updateMany({ where: { orderId: source.id }, data: { orderId: target.id } })
    await tx.order.update({
      where: { id: source.id },
      data: {
        status: 'CANCELLED',
        progress: 'COMPLETED',
        mergedIntoId: target.id,
        closedAt: new Date(),
        subtotalCents: 0,
        discountKind: 'NONE',
        discountValue: 0,
        discountCents: 0,
        discountLabel: '',
        serviceChargeCents: 0,
        totalCents: 0,
        notes: source.notes ? `${source.notes} · Merged` : 'Merged'
      }
    })
    await tx.order.update({
      where: { id: target.id },
      data: {
        guestCount: Math.min(30, target.guestCount + source.guestCount),
        guestName: target.guestName || source.guestName
      }
    })
    await recalculate(tx, target.id)
    await releaseTable(tx, source.tableId === target.tableId ? null : source.tableId)
    return loadOrder(tx, target.id)
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  publish(current, order.branchId, 'floor.updated')
  return present(order)
}

/**
 * Moves selected lines onto a new check.
 * Pass a table to split the party across the room; omit it to split the bill at the same table.
 */
export async function splitOrder(
  actor: AuthUser,
  orderId: string,
  input: SplitInput,
  ctx?: Partial<ServiceContext>
): Promise<{ order: OrderDto; split: OrderDto }> {
  const current = context(ctx)
  const result = await transaction(current.db, async (tx) => {
    const existing = await loadOrder(tx, orderId)
    if (input.newOrderId) {
      const already = await tx.order.findUnique({ where: { id: input.newOrderId }, include: orderInclude })
      if (already) return { order: existing, split: already }
    }
    assertMutable(existing.status)
    const moving = existing.items.filter((item) => input.itemIds.includes(item.id) && !item.voided)
    if (moving.length === 0) throw new AppError(400, 'Select items to split')
    const staying = existing.items.filter((item) => !item.voided && !input.itemIds.includes(item.id))
    if (staying.length === 0) throw new AppError(400, 'Leave at least one item on the original check')

    const sameTable = !input.tableId || input.tableId === existing.tableId
    const created = await createOrder(
      actor,
      existing.branchId,
      {
        id: input.newOrderId,
        type: input.tableId && !sameTable ? 'DINE_IN' : existing.type,
        tableId: sameTable ? existing.tableId ?? undefined : input.tableId,
        guestCount: Math.max(1, existing.guestCount - 1),
        guestName: existing.guestName,
        source: 'POS'
      },
      { db: tx, silent: true, skipTableClaim: sameTable }
    )

    await tx.orderItem.updateMany({
      where: { id: { in: moving.map((item) => item.id) } },
      data: { orderId: created.id }
    })
    await tx.order.update({ where: { id: created.id }, data: { splitFromId: existing.id } })
    await recalculate(tx, existing.id)
    await recalculate(tx, created.id)
    return {
      order: await loadOrder(tx, existing.id),
      split: await loadOrder(tx, created.id)
    }
  })
  publish(current, result.order.branchId, 'order.updated', { orderId })
  publish(current, result.order.branchId, 'floor.updated')
  return { order: present(result.order), split: present(result.split) }
}

/** Marks the table as awaiting payment. The guest can still be settled from the check. */
export async function billOrder(orderId: string, ctx?: Partial<ServiceContext>): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    const existing = await loadOrder(tx, orderId)
    if (existing.status === 'BILLING') return existing
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new AppError(409, 'This check is already closed')
    }
    if (existing.items.every((item) => item.voided)) throw new AppError(400, 'The check is empty')
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'BILLING', progress: progressFor('BILLING') }
    })
    if (existing.tableId) {
      await tx.diningTable.update({ where: { id: existing.tableId }, data: { status: 'BILLING' } })
    }
    return loadOrder(tx, orderId)
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  publish(current, order.branchId, 'floor.updated')
  return present(order)
}

/**
 * Closes a check whose balance is already zero: a comp, a fully discounted bill, or an empty table.
 * A balance still due has to be collected with payOrder.
 */
export async function finishOrder(orderId: string, ctx?: Partial<ServiceContext>): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    await lockOrder(tx, orderId)
    const existing = await loadOrder(tx, orderId)
    if (existing.status === 'COMPLETED') return existing
    if (existing.status === 'CANCELLED') throw new AppError(409, 'This check is cancelled')
    const due = existing.totalCents - collected(existing)
    if (due > 0) throw new AppError(400, 'Collect the balance before closing')
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED', progress: 'COMPLETED', closedAt: existing.closedAt ?? new Date() }
    })
    await releaseTable(tx, existing.tableId)
    return loadOrder(tx, orderId)
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  publish(current, order.branchId, 'floor.updated')
  return present(order)
}

/** Applies a percent or amount off the items. Tax and service are recalculated on the remainder. */
export async function applyDiscount(orderId: string, input: DiscountInput, ctx?: Partial<ServiceContext>): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    await lockOrder(tx, orderId)
    const existing = await loadOrder(tx, orderId)
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new AppError(409, 'This check is already closed')
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        discountKind: input.kind,
        discountValue: input.kind === 'NONE' ? 0 : input.value,
        discountLabel: input.kind === 'NONE' ? '' : (input.label?.trim() ?? '')
      }
    })
    await recalculate(tx, orderId)
    const next = await loadOrder(tx, orderId)
    if (next.totalCents < collected(next)) {
      throw new AppError(400, 'That discount is larger than the amount still due')
    }
    return next
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  return present(order)
}

/**
 * Records one tender. Cash may be more than the balance and returns change.
 * The same payment id is ignored, so a retry cannot charge the guest twice.
 * The check closes, and the table is released, once nothing is left due.
 */
export async function payOrder(
  actor: AuthUser,
  orderId: string,
  input: PaymentInput,
  ctx?: Partial<ServiceContext>
): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    await lockOrder(tx, orderId)
    const replay = await tx.payment.findUnique({ where: { id: input.id } })
    if (replay) return loadOrder(tx, replay.orderId)
    const existing = await loadOrder(tx, orderId)
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new AppError(409, 'This check is already closed')
    }
    await recalculate(tx, orderId)
    const priced = await loadOrder(tx, orderId)
    const due = priced.totalCents - collected(priced)
    if (due <= 0) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED', progress: 'COMPLETED', closedAt: new Date() }
      })
      await releaseTable(tx, priced.tableId)
      return loadOrder(tx, orderId)
    }

    const cash = input.method === 'CASH'
    const tendered = cash ? (input.tenderedCents ?? input.amountCents ?? 0) : (input.amountCents ?? due)
    if (tendered <= 0) throw new AppError(400, cash ? 'Enter the cash received' : 'Enter an amount')
    const applied = Math.min(tendered, due)
    if (!cash && tendered > due) throw new AppError(400, 'That is more than the balance')
    await tx.payment.create({
      data: {
        id: input.id,
        orderId,
        method: input.method,
        amountCents: applied,
        tenderedCents: cash ? tendered : applied,
        changeCents: cash ? tendered - applied : 0,
        note: input.note?.trim() ?? '',
        cashierId: actor.id
      }
    })
    const settled = applied >= due
    await tx.order.update({
      where: { id: orderId },
      data: settled
        ? { status: 'COMPLETED', progress: 'COMPLETED', closedAt: new Date() }
        : { status: 'BILLING', progress: progressFor('BILLING') }
    })
    if (settled) await releaseTable(tx, priced.tableId)
    else if (priced.tableId) {
      await tx.diningTable.update({ where: { id: priced.tableId }, data: { status: 'BILLING' } })
    }
    return loadOrder(tx, orderId)
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  publish(current, order.branchId, 'floor.updated')
  return present(order)
}

/** Returns money on a closed check, up to what was paid and not already refunded. */
export async function refundOrder(
  actor: AuthUser,
  orderId: string,
  input: RefundInput,
  ctx?: Partial<ServiceContext>
): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    await lockOrder(tx, orderId)
    const replay = await tx.refund.findUnique({ where: { id: input.id } })
    if (replay) return loadOrder(tx, replay.orderId)
    const existing = await loadOrder(tx, orderId)
    if (existing.status !== 'COMPLETED') throw new AppError(409, 'Only a paid check can be refunded')
    const refundable = Math.min(existing.totalCents, collected(existing)) - returned(existing)
    if (input.amountCents > refundable) throw new AppError(400, 'That is more than can be refunded')
    await tx.refund.create({
      data: {
        id: input.id,
        orderId,
        method: input.method,
        amountCents: input.amountCents,
        reason: input.reason.trim(),
        cashierId: actor.id
      }
    })
    await tx.order.update({ where: { id: orderId }, data: { notes: existing.notes } })
    return loadOrder(tx, orderId)
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  return present(order)
}

