import type { Prisma } from '@prisma/client'
import type { ArListQuery } from '@towns/shared'
import { hasPermission } from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { startOfMonth, zonedDayRange } from '../lib/day.js'
import { prisma } from '../lib/prisma.js'
import { invoiceInclude, toInvoiceDto } from './ar-present.js'
import { branchClock } from './ar-support.js'

const OPEN: Prisma.ArInvoiceWhereInput = {
  remainingCents: { gt: 0 },
  status: { notIn: ['VOIDED', 'WRITTEN_OFF'] }
}

/** Dashboard totals. Open balances are summed in the database. */
export async function arSummary(branchId: string) {
  const clock = await branchClock(prisma, branchId)
  const monthStart = startOfMonth(clock.today)
  let todayRange: { start: Date; end: Date }
  let monthRange: { start: Date; end: Date }
  try {
    todayRange = zonedDayRange(clock.today, clock.timezone)
    monthRange = { start: zonedDayRange(monthStart, clock.timezone).start, end: todayRange.end }
  } catch {
    throw new AppError(400, 'Choose a real date')
  }
  const [buckets, partial, collectedToday, collectedMonth, unapplied] = await Promise.all([
    prisma.$queryRaw<Array<{ total: number; current: number; overdue: number; overdue_count: number; due_today: number; due_today_count: number }>>`
      SELECT
        COALESCE(SUM(remaining_cents), 0)::int AS total,
        COALESCE(SUM(remaining_cents) FILTER (WHERE due_on >= ${clock.today}), 0)::int AS current,
        COALESCE(SUM(remaining_cents) FILTER (WHERE due_on < ${clock.today}), 0)::int AS overdue,
        COUNT(*) FILTER (WHERE due_on < ${clock.today})::int AS overdue_count,
        COALESCE(SUM(remaining_cents) FILTER (WHERE due_on = ${clock.today}), 0)::int AS due_today,
        COUNT(*) FILTER (WHERE due_on = ${clock.today})::int AS due_today_count
      FROM ar_invoices
      WHERE branch_id = ${branchId}
        AND remaining_cents > 0
        AND status NOT IN ('VOIDED'::"ar_invoice_status", 'WRITTEN_OFF'::"ar_invoice_status")
    `,
    prisma.arInvoice.aggregate({
      where: { branchId, ...OPEN, paidCents: { gt: 0 } },
      _sum: { remainingCents: true },
      _count: true
    }),
    prisma.arPayment.aggregate({
      where: { branchId, createdAt: { gte: todayRange.start, lt: todayRange.end } },
      _sum: { amountCents: true }
    }),
    prisma.arPayment.aggregate({
      where: { branchId, createdAt: { gte: monthRange.start, lt: monthRange.end } },
      _sum: { amountCents: true }
    }),
    prisma.arPayment.aggregate({
      where: { branchId, unappliedCents: { gt: 0 } },
      _sum: { unappliedCents: true }
    })
  ])
  const row = buckets[0]
  return {
    currency: clock.currency,
    timezone: clock.timezone,
    today: clock.today,
    totalCents: numberOf(row?.total),
    currentCents: numberOf(row?.current),
    overdueCents: numberOf(row?.overdue),
    overdueCount: numberOf(row?.overdue_count),
    dueTodayCents: numberOf(row?.due_today),
    dueTodayCount: numberOf(row?.due_today_count),
    partiallyPaidCents: partial._sum?.remainingCents ?? 0,
    partiallyPaidCount: partial._count,
    collectionTodayCents: collectedToday._sum.amountCents ?? 0,
    collectionMonthCents: collectedMonth._sum.amountCents ?? 0,
    unappliedCents: unapplied._sum.unappliedCents ?? 0
  }
}

