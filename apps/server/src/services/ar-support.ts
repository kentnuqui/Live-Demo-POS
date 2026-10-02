import { Prisma } from '@prisma/client'
import type { ArLedgerKind } from '@towns/shared'
import { invoiceRemaining, invoiceStatus } from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { todayInTimeZone } from '../lib/day.js'
import type { Tx } from '../lib/transaction.js'

/** Stops two terminals from changing the same account balance at once. */
export async function lockAccount(tx: Tx, accountId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ar_accounts WHERE id = ${accountId} FOR UPDATE
  `
  if (!rows.length) throw new AppError(404, 'Account not found.')
}

/** Stops two payments from allocating the same invoice at once. */
export async function lockInvoice(tx: Tx, invoiceId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ar_invoices WHERE id = ${invoiceId} FOR UPDATE
  `
  if (!rows.length) throw new AppError(404, 'Invoice not found.')
}

export async function lockOrderRow(tx: Tx, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`
}

/**
 * Next number in a branch sequence.
 * The insert and the increment are one statement, so two cashiers cannot take the same number.
 */
export async function nextNumber(tx: Tx, branchId: string, kind: string, start: number): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO ar_sequences (branch_id, kind, value)
    VALUES (${branchId}, ${kind}, ${start})
    ON CONFLICT (branch_id, kind)
    DO UPDATE SET value = ar_sequences.value + 1
    RETURNING value
  `
  const value = rows[0] ? Number(rows[0].value) : 0
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(500, 'Unable to assign a number. No changes were made.')
  }
  return value
}

export function numbered(prefix: string, value: number): string {
  return `${prefix}-${value}`
}

export async function actorName(tx: Tx, userId: string): Promise<string> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true }
  })
  if (!user) return 'Staff'
  return `${user.firstName} ${user.lastName}`.trim() || 'Staff'
}

export async function branchClock(
  tx: Tx,
  branchId: string
): Promise<{ today: string; timezone: string; currency: string; name: string; address: string }> {
  const branch = await tx.branch.findUnique({
    where: { id: branchId },
    include: { settings: { select: { currency: true } } }
  })
  if (!branch) throw new AppError(404, 'Branch not found')
  let timezone = branch.timezone
  try {
    todayInTimeZone(timezone)
  } catch {
    timezone = 'UTC'
  }
  return {
    today: todayInTimeZone(timezone),
    timezone,
    currency: branch.settings?.currency ?? 'USD',
    name: branch.name,
    address: branch.address
  }
}

interface LedgerPost {
  branchId: string
  accountId: string
  invoiceId?: string | null
  paymentId?: string | null
  kind: ArLedgerKind
  debitCents: number
  creditCents: number
  reference: string
  description: string
  createdById: string
}

/**
 * Appends one ledger line and refreshes the cached balance from the ledger itself.
 * The account row must already be locked.
 */
export async function postEntry(tx: Tx, entry: LedgerPost): Promise<number> {
  const debit = entry.debitCents
  const credit = entry.creditCents
  if (debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
    throw new AppError(400, 'Unable to update this account. No changes were made.')
  }
  const sums = await tx.arLedgerEntry.aggregate({
    where: { accountId: entry.accountId },
    _sum: { debitCents: true, creditCents: true }
  })
  const balanceCents = (sums._sum.debitCents ?? 0) - (sums._sum.creditCents ?? 0) + debit - credit
  await tx.arLedgerEntry.create({
    data: {
      branchId: entry.branchId,
      accountId: entry.accountId,
      invoiceId: entry.invoiceId ?? null,
      paymentId: entry.paymentId ?? null,
      kind: entry.kind,
      debitCents: debit,
      creditCents: credit,
      balanceCents,
      reference: entry.reference,
      description: entry.description,
      createdById: entry.createdById
    }
  })
  await tx.arAccount.update({
    where: { id: entry.accountId },
    data: { balanceCents }
  })
  return balanceCents
}

export async function audit(
  tx: Tx,
  entry: {
    branchId: string
    accountId?: string | null
    invoiceId?: string | null
    paymentId?: string | null
    action: string
    message: string
    userId: string
    approverId?: string | null
    amountCents?: number | null
    previousValue?: string
    newValue?: string
    reason?: string
  }
): Promise<void> {
  await tx.arAuditLog.create({
    data: {
      branchId: entry.branchId,
      accountId: entry.accountId ?? null,
      invoiceId: entry.invoiceId ?? null,
      paymentId: entry.paymentId ?? null,
      action: entry.action,
      message: entry.message,
      userId: entry.userId,
      approverId: entry.approverId ?? null,
      amountCents: entry.amountCents ?? null,
      previousValue: entry.previousValue ?? '',
      newValue: entry.newValue ?? '',
      reason: entry.reason ?? ''
    }
  })
}

/** Rewrites remaining and status from the stored amounts. Refuses a negative balance. */
export async function persistInvoice(
  tx: Tx,
  invoiceId: string,
  today: string,
  patch: { paidCents?: number; refundedCents?: number; writtenOffCents?: number; voided?: boolean }
) {
  const invoice = await tx.arInvoice.findUniqueOrThrow({ where: { id: invoiceId } })
  const paidCents = patch.paidCents ?? invoice.paidCents
  const refundedCents = patch.refundedCents ?? invoice.refundedCents
  const writtenOffCents = patch.writtenOffCents ?? invoice.writtenOffCents
  const voided = patch.voided ?? (invoice.status === 'VOIDED' || invoice.voidedAt != null)
  const remainingCents = invoiceRemaining({
    originalCents: invoice.originalCents,
    paidCents,
    refundedCents,
    writtenOffCents,
    voided
  })
  if (remainingCents < 0) {
    throw new AppError(400, 'Unable to update this invoice. No changes were made.')
  }
  const status = invoiceStatus({
    originalCents: invoice.originalCents,
    paidCents,
    refundedCents,
    writtenOffCents,
    voided,
    dueOn: invoice.dueOn,
    today
  })
  return tx.arInvoice.update({
    where: { id: invoiceId },
    data: { paidCents, refundedCents, writtenOffCents, remainingCents, status }
  })
}

/** Turns a unique-key race into a message a cashier can act on. */
export function rethrowAr(error: unknown, fallback: string): never {
  if (error instanceof AppError) throw error
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(409, 'This transaction has already been processed.')
  }
  console.error(error)
  throw new AppError(500, fallback)
}
