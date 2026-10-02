import type { ArAccountCreateInput, ArAccountUpdateInput, ArListQuery } from '@towns/shared'
import { formatMoney, hasPermission } from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { zonedDayRange } from '../lib/day.js'
import { prisma } from '../lib/prisma.js'
import { transaction, type Tx } from '../lib/transaction.js'
import { toAccountDto, toAuditDto, toLedgerDto } from './ar-present.js'
import { actorName, audit, branchClock, nextNumber, numbered, rethrowAr } from './ar-support.js'

function page(query: ArListQuery) {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize }
}

function accountSearch(branchId: string, query: Pick<ArListQuery, 'q' | 'status'>) {
  return {
    branchId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { companyName: { contains: query.q, mode: 'insensitive' as const } },
            { customerName: { contains: query.q, mode: 'insensitive' as const } },
            { accountNumber: { contains: query.q, mode: 'insensitive' as const } },
            { contactPerson: { contains: query.q, mode: 'insensitive' as const } },
            { phone: { contains: query.q, mode: 'insensitive' as const } },
            { email: { contains: query.q, mode: 'insensitive' as const } }
          ]
        }
      : {})
  }
}

/** Active and inactive house accounts for one branch. */
export async function listAccounts(branchId: string, query: ArListQuery) {
  const clock = await branchClock(prisma, branchId)
  const where = accountSearch(branchId, query)
  const [rows, total] = await Promise.all([
    prisma.arAccount.findMany({
      where,
      orderBy: [{ companyName: 'asc' }],
      ...page(query)
    }),
    prisma.arAccount.count({ where })
  ])
  return {
    accounts: rows.map((row) => toAccountDto(row, clock.today)),
    page: query.page,
    pageSize: query.pageSize,
    total
  }
}

/** Account header, totals, and the recent audit trail. */
export async function getAccount(branchId: string, accountId: string) {
  const clock = await branchClock(prisma, branchId)
  const account = await prisma.arAccount.findFirst({ where: { id: accountId, branchId } })
  if (!account) throw new AppError(404, 'Account not found.')
  const [purchases, collections, openInvoices, audits] = await Promise.all([
    prisma.arInvoice.aggregate({
      where: { accountId, status: { not: 'VOIDED' } },
      _sum: { originalCents: true }
    }),
    prisma.arPayment.aggregate({
      where: { accountId },
      _sum: { amountCents: true, refundedCents: true }
    }),
    prisma.arInvoice.findMany({
      where: { accountId, remainingCents: { gt: 0 }, status: { notIn: ['VOIDED', 'WRITTEN_OFF'] } },
      select: { remainingCents: true, dueOn: true }
    }),
    prisma.arAuditLog.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: {
        user: { select: { firstName: true, lastName: true } },
        approver: { select: { firstName: true, lastName: true } }
      }
    })
  ])
  const overdueCents = openInvoices
    .filter((invoice) => invoice.dueOn < clock.today)
    .reduce((sum, invoice) => sum + invoice.remainingCents, 0)
  return {
    account: toAccountDto(account, clock.today),
    currency: clock.currency,
    stats: {
      purchasesCents: purchases._sum.originalCents ?? 0,
      paymentsCents: (collections._sum.amountCents ?? 0) - (collections._sum.refundedCents ?? 0),
      outstandingCents: account.balanceCents,
      overdueCents
    },
    audits: audits.map(toAuditDto)
  }
}

