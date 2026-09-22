import { PAYMENT_METHODS, type DailyReportDto, type PaymentMethod, type TenderTotalDto } from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { todayInTimeZone, zonedDayRange } from '../lib/day.js'
import { prisma } from '../lib/prisma.js'

/**
 * Sales for one calendar day in the branch timezone.
 * Checks are counted when they close. Payments and refunds are counted when the money moves,
 * which is what a cashier needs to balance the drawer.
 */
export async function dailyReport(branchId: string, day?: string): Promise<DailyReportDto> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { settings: { select: { currency: true } } }
  })
  if (!branch) throw new AppError(404, 'Branch not found')
  const timezone = safeZone(branch.timezone)
  const today = todayInTimeZone(timezone)
  const selected = day ?? today
  let range: { start: Date; end: Date }
  try {
    range = zonedDayRange(selected, timezone)
  } catch {
    throw new AppError(400, 'Choose a real date')
  }

  const [orders, payments, refunds] = await Promise.all([
    prisma.order.findMany({
      where: { branchId, status: 'COMPLETED', closedAt: { gte: range.start, lt: range.end } },
      select: {
        subtotalCents: true,
        discountCents: true,
        serviceChargeCents: true,
        totalCents: true
      }
    }),
    prisma.payment.findMany({
      where: { createdAt: { gte: range.start, lt: range.end }, order: { branchId } },
      select: { method: true, amountCents: true }
    }),
    prisma.refund.findMany({
      where: { createdAt: { gte: range.start, lt: range.end }, order: { branchId } },
      select: { method: true, amountCents: true }
    })
  ])

  const totals = orders.reduce(
    (sum, order) => ({
      grossCents: sum.grossCents + order.subtotalCents,
      discountCents: sum.discountCents + order.discountCents,
      serviceChargeCents: sum.serviceChargeCents + order.serviceChargeCents,
      salesCents: sum.salesCents + order.totalCents
    }),
    { grossCents: 0, discountCents: 0, serviceChargeCents: 0, salesCents: 0 }
  )
  const tenders = PAYMENT_METHODS.map((method) => tender(method, payments, refunds))
  const refundCents = tenders.reduce((sum, tenderRow) => sum + tenderRow.refundsCents, 0)
  const refundCount = tenders.reduce((sum, tenderRow) => sum + tenderRow.refundCount, 0)

  return {
    day: selected,
    today,
    timezone,
    currency: branch.settings?.currency ?? 'USD',
    transactionCount: orders.length,
    grossCents: totals.grossCents,
    discountCents: totals.discountCents,
    serviceChargeCents: totals.serviceChargeCents,
    salesCents: totals.salesCents,
    refundCents,
    refundCount,
    netCents: totals.salesCents - refundCents,
    tenders
  }
}

function tender(
  method: PaymentMethod,
  payments: Array<{ method: PaymentMethod; amountCents: number }>,
  refunds: Array<{ method: PaymentMethod; amountCents: number }>
): TenderTotalDto {
  const taken = payments.filter((row) => row.method === method)
  const given = refunds.filter((row) => row.method === method)
  const paymentsCents = taken.reduce((sum, row) => sum + row.amountCents, 0)
  const refundsCents = given.reduce((sum, row) => sum + row.amountCents, 0)
  return {
    method,
    paymentsCents,
    paymentCount: taken.length,
    refundsCents,
    refundCount: given.length,
    netCents: paymentsCents - refundsCents
  }
}

function safeZone(timeZone: string): string {
  try {
    todayInTimeZone(timeZone)
    return timeZone
  } catch {
    return 'UTC'
  }
}
