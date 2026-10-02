import type { ArApplyInput, ArListQuery, ArPaymentInput } from '@towns/shared'
import { hasPermission, reviewAllocations } from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { transaction, type Tx } from '../lib/transaction.js'
import { zonedDayRange } from '../lib/day.js'
import { paymentInclude, toPaymentDto } from './ar-present.js'
import {
  actorName,
  audit,
  branchClock,
  lockAccount,
  lockInvoice,
  nextNumber,
  numbered,
  persistInvoice,
  postEntry,
  rethrowAr
} from './ar-support.js'

/**
 * Records money received on an account.
 * Allocations reduce invoices. Anything left over stays as unapplied credit.
 */
export async function receivePayment(actor: AuthUser, branchId: string, input: ArPaymentInput) {
  if (!hasPermission(actor.role, 'ar.collect')) throw new AppError(403, 'You do not have access to this')
  try {
    return await transaction(prisma, async (tx) => {
      const replay = await tx.arPayment.findUnique({ where: { id: input.id }, include: paymentInclude })
      if (replay) {
        if (replay.branchId !== branchId) throw new AppError(409, 'This transaction has already been processed.')
        return toPaymentDto(replay)
      }
      await lockAccount(tx, input.accountId)
      const account = await tx.arAccount.findFirst({ where: { id: input.accountId, branchId } })
      if (!account) throw new AppError(404, 'Account not found.')
      const clock = await branchClock(tx, branchId)
      const applied = await applyLines(tx, account.id, branchId, input.allocations, input.amountCents, clock.today, false)
      const reference = input.reference?.trim() || numbered('PAY', await nextNumber(tx, branchId, 'payment', 2001))
      const payment = await tx.arPayment.create({
        data: {
          id: input.id,
          branchId,
          accountId: account.id,
          method: input.method,
          amountCents: input.amountCents,
          appliedCents: applied.appliedCents,
          unappliedCents: applied.unappliedCents,
          refundedCents: 0,
          reference,
          notes: input.notes?.trim() ?? '',
          cashierId: actor.id,
          allocations: {
            create: applied.lines.map((line) => ({
              invoiceId: line.invoiceId,
              amountCents: line.amountCents
            }))
          }
        },
        include: paymentInclude
      })
      await postEntry(tx, {
        branchId,
        accountId: account.id,
        paymentId: payment.id,
        kind: 'PAYMENT',
        debitCents: 0,
        creditCents: input.amountCents,
        reference,
        description: input.allocations.length ? 'Payment' : 'Unapplied payment',
        createdById: actor.id
      })
      const name = await actorName(tx, actor.id)
      await audit(tx, {
        branchId,
        accountId: account.id,
        paymentId: payment.id,
        action: 'payment.create',
        message: `${name} recorded ${reference} for ${account.companyName}.`,
        userId: actor.id,
        amountCents: input.amountCents
      })
      return toPaymentDto(payment)
    })
  } catch (error) {
    rethrowAr(error, 'Unable to record this payment. No changes were made. Please try again.')
  }
}

