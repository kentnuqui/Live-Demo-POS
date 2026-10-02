import type { OrderStatus, TableStatus } from './enums.js'

export const CANCEL_REASONS = [
  'CUSTOMER_CANCELLED',
  'DUPLICATE_ORDER',
  'WRONG_ORDER',
  'KITCHEN_ISSUE',
  'CUSTOMER_LEFT',
  'OTHER'
] as const
export type CancelReason = (typeof CANCEL_REASONS)[number]

export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  CUSTOMER_CANCELLED: 'Customer cancelled',
  DUPLICATE_ORDER: 'Duplicate order',
  WRONG_ORDER: 'Wrong order',
  KITCHEN_ISSUE: 'Kitchen issue',
  CUSTOMER_LEFT: 'Customer left',
  OTHER: 'Other'
}

/** Stored on the check. "Other" keeps the cashier's explanation instead of the label. */
export function cancelReasonText(reason: CancelReason, note?: string): string {
  const detail = note?.trim() ?? ''
  if (reason === 'OTHER') return detail ? `Other: ${detail}` : 'Other'
  return detail ? `${CANCEL_REASON_LABEL[reason]}: ${detail}` : CANCEL_REASON_LABEL[reason]
}

/**
 * Why a check cannot be cancelled, or null when it can.
 * Cancelling never moves money. A check with money taken has to be closed and refunded,
 * and a closed check already has Refund.
 */
export function orderCancelBlock(order: { status: OrderStatus; paidCents: number }): string | null {
  if (order.status === 'CANCELLED') return 'This order has already been cancelled.'
  if (order.status === 'COMPLETED') return 'This order is closed. Use Refund on the check instead.'
  if (order.paidCents > 0) {
    return 'A payment was already taken on this order. Collect the balance and use Refund on the check instead.'
  }
  return null
}

export interface CancelledTable {
  label: string
  status: TableStatus
}

/** Toast after a cancel. Says what happened to the table, because that is what the floor needs next. */
export function cancelSuccessMessage(title: string, table: CancelledTable | null): string {
  const done = `${title} cancelled successfully.`
  if (!table) return done
  if (table.status === 'OCCUPIED' || table.status === 'BILLING') {
    return `${done} Table ${table.label} remains occupied by another active order.`
  }
  if (table.status === 'RESERVED') return `${done} Table ${table.label} is held for an upcoming reservation.`
  if (table.status === 'CLEANING') return `${done} Table ${table.label} is waiting to be cleaned.`
  return `${done} Table ${table.label} is now available.`
}
