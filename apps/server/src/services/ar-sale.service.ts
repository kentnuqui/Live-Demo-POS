import { randomUUID } from 'node:crypto'
import { Prisma, type PaymentMethod } from '@prisma/client'
import {
  accountBlockMessage,
  canAccessBranch,
  creditDecision,
  formatMoney,
  hasPermission,
  termDays,
  type PaymentInput,
  type RefundInput
} from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { shiftDay } from '../lib/day.js'
import { pinLookup } from '../lib/pin.js'
import { prisma } from '../lib/prisma.js'
import { transaction, type Tx } from '../lib/transaction.js'
import { invoiceInclude, toInvoiceDto } from './ar-present.js'
import {
  actorName,
  audit,
  branchClock,
  lockAccount,
  lockInvoice,
  lockOrderRow,
  nextNumber,
  numbered,
  persistInvoice,
  postEntry,
  rethrowAr
} from './ar-support.js'

interface SaleOrder {
  id: string
  branchId: string
  currency: string
  guestName: string
}

/**
 * Opens an account invoice for a tender that was just recorded on the check.
 * Runs inside the payment transaction, so a failed credit check rolls the tender back too.
 */
export async function createArSale(
  tx: Tx,
  actor: AuthUser,
  order: SaleOrder,
  input: PaymentInput,
  amountCents: number
): Promise<void> {
  if (!hasPermission(actor.role, 'ar.sell')) {
    throw new AppError(403, 'You do not have access to account sales.')
  }
  if (!input.arAccountId) throw new AppError(400, 'Select an account.')
  if (amountCents <= 0) throw new AppError(400, 'Enter an amount.')
  const existing = await tx.arInvoice.findUnique({ where: { orderId: order.id } })
  if (existing) throw new AppError(409, 'This transaction has already been processed.')

  await lockAccount(tx, input.arAccountId)
  const account = await tx.arAccount.findFirst({ where: { id: input.arAccountId, branchId: order.branchId } })
  if (!account) throw new AppError(404, 'Account not found.')
  const blocked = accountBlockMessage(account.status)
  if (blocked) throw new AppError(400, blocked)

  const decision = creditDecision({
    limitCents: account.creditLimitCents,
    enforce: account.enforceCreditLimit,
    balanceCents: account.balanceCents,
    requestedCents: amountCents
  })
  let approverId: string | null = null
  if (!decision.ok) {
    approverId = await resolveOverride(tx, actor, order.branchId, input)
    if (!approverId) {
      throw new AppError(
        400,
        `Credit limit exceeded. Available credit: ${formatMoney(decision.availableCents, order.currency)}. Requested credit: ${formatMoney(amountCents, order.currency)}.`
      )
    }
  }

  const clock = await branchClock(tx, order.branchId)
  const days = termDays(account.paymentTerms, account.customTermDays)
  const invoiceNumber = numbered('INV', await nextNumber(tx, order.branchId, 'invoice', 1001))
  let invoice
  try {
    invoice = await tx.arInvoice.create({
      data: {
        branchId: order.branchId,
        accountId: account.id,
        orderId: order.id,
        paymentId: input.id,
        invoiceNumber,
        cashierId: actor.id,
        originalCents: amountCents,
        paidCents: 0,
        refundedCents: 0,
        writtenOffCents: 0,
        remainingCents: amountCents,
        invoiceOn: clock.today,
        dueOn: shiftDay(clock.today, days),
        terms: account.paymentTerms,
        termDays: days,
        status: 'OPEN',
        notes: ''
      }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'This transaction has already been processed.')
    }
    throw error
  }
  const name = await actorName(tx, actor.id)
  await postEntry(tx, {
    branchId: order.branchId,
    accountId: account.id,
    invoiceId: invoice.id,
    kind: 'INVOICE',
    debitCents: amountCents,
    creditCents: 0,
    reference: invoiceNumber,
    description: 'Food sale',
    createdById: actor.id
  })
  await audit(tx, {
    branchId: order.branchId,
    accountId: account.id,
    invoiceId: invoice.id,
    action: 'invoice.create',
    message: `${name} created AR invoice ${invoiceNumber} for ${formatMoney(amountCents, order.currency)}.`,
    userId: actor.id,
    amountCents
  })
  if (approverId) {
    const approver = approverId === actor.id ? name : await actorName(tx, approverId)
    await audit(tx, {
      branchId: order.branchId,
      accountId: account.id,
      invoiceId: invoice.id,
      action: 'invoice.override',
      message: `${approver} approved a credit limit override.`,
      userId: actor.id,
      approverId,
      amountCents,
      reason: 'Credit limit exceeded'
    })
  }
  if (!order.guestName.trim()) {
    await tx.order.update({
      where: { id: order.id },
      data: { guestName: account.companyName || account.customerName }
    })
  }
}

/**
 * Adjusts the account when a closed check is refunded.
 * Account reduces what is still owed. Cash or card returns money already collected.
 */
