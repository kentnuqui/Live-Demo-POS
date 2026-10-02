import { orderServiceLabel, type OrderDto } from '@towns/shared'

/** Floor label, with closed checks named from their stored status. */
export function boardStatusLabel(order: OrderDto): string {
  if (order.status === 'CANCELLED') return 'Cancelled'
  if (order.status === 'COMPLETED') return 'Completed'
  return orderServiceLabel(order)
}

export function boardStatusClass(order: OrderDto): string {
  if (order.status === 'CANCELLED' || order.status === 'COMPLETED') return 'bg-muted text-muted-foreground'
  if (order.serviceStatus === 'READY_TO_SERVE') return 'bg-accent/10 text-accent'
  if (order.serviceStatus === 'PREPARING' || order.status === 'BILLING' || order.status === 'PREPARING') {
    return 'bg-muted text-foreground'
  }
  return 'bg-muted text-muted-foreground'
}

/** How a check is named in a sentence, for confirmations and toasts. */
export function orderTitle(order: Pick<OrderDto, 'ticketNumber' | 'tableLabel' | 'guestName'>): string {
  if (order.ticketNumber) return `Order #${order.ticketNumber}`
  if (order.tableLabel) return `The order for Table ${order.tableLabel}`
  if (order.guestName.trim()) return `The order for ${order.guestName.trim()}`
  return 'This order'
}

/** Formats a timestamp in the branch timezone. An empty zone stays blank rather than using the browser clock. */
export function formatBoardTime(iso: string, timeZone: string | undefined, withDate: boolean): string {
  if (!timeZone) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: withDate ? 'short' : undefined,
    day: withDate ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso))
}
