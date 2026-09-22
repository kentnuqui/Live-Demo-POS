import { ORDER_TYPE_LABEL, type MenuStation, type OrderType } from './enums.js'
import { formatMoney } from './money.js'

export interface TicketHeader {
  restaurantName: string
  branchName: string
  tableLabel: string | null
  orderType: string
  guestName: string
  serverName: string | null
  showTable: boolean
  showServer: boolean
  when: string
  banner?: string
}

export interface TicketLineItem {
  quantity: number
  name: string
  notes: string
  unitPriceCents?: number
  voided?: boolean
  modifiers?: Array<{
    modifierName: string
    priceCents: number
  }>
}

function rule(): string {
  return '--------------------------------'
}

function serviceLabel(orderType: string): string {
  if (orderType in ORDER_TYPE_LABEL) return ORDER_TYPE_LABEL[orderType as OrderType]
  return orderType
}

function headerLines(header: TicketHeader, title: string): string[] {
  const lines = [header.restaurantName]
  if (header.banner && header.banner !== header.restaurantName) lines.push(header.banner)
  lines.push(title, rule(), header.when)
  lines.push(serviceLabel(header.orderType))
  if (header.showTable && header.tableLabel) lines.push(`Table ${header.tableLabel}`)
  if (header.guestName) lines.push(header.guestName)
  if (header.showServer && header.serverName) lines.push(`Server ${header.serverName}`)
  lines.push(rule())
  return lines
}

/** Kitchen and bar chits. Prices stay off the pass. */
export function buildStationTicket(
  header: TicketHeader,
  station: MenuStation,
  items: TicketLineItem[]
): string[] {
  const lines = headerLines(header, station)
  for (const item of items) {
    if (item.voided) continue
    lines.push(`${item.quantity}  ${item.name}`)
    
    // Add modifiers (without prices for kitchen)
    if (item.modifiers && item.modifiers.length > 0) {
      for (const modifier of item.modifiers) {
        if (modifier.priceCents >= 0) {
          lines.push(`   + ${modifier.modifierName}`)
        } else {
          lines.push(`   - ${modifier.modifierName}`)
        }
      }
    }
    
    if (item.notes) lines.push(`   ${item.notes}`)
  }
  lines.push(rule())
  return lines
}

export interface ReceiptTotals {
  currency: string
  subtotalCents: number
  discountCents: number
  discountLabel: string
  serviceChargeCents: number
  serviceChargeLabel: string
  totalCents: number
  payments: Array<{ method: string; amountCents: number; tenderedCents: number; changeCents: number }>
  refunds: Array<{ method: string; amountCents: number; reason: string }>
}

/** Guest receipt, including the discount, tenders, change, and any refund. */
export function buildReceipt(header: TicketHeader, items: TicketLineItem[], totals: ReceiptTotals, footer: string): string[] {
  const money = (cents: number) => formatMoney(cents, totals.currency)
  const lines = headerLines(header, 'Receipt')
  for (const item of items) {
    if (item.voided) continue
    lines.push(`${item.quantity}  ${item.name}`)
    
    // Add modifiers with prices for guest receipt
    if (item.modifiers && item.modifiers.length > 0) {
      for (const modifier of item.modifiers) {
        if (modifier.priceCents > 0) {
          lines.push(`   + ${modifier.modifierName} ${money(modifier.priceCents)}`)
        } else if (modifier.priceCents < 0) {
          lines.push(`   - ${modifier.modifierName} ${money(Math.abs(modifier.priceCents))}`)
        } else {
          lines.push(`   ${modifier.modifierName}`)
        }
      }
    }
    
    lines.push(`   ${money((item.unitPriceCents ?? 0) * item.quantity)}`)
    if (item.notes) lines.push(`   ${item.notes}`)
  }
  lines.push(rule())
  lines.push(`Subtotal  ${money(totals.subtotalCents)}`)
  if (totals.discountCents > 0) {
    lines.push(`${totals.discountLabel || 'Discount'}  -${money(totals.discountCents)}`)
  }
  if (totals.serviceChargeCents > 0) {
    lines.push(`${totals.serviceChargeLabel}  ${money(totals.serviceChargeCents)}`)
  }
  lines.push(`Total  ${money(totals.totalCents)}`)
  if (totals.payments.length > 0) {
    lines.push(rule())
    for (const payment of totals.payments) {
      lines.push(`${payment.method}  ${money(payment.amountCents)}`)
      if (payment.tenderedCents > payment.amountCents) {
        lines.push(`Tendered  ${money(payment.tenderedCents)}`)
        lines.push(`Change  ${money(payment.changeCents)}`)
      }
    }
  }
  if (totals.refunds.length > 0) {
    lines.push(rule())
    for (const refund of totals.refunds) {
      lines.push(`Refund ${refund.method}  -${money(refund.amountCents)}`)
      if (refund.reason) lines.push(`   ${refund.reason}`)
    }
  }
  lines.push(rule())
  if (footer) lines.push(footer)
  return lines
}