export async function adjustArForRefund(tx: Tx, actor: AuthUser, orderId: string, currency: string, input: RefundInput): Promise<void> {
  const invoice = await tx.arInvoice.findUnique({ where: { orderId } })
  if (!invoice) {
    if (input.method === 'ACCOUNT') throw new AppError(400, 'This check is not an account sale.')
    return
  }
  if ((invoice.status === 'VOIDED' || invoice.voidedAt) && input.method === 'ACCOUNT') {
    throw new AppError(409, 'This account invoice is voided.')
  }
  await lockAccount(tx, invoice.accountId)
  await lockInvoice(tx, invoice.id)
  const current = await tx.arInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
  const clock = await branchClock(tx, current.branchId)
  const name = await actorName(tx, actor.id)

  if (input.method === 'ACCOUNT') {
    if (input.amountCents > current.remainingCents) {
      throw new AppError(
        400,
        `This account only has ${formatMoney(current.remainingCents, currency)} unpaid.`
      )
    }
    await persistInvoice(tx, current.id, clock.today, { refundedCents: current.refundedCents + input.amountCents })
    await postEntry(tx, {
      branchId: current.branchId,
      accountId: current.accountId,
      invoiceId: current.id,
      kind: 'REFUND',
      debitCents: 0,
      creditCents: input.amountCents,
      reference: current.invoiceNumber,
      description: `Refund ${input.reason.trim()}`,
      createdById: actor.id
    })
    await audit(tx, {
      branchId: current.branchId,
      accountId: current.accountId,
      invoiceId: current.id,
      action: 'invoice.refund',
      message: `${name} reduced ${current.invoiceNumber} by ${formatMoney(input.amountCents, currency)}.`,
      userId: actor.id,
      amountCents: input.amountCents,
      reason: input.reason.trim()
    })
    return
  }

  const available = await allocatedByMethod(tx, current.id, input.method)
  if (input.amountCents > available) {
    throw new AppError(
      400,
      available === 0
        ? 'No payment has been collected on this account sale. Choose Account to reduce the balance.'
        : `Only ${formatMoney(available, currency)} was collected by ${input.method === 'CASH' ? 'cash' : input.method === 'CARD' ? 'card' : 'other'}.`
    )
  }
  await releaseAllocations(tx, current.id, input.method, input.amountCents)
  // The sale refund and the returned collection cancel each other on the account.
  // The customer still owes the same amount. Cash leaves the drawer through the refund row.
  await persistInvoice(tx, current.id, clock.today, {
    paidCents: current.paidCents - input.amountCents,
    refundedCents: current.refundedCents + input.amountCents
  })
  await audit(tx, {
    branchId: current.branchId,
    accountId: current.accountId,
    invoiceId: current.id,
    action: 'invoice.collection-refund',
    message: `${name} returned ${formatMoney(input.amountCents, currency)} collected on ${current.invoiceNumber}. The open balance is unchanged.`,
    userId: actor.id,
    amountCents: input.amountCents,
    reason: input.reason.trim()
  })
}

/** Marks an unpaid or partly paid invoice voided and clears the open balance. */
export async function voidInvoice(actor: AuthUser, branchId: string, invoiceId: string, reason: string) {
  if (!hasPermission(actor.role, 'ar.void')) throw new AppError(403, 'You do not have access to this')
  try {
    return await transaction(prisma, async (tx) => {
      const found = await tx.arInvoice.findFirst({ where: { id: invoiceId, branchId } })
      if (!found) throw new AppError(404, 'Invoice not found.')
      await lockOrderRow(tx, found.orderId)
      await lockAccount(tx, found.accountId)
      await lockInvoice(tx, found.id)
      const invoice = await tx.arInvoice.findUniqueOrThrow({ where: { id: found.id } })
      if (invoice.status === 'VOIDED' || invoice.voidedAt) throw new AppError(409, 'This invoice is already voided.')
      if (invoice.remainingCents <= 0) {
        throw new AppError(400, 'This invoice has no open balance. Refund it instead of voiding it.')
      }
      const clock = await branchClock(tx, branchId)
      const cleared = invoice.remainingCents
      await tx.refund.create({
        data: {
          id: randomUUID(),
          orderId: invoice.orderId,
          method: 'ACCOUNT',
          amountCents: cleared,
          reason: reason.trim(),
          cashierId: actor.id
        }
      })
      await tx.arInvoice.update({
        where: { id: invoice.id },
        data: {
          voidedAt: new Date(),
          voidedById: actor.id,
          voidReason: reason.trim()
        }
      })
      await persistInvoice(tx, invoice.id, clock.today, {
        voided: true,
        refundedCents: invoice.refundedCents + cleared
      })
      await postEntry(tx, {
        branchId,
        accountId: invoice.accountId,
        invoiceId: invoice.id,
        kind: 'VOID',
        debitCents: 0,
        creditCents: cleared,
        reference: invoice.invoiceNumber,
        description: `Void ${reason.trim()}`,
        createdById: actor.id
      })
      const name = await actorName(tx, actor.id)
      await audit(tx, {
        branchId,
        accountId: invoice.accountId,
        invoiceId: invoice.id,
        action: 'invoice.void',
        message: `${name} voided ${invoice.invoiceNumber}.`,
        userId: actor.id,
        amountCents: cleared,
        reason: reason.trim()
      })
      const row = await tx.arInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: invoiceInclude })
      return toInvoiceDto(row, clock.today)
    })
  } catch (error) {
    rethrowAr(error, 'Unable to void this invoice. No changes were made.')
  }
}

