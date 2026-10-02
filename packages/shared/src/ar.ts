import type { ArAccountStatus, ArInvoiceStatus, ArTerms } from './enums.js'
import { AR_TERMS_LABEL } from './enums.js'

/** Calendar days added to the invoice date. Custom terms use the account's own day count. */
export const AR_TERM_DAYS = {
  DUE_IMMEDIATELY: 0,
  NET_7: 7,
  NET_15: 15,
  NET_30: 30,
  NET_45: 45,
  NET_60: 60
} as const

export function termDays(terms: ArTerms, customTermDays: number): number {
  if (terms === 'CUSTOM') return customTermDays
  return AR_TERM_DAYS[terms]
}

export function termsLabel(terms: ArTerms, customTermDays: number): string {
  if (terms === 'CUSTOM') {
    if (customTermDays === 0) return 'Due immediately'
    if (customTermDays === 1) return '1 day'
    return `${customTermDays} days`
  }
  return AR_TERMS_LABEL[terms]
}

/** Only an active account can take a new credit sale. */
export function accountCanCharge(status: ArAccountStatus): boolean {
  return status === 'ACTIVE'
}

export function accountBlockMessage(status: ArAccountStatus): string | null {
  if (status === 'ACTIVE') return null
  if (status === 'INACTIVE') return 'This account is currently inactive and cannot be used for credit sales.'
  if (status === 'SUSPENDED') return 'This account is suspended and cannot be used for credit sales.'
  return 'This account is closed and cannot be used for credit sales.'
}

/** Null when the account has no credit limit. */
export function availableCredit(limitCents: number | null, balanceCents: number): number | null {
  if (limitCents == null) return null
  return limitCents - balanceCents
}

export function creditDecision(input: {
  limitCents: number | null
  enforce: boolean
  balanceCents: number
  requestedCents: number
}): { ok: true } | { ok: false; availableCents: number } {
  if (input.limitCents == null || !input.enforce) return { ok: true }
  const availableCents = input.limitCents - input.balanceCents
  if (input.requestedCents > availableCents) return { ok: false, availableCents }
  return { ok: true }
}

export interface InvoiceMoney {
  originalCents: number
  paidCents: number
  refundedCents: number
  writtenOffCents: number
  voided: boolean
}

/** What the customer still owes on one invoice. A voided invoice owes nothing. */
export function invoiceRemaining(row: InvoiceMoney): number {
  if (row.voided) return 0
  return row.originalCents - row.paidCents - row.refundedCents - row.writtenOffCents
}

/**
 * One status per invoice.
 * Overdue wins over partially paid so a past-due balance is never shown as merely open.
 */
export function invoiceStatus(row: InvoiceMoney & { dueOn: string; today: string }): ArInvoiceStatus {
  if (row.voided) return 'VOIDED'
  const remaining = invoiceRemaining(row)
  if (remaining === 0 && row.writtenOffCents > 0) return 'WRITTEN_OFF'
  if (remaining === 0) return 'PAID'
  if (row.dueOn < row.today) return 'OVERDUE'
  if (row.paidCents > 0) return 'PARTIALLY_PAID'
  return 'OPEN'
}

export function calendarDaysBetween(earlier: string, later: string): number {
  const start = parseDay(earlier)
  const end = parseDay(later)
  const ms = Date.UTC(end.year, end.month - 1, end.date) - Date.UTC(start.year, start.month - 1, start.date)
  return Math.round(ms / 86_400_000)
}

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90'

/** Aging is measured from the due date, not the day of the sale. */
export function agingBucket(dueOn: string, today: string): AgingBucket {
  const days = calendarDaysBetween(dueOn, today)
  if (days <= 0) return 'current'
  if (days <= 30) return 'd1_30'
  if (days <= 60) return 'd31_60'
  if (days <= 90) return 'd61_90'
  return 'd90'
}

export interface AgingTotals {
  currentCents: number
  days1To30Cents: number
  days31To60Cents: number
  days61To90Cents: number
  days90PlusCents: number
  totalCents: number
}

export function emptyAging(): AgingTotals {
  return {
    currentCents: 0,
    days1To30Cents: 0,
    days31To60Cents: 0,
    days61To90Cents: 0,
    days90PlusCents: 0,
    totalCents: 0
  }
}

export function addAging(totals: AgingTotals, bucket: AgingBucket, cents: number): AgingTotals {
  const next = { ...totals, totalCents: totals.totalCents + cents }
  if (bucket === 'current') next.currentCents += cents
  else if (bucket === 'd1_30') next.days1To30Cents += cents
  else if (bucket === 'd31_60') next.days31To60Cents += cents
  else if (bucket === 'd61_90') next.days61To90Cents += cents
  else next.days90PlusCents += cents
  return next
}

export interface AllocationLine {
  invoiceId: string
  amountCents: number
}

/**
 * A payment may be split across invoices, and any remainder stays unapplied.
 * Nothing may exceed the payment or an invoice's own balance.
 */
export function reviewAllocations(
  paymentCents: number,
  lines: readonly AllocationLine[],
  remainingByInvoice: ReadonlyMap<string, number>
): { ok: true; appliedCents: number; unappliedCents: number } | { ok: false; message: string } {
  if (paymentCents <= 0) return { ok: false, message: 'Enter a payment amount.' }
  const seen = new Set<string>()
  let appliedCents = 0
  for (const line of lines) {
    if (line.amountCents <= 0) return { ok: false, message: 'Enter an amount for each selected invoice.' }
    if (seen.has(line.invoiceId)) return { ok: false, message: 'That invoice was selected twice.' }
    seen.add(line.invoiceId)
    const remaining = remainingByInvoice.get(line.invoiceId)
    if (remaining == null) return { ok: false, message: 'Choose invoices on this account.' }
    if (line.amountCents > remaining) return { ok: false, message: 'That is more than the invoice balance.' }
    appliedCents += line.amountCents
  }
  if (appliedCents > paymentCents) return { ok: false, message: 'The amounts selected are more than the payment.' }
  return { ok: true, appliedCents, unappliedCents: paymentCents - appliedCents }
}

export interface DayMoneyInput {
  cashSales: number
  cardSales: number
  otherSales: number
  arSales: number
  cashCollections: number
  cardCollections: number
  otherCollections: number
  cashRefunds: number
  cardRefunds: number
  otherRefunds: number
  accountRefunds: number
}

/**
 * Sales include account charges. The drawer only moves when cash is taken or returned.
 * Account collections paid in cash are drawer money. New account sales are not.
 */
export function dayMoney(input: DayMoneyInput): {
  salesCents: number
  refundCents: number
  netCents: number
  cashDrawerCents: number
  arSalesCents: number
  arCollectionsCents: number
} {
  const salesCents = input.cashSales + input.cardSales + input.otherSales + input.arSales
  const refundCents = input.cashRefunds + input.cardRefunds + input.otherRefunds + input.accountRefunds
  return {
    salesCents,
    refundCents,
    netCents: salesCents - refundCents,
    cashDrawerCents: input.cashSales + input.cashCollections - input.cashRefunds,
    arSalesCents: input.arSales,
    arCollectionsCents: input.cashCollections + input.cardCollections + input.otherCollections
  }
}

function parseDay(day: string): { year: number; month: number; date: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) throw new Error('Invalid day')
  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, date))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== date) {
    throw new Error('Invalid day')
  }
  return { year, month, date }
}