/** Applies credit that was received earlier onto open invoices. The account balance does not change. */
export async function applyPayment(actor: AuthUser, branchId: string, paymentId: string, input: ArApplyInput) {
  if (!hasPermission(actor.role, 'ar.collect')) throw new AppError(403, 'You do not have access to this')
  try {
    return await transaction(prisma, async (tx) => {
      const existing = await tx.arPayment.findFirst({ where: { id: paymentId, branchId } })
      if (!existing) throw new AppError(404, 'Payment not found.')
      const marker = `apply:${input.id}`
      await lockAccount(tx, existing.accountId)
      await tx.$queryRaw`SELECT id FROM ar_payments WHERE id = ${paymentId} FOR UPDATE`
      const prior = await tx.arAuditLog.findFirst({ where: { paymentId, action: marker } })
      if (prior) {
        const current = await tx.arPayment.findUniqueOrThrow({ where: { id: paymentId }, include: paymentInclude })
        return toPaymentDto(current)
      }
      const payment = await tx.arPayment.findUniqueOrThrow({ where: { id: paymentId } })
      const clock = await branchClock(tx, branchId)
      const applied = await applyLines(tx, payment.accountId, branchId, input.allocations, payment.unappliedCents, clock.today, true)
      if (applied.unappliedCents < 0) throw new AppError(400, 'The amounts selected are more than the payment.')
      for (const line of applied.lines) {
        const current = await tx.arAllocation.findUnique({
          where: { paymentId_invoiceId: { paymentId, invoiceId: line.invoiceId } }
        })
        if (current) {
          await tx.arAllocation.update({
            where: { id: current.id },
            data: { amountCents: current.amountCents + line.amountCents }
          })
        } else {
          await tx.arAllocation.create({
            data: { paymentId, invoiceId: line.invoiceId, amountCents: line.amountCents }
          })
        }
      }
      const updated = await tx.arPayment.update({
        where: { id: paymentId },
        data: {
          appliedCents: payment.appliedCents + applied.appliedCents,
          unappliedCents: payment.unappliedCents - applied.appliedCents
        },
        include: paymentInclude
      })
      const name = await actorName(tx, actor.id)
      await audit(tx, {
        branchId,
        accountId: payment.accountId,
        paymentId,
        action: marker,
        message: `${name} applied ${updated.reference} to open invoices.`,
        userId: actor.id,
        amountCents: applied.appliedCents
      })
      return toPaymentDto(updated)
    })
  } catch (error) {
    rethrowAr(error, 'Unable to apply this payment. No changes were made. Please try again.')
  }
}

export async function listPayments(branchId: string, query: ArListQuery) {
  const clock = await branchClock(prisma, branchId)
  const where = {
    branchId,
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.q
      ? {
          OR: [
            { reference: { contains: query.q, mode: 'insensitive' as const } },
            { account: { companyName: { contains: query.q, mode: 'insensitive' as const } } },
            { account: { accountNumber: { contains: query.q, mode: 'insensitive' as const } } }
          ]
        }
      : {}),
    ...(query.from || query.to
      ? {
          createdAt: await createdRange(branchId, query.from, query.to)
        }
      : {})
  }
  const [rows, total] = await Promise.all([
    prisma.arPayment.findMany({
      where,
      include: paymentInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    }),
    prisma.arPayment.count({ where })
  ])
  return {
    payments: rows.map(toPaymentDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    currency: clock.currency
  }
}

async function applyLines(
  tx: Tx,
  accountId: string,
  branchId: string,
  lines: Array<{ invoiceId: string; amountCents: number }>,
  paymentCents: number,
  today: string,
  capAtPayment: boolean
) {
  const ids = [...new Set(lines.map((line) => line.invoiceId))].sort()
  for (const id of ids) await lockInvoice(tx, id)
  const invoices = ids.length
    ? await tx.arInvoice.findMany({ where: { id: { in: ids }, accountId, branchId } })
    : []
  if (invoices.length !== ids.length) throw new AppError(400, 'Choose invoices on this account.')
  if (invoices.some((invoice) => invoice.status === 'VOIDED' || invoice.voidedAt || invoice.remainingCents <= 0)) {
    throw new AppError(400, 'One of those invoices cannot take a payment.')
  }
  const reviewed = reviewAllocations(
    paymentCents,
    lines,
    new Map(invoices.map((invoice) => [invoice.id, invoice.remainingCents]))
  )
  if (!reviewed.ok) throw new AppError(400, reviewed.message)
  if (!capAtPayment && reviewed.appliedCents > paymentCents) {
    throw new AppError(400, 'The amounts selected are more than the payment.')
  }
  for (const line of lines) {
    const invoice = invoices.find((row) => row.id === line.invoiceId)
    if (!invoice) throw new AppError(400, 'Choose invoices on this account.')
    await persistInvoice(tx, invoice.id, today, { paidCents: invoice.paidCents + line.amountCents })
  }
  return { ...reviewed, lines }
}

async function createdRange(branchId: string, from?: string, to?: string) {
  const clock = await branchClock(prisma, branchId)
  try {
    return {
      ...(from ? { gte: zonedDayRange(from, clock.timezone).start } : {}),
      ...(to ? { lt: zonedDayRange(to, clock.timezone).end } : {})
    }
  } catch {
    throw new AppError(400, 'Choose a real date')
  }
}