/** Opens a house account. No invoices are created. */
export async function createAccount(actor: AuthUser, branchId: string, input: ArAccountCreateInput) {
  if (!hasPermission(actor.role, 'ar.manage')) throw new AppError(403, 'You do not have access to this')
  try {
    return await transaction(prisma, async (tx) => {
      const clock = await branchClock(tx, branchId)
      const accountNumber = numbered('AR', await nextNumber(tx, branchId, 'account', 1001))
      const name = await actorName(tx, actor.id)
      const account = await tx.arAccount.create({
        data: {
          branchId,
          accountNumber,
          customerName: input.customerName,
          companyName: input.companyName,
          contactPerson: input.contactPerson?.trim() ?? '',
          phone: input.phone?.trim() ?? '',
          email: input.email?.trim() ?? '',
          address: input.address?.trim() ?? '',
          creditLimitCents: input.creditLimitCents ?? null,
          enforceCreditLimit: input.enforceCreditLimit ?? true,
          paymentTerms: input.paymentTerms,
          customTermDays: input.paymentTerms === 'CUSTOM' ? (input.customTermDays ?? 0) : 0,
          notes: input.notes?.trim() ?? '',
          createdById: actor.id,
          updatedById: actor.id
        }
      })
      await audit(tx, {
        branchId,
        accountId: account.id,
        action: 'account.create',
        message: `${name} opened account ${account.accountNumber} for ${account.companyName}.`,
        userId: actor.id
      })
      return toAccountDto(account, clock.today)
    })
  } catch (error) {
    rethrowAr(error, 'Unable to save this account. No changes were made.')
  }
}

/** Updates contact details, credit, terms, or status. Existing invoices keep their own due dates. */
export async function updateAccount(actor: AuthUser, branchId: string, accountId: string, input: ArAccountUpdateInput) {
  if (!hasPermission(actor.role, 'ar.manage')) throw new AppError(403, 'You do not have access to this')
  try {
    return await transaction(prisma, async (tx) => {
      const existing = await tx.arAccount.findFirst({ where: { id: accountId, branchId } })
      if (!existing) throw new AppError(404, 'Account not found.')
      const terms = input.paymentTerms ?? existing.paymentTerms
      const customTermDays = input.customTermDays ?? existing.customTermDays
      if (terms === 'CUSTOM' && input.paymentTerms === 'CUSTOM' && input.customTermDays == null && existing.paymentTerms !== 'CUSTOM') {
        throw new AppError(400, 'Enter the number of days.')
      }
      const clock = await branchClock(tx, branchId)
      const account = await tx.arAccount.update({
        where: { id: accountId },
        data: {
          ...(input.customerName != null ? { customerName: input.customerName } : {}),
          ...(input.companyName != null ? { companyName: input.companyName } : {}),
          ...(input.contactPerson != null ? { contactPerson: input.contactPerson } : {}),
          ...(input.phone != null ? { phone: input.phone } : {}),
          ...(input.email != null ? { email: input.email } : {}),
          ...(input.address != null ? { address: input.address } : {}),
          ...(input.creditLimitCents !== undefined ? { creditLimitCents: input.creditLimitCents } : {}),
          ...(input.enforceCreditLimit != null ? { enforceCreditLimit: input.enforceCreditLimit } : {}),
          ...(input.paymentTerms != null ? { paymentTerms: input.paymentTerms } : {}),
          ...(input.paymentTerms != null || input.customTermDays != null
            ? { customTermDays: terms === 'CUSTOM' ? customTermDays : 0 }
            : {}),
          ...(input.status != null ? { status: input.status } : {}),
          ...(input.notes != null ? { notes: input.notes } : {}),
          updatedById: actor.id
        }
      })
      const name = await actorName(tx, actor.id)
      await auditChanges(tx, actor.id, name, existing, account, clock.currency)
      return toAccountDto(account, clock.today)
    })
  } catch (error) {
    rethrowAr(error, 'Unable to save this account. No changes were made.')
  }
}