/** Removes an uncollectible balance. The original invoice stays on file. */
export async function writeOffInvoice(
  actor: AuthUser,
  branchId: string,
  invoiceId: string,
  input: { id: string; amountCents: number; reason: string }
) {
  if (!hasPermission(actor.role, 'ar.writeoff')) throw new AppError(403, 'You do not have access to this')
  try {
    return await transaction(prisma, async (tx) => {
      const replay = await tx.arWriteOff.findUnique({ where: { id: input.id } })
      if (replay) {
        const row = await tx.arInvoice.findUniqueOrThrow({ where: { id: replay.invoiceId }, include: invoiceInclude })
        const clock = await branchClock(tx, branchId)
        return toInvoiceDto(row, clock.today)
      }
      const found = await tx.arInvoice.findFirst({ where: { id: invoiceId, branchId } })
      if (!found) throw new AppError(404, 'Invoice not found.')
      await lockAccount(tx, found.accountId)
      await lockInvoice(tx, found.id)
      const invoice = await tx.arInvoice.findUniqueOrThrow({ where: { id: found.id } })
      if (invoice.status === 'VOIDED' || invoice.voidedAt) throw new AppError(409, 'This invoice is voided.')
      if (input.amountCents > invoice.remainingCents) {
        throw new AppError(400, 'That is more than the open balance.')
      }
      const clock = await branchClock(tx, branchId)
      await tx.arWriteOff.create({
        data: {
          id: input.id,
          branchId,
          accountId: invoice.accountId,
          invoiceId: invoice.id,
          amountCents: input.amountCents,
          reason: input.reason.trim(),
          userId: actor.id
        }
      })
      await persistInvoice(tx, invoice.id, clock.today, {
        writtenOffCents: invoice.writtenOffCents + input.amountCents
      })
      await postEntry(tx, {
        branchId,
        accountId: invoice.accountId,
        invoiceId: invoice.id,
        kind: 'WRITE_OFF',
        debitCents: 0,
        creditCents: input.amountCents,
        reference: invoice.invoiceNumber,
        description: `Write-off ${input.reason.trim()}`,
        createdById: actor.id
      })
      const name = await actorName(tx, actor.id)
      await audit(tx, {
        branchId,
        accountId: invoice.accountId,
        invoiceId: invoice.id,
        action: 'invoice.writeoff',
        message: `${name} wrote off ${formatMoney(input.amountCents, clock.currency)} on ${invoice.invoiceNumber}.`,
        userId: actor.id,
        amountCents: input.amountCents,
        reason: input.reason.trim()
      })
      const row = await tx.arInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: invoiceInclude })
      return toInvoiceDto(row, clock.today)
    })
  } catch (error) {
    rethrowAr(error, 'Unable to write off this balance. No changes were made.')
  }
}

async function resolveOverride(
  tx: Tx,
  actor: AuthUser,
  branchId: string,
  input: { override?: boolean; overridePin?: string }
): Promise<string | null> {
  if (input.override && hasPermission(actor.role, 'ar.override')) return actor.id
  if (!input.overridePin) return null
  const manager = await tx.user.findUnique({ where: { pinLookup: pinLookup(input.overridePin) } })
  if (!manager || !manager.isActive) throw new AppError(403, 'Manager PIN was not accepted.')
  if (!hasPermission(manager.role, 'ar.override')) throw new AppError(403, 'That PIN cannot approve a credit limit.')
  if (!canAccessBranch(manager.role, manager.branchId, branchId)) {
    throw new AppError(403, 'That manager is outside this branch.')
  }
  return manager.id
}

async function allocatedByMethod(tx: Tx, invoiceId: string, method: PaymentMethod): Promise<number> {
  const rows = await tx.arAllocation.findMany({
    where: { invoiceId, payment: { method } },
    select: { amountCents: true }
  })
  return rows.reduce((sum, row) => sum + row.amountCents, 0)
}

/** Gives collected money back and keeps the payment's amount identity: applied + unapplied + refunded. */
async function releaseAllocations(tx: Tx, invoiceId: string, method: PaymentMethod, amountCents: number): Promise<void> {
  let left = amountCents
  const rows = await tx.arAllocation.findMany({
    where: { invoiceId, payment: { method } },
    orderBy: { createdAt: 'desc' }
  })
  for (const row of rows) {
    if (left <= 0) break
    const take = Math.min(left, row.amountCents)
    if (take === row.amountCents) {
      await tx.arAllocation.delete({ where: { id: row.id } })
    } else {
      await tx.arAllocation.update({ where: { id: row.id }, data: { amountCents: row.amountCents - take } })
    }
    await tx.arPayment.update({
      where: { id: row.paymentId },
      data: { appliedCents: { decrement: take }, refundedCents: { increment: take } }
    })
    left -= take
  }
  if (left > 0) throw new AppError(400, 'Unable to return this payment. No changes were made.')
}