export async function listInvoices(branchId: string, query: ArListQuery, openOnly = false) {
  const clock = await branchClock(prisma, branchId)
  const where = invoiceWhere(branchId, query, clock.today, openOnly)
  const [rows, total] = await Promise.all([
    prisma.arInvoice.findMany({
      where,
      include: invoiceInclude,
      orderBy: [{ dueOn: 'asc' }, { invoiceNumber: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    }),
    prisma.arInvoice.count({ where })
  ])
  return {
    invoices: rows.map((row) => toInvoiceDto(row, clock.today)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    today: clock.today,
    currency: clock.currency
  }
}

export async function getInvoice(branchId: string, invoiceId: string) {
  const clock = await branchClock(prisma, branchId)
  const invoice = await prisma.arInvoice.findFirst({ where: { id: invoiceId, branchId }, include: invoiceInclude })
  if (!invoice) throw new AppError(404, 'Invoice not found.')
  return toInvoiceDto(invoice, clock.today)
}

export async function outstandingReport(actor: AuthUser, branchId: string, query: ArListQuery) {
  assertReports(actor)
  return listInvoices(branchId, query, true)
}

function invoiceWhere(branchId: string, query: ArListQuery, today: string, openOnly = false): Prisma.ArInvoiceWhereInput {
  const where: Prisma.ArInvoiceWhereInput = { branchId }
  if (openOnly) {
    where.remainingCents = { gt: 0 }
    where.status = { notIn: ['VOIDED', 'WRITTEN_OFF'] }
  }
  if (query.accountId) where.accountId = query.accountId
  if (query.cashierId) where.cashierId = query.cashierId
  if (query.from || query.to) {
    where.invoiceOn = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {})
    }
  }
  if (query.dueFrom || query.dueTo) {
    where.dueOn = {
      ...(query.dueFrom ? { gte: query.dueFrom } : {}),
      ...(query.dueTo ? { lte: query.dueTo } : {})
    }
  }
  if (query.q) {
    where.OR = [
      { invoiceNumber: { contains: query.q, mode: 'insensitive' } },
      { account: { companyName: { contains: query.q, mode: 'insensitive' } } },
      { account: { customerName: { contains: query.q, mode: 'insensitive' } } },
      { account: { accountNumber: { contains: query.q, mode: 'insensitive' } } },
      { cashier: { firstName: { contains: query.q, mode: 'insensitive' } } },
      { cashier: { lastName: { contains: query.q, mode: 'insensitive' } } }
    ]
  }
  if (query.open === '1') {
    where.remainingCents = { gt: 0 }
    where.status = { notIn: ['VOIDED', 'WRITTEN_OFF', 'PAID'] }
  } else if (query.overdue === '1') {
    where.remainingCents = { gt: 0 }
    where.dueOn = { ...(where.dueOn as object), lt: today }
    where.status = { notIn: ['VOIDED', 'WRITTEN_OFF'] }
  } else if (query.invoiceStatus === 'OVERDUE') {
    where.remainingCents = { gt: 0 }
    where.dueOn = { lt: today }
    where.status = { notIn: ['VOIDED', 'WRITTEN_OFF', 'PAID'] }
  } else if (query.invoiceStatus === 'OPEN') {
    where.remainingCents = { gt: 0 }
    where.paidCents = 0
    where.dueOn = { gte: today }
    where.status = { notIn: ['VOIDED', 'WRITTEN_OFF'] }
  } else if (query.invoiceStatus === 'PARTIALLY_PAID') {
    where.paidCents = { gt: 0 }
    where.remainingCents = { gt: 0 }
    where.status = { notIn: ['VOIDED', 'WRITTEN_OFF'] }
  } else if (query.invoiceStatus) {
    where.status = query.invoiceStatus
  }
  return where
}

function assertReports(actor: AuthUser) {
  if (!hasPermission(actor.role, 'ar.reports')) throw new AppError(403, 'You do not have access to this')
}

function numberOf(value: number | bigint | undefined): number {
  return Number(value ?? 0)
}

export { assertReports }