async function auditChanges(
  tx: Tx,
  userId: string,
  name: string,
  before: { id: string; branchId: string; creditLimitCents: number | null; paymentTerms: string; customTermDays: number; status: string },
  after: { creditLimitCents: number | null; paymentTerms: string; customTermDays: number; status: string },
  currency: string
) {
  if (before.creditLimitCents !== after.creditLimitCents) {
    await audit(tx, {
      branchId: before.branchId,
      accountId: before.id,
      action: 'account.credit',
      message: `${name} changed the credit limit from ${limitLabel(before.creditLimitCents, currency)} to ${limitLabel(after.creditLimitCents, currency)}.`,
      userId,
      previousValue: String(before.creditLimitCents ?? ''),
      newValue: String(after.creditLimitCents ?? '')
    })
  }
  if (before.paymentTerms !== after.paymentTerms || before.customTermDays !== after.customTermDays) {
    await audit(tx, {
      branchId: before.branchId,
      accountId: before.id,
      action: 'account.terms',
      message: `${name} changed payment terms.`,
      userId,
      previousValue: `${before.paymentTerms}:${before.customTermDays}`,
      newValue: `${after.paymentTerms}:${after.customTermDays}`
    })
  }
  if (before.status !== after.status) {
    await audit(tx, {
      branchId: before.branchId,
      accountId: before.id,
      action: 'account.status',
      message: `${name} set the account ${after.status.toLowerCase()}.`,
      userId,
      previousValue: before.status,
      newValue: after.status
    })
  }
}

function limitLabel(cents: number | null, currency: string): string {
  if (cents == null) return 'no limit'
  return formatMoney(cents, currency)
}

/** Ledger page for one account, oldest first so the running balance reads in order. */
export async function accountLedger(branchId: string, accountId: string, query: ArListQuery) {
  const account = await prisma.arAccount.findFirst({ where: { id: accountId, branchId }, select: { id: true } })
  if (!account) throw new AppError(404, 'Account not found.')
  const where = { accountId }
  const [rows, total] = await Promise.all([
    prisma.arLedgerEntry.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      ...page(query)
    }),
    prisma.arLedgerEntry.count({ where })
  ])
  return { entries: rows.map(toLedgerDto), page: query.page, pageSize: query.pageSize, total }
}

/** Statement for a calendar range in the branch timezone. */
export async function accountStatement(branchId: string, accountId: string, from: string, to: string) {
  if (from > to) throw new AppError(400, 'The start date is after the end date.')
  const account = await prisma.arAccount.findFirst({ where: { id: accountId, branchId } })
  if (!account) throw new AppError(404, 'Account not found.')
  const clock = await branchClock(prisma, branchId)
  let range: { start: Date; end: Date }
  try {
    const opened = zonedDayRange(from, clock.timezone)
    const closed = zonedDayRange(to, clock.timezone)
    range = { start: opened.start, end: closed.end }
  } catch {
    throw new AppError(400, 'Choose a real date')
  }
  const [prior, entries, profile] = await Promise.all([
    prisma.arLedgerEntry.aggregate({
      where: { accountId, createdAt: { lt: range.start } },
      _sum: { debitCents: true, creditCents: true }
    }),
    prisma.arLedgerEntry.findMany({
      where: { accountId, createdAt: { gte: range.start, lt: range.end } },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.restaurantProfile.findFirst()
  ])
  const openingCents = (prior._sum.debitCents ?? 0) - (prior._sum.creditCents ?? 0)
  const lines = entries.map(toLedgerDto)
  const sumKind = (kind: string, field: 'debitCents' | 'creditCents') =>
    entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entry[field], 0)
  return {
    currency: clock.currency,
    restaurantName: profile?.name ?? 'Towns',
    branchName: clock.name,
    branchAddress: clock.address,
    account: toAccountDto(account, clock.today),
    from,
    to,
    openingCents,
    closingCents: lines.length ? lines[lines.length - 1]!.balanceCents : openingCents,
    salesCents: sumKind('INVOICE', 'debitCents'),
    paymentsCents: sumKind('PAYMENT', 'creditCents'),
    refundsCents: sumKind('REFUND', 'creditCents') + sumKind('VOID', 'creditCents'),
    writeOffCents: sumKind('WRITE_OFF', 'creditCents'),
    entries: lines
  }
}
