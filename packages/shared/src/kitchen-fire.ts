import type { KitchenStatus, KitchenSubmissionKind } from './enums.js'

/**
 * A check can be fired more than once.
 * These helpers decide the unsent remainder so a later send cannot cook the original items again.
 */
export interface FireLine {
  quantity: number
  firedQuantity: number
  sentAt?: Date | string | null
  voided?: boolean
}

/**
 * How many of this line have already gone to the kitchen.
 * Older rows only stored sentAt, so a sent line with no fired count counts as fully fired.
 */
export function firedCount(item: Pick<FireLine, 'quantity' | 'firedQuantity' | 'sentAt'>): number {
  if (item.firedQuantity > 0) return item.firedQuantity
  if (item.sentAt) return item.quantity
  return 0
}

/** Quantity still waiting for Send to kitchen. Never negative. */
export function unsentQuantity(item: FireLine): number {
  if (item.voided) return 0
  return Math.max(0, item.quantity - firedCount(item))
}

/**
 * Copies each line down to the unsent remainder.
 * A burger already fired at 1, now ordered at 2, leaves as burger × 1.
 */
export function linesToFire<T extends FireLine>(items: readonly T[]): T[] {
  return items.flatMap((item) => {
    const quantity = unsentQuantity(item)
    if (quantity <= 0) return []
    return [{ ...item, quantity }]
  })
}

/** The first firing is the original ticket. Every firing after that is an addition. */
export function submissionKind(priorCount: number): KitchenSubmissionKind {
  return priorCount > 0 ? 'ADDITION' : 'INITIAL'
}

export function kitchenSendMessage(count: number): string {
  if (count <= 0) return 'No new items to send.'
  if (count === 1) return '1 new item sent to kitchen.'
  return `${count} new items sent to kitchen.`
}

export function formatKitchenLines(items: ReadonlyArray<{ name: string; quantity: number }>): string {
  return items.map((item) => `${item.name} ×${item.quantity}`).join(', ')
}

/**
 * Parent pass state for the floor.
 * A new addition does not mark the whole check ready, and it does not hide a ticket already being cooked.
 */
export function aggregateKitchenStatus(statuses: readonly KitchenStatus[]): KitchenStatus | null {
  if (statuses.length === 0) return null
  const active = statuses.filter((status) => status !== 'COMPLETED')
  if (active.length === 0) return 'COMPLETED'
  if (active.every((status) => status === 'NEW')) return 'NEW'
  if (active.every((status) => status === 'READY')) return 'READY'
  return 'PREPARING'
}

export interface CancelSlice {
  id: string
  orderItemId: string | null
  quantity: number
  cancelledQuantity: number
}

/**
 * Marks already-fired quantity as cancelled, newest firing first.
 * The input order is the priority. This never produces a negative cook quantity.
 */
export function allocateCancellation<T extends CancelSlice>(lines: readonly T[], orderItemId: string, amount: number): T[] {
  let left = Math.max(0, amount)
  return lines.map((line) => {
    if (left <= 0 || line.orderItemId !== orderItemId) return line
    const open = Math.max(0, line.quantity - line.cancelledQuantity)
    if (open <= 0) return line
    const take = Math.min(open, left)
    left -= take
    return { ...line, cancelledQuantity: line.cancelledQuantity + take }
  })
}
