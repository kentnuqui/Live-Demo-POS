import {
  PAYMENT_METHOD_LABEL,
  buildReceipt,
  type BranchSettingsDto,
  type OrderDto,
  type PrinterDto
} from '@towns/shared'

/** Guest receipt for the check, using the branch header, footer, and recorded tenders. */
export function guestReceipt(
  order: OrderDto,
  settings: BranchSettingsDto,
  restaurantName: string,
  branchName: string
): string[] {
  return buildReceipt(
    {
      restaurantName,
      branchName,
      banner: settings.receiptHeader || undefined,
      tableLabel: order.tableLabel,
      orderType: order.type,
      guestName: order.guestName,
      serverName: order.serverName,
      showTable: settings.showTableOnReceipt,
      showServer: settings.showServerOnReceipt,
      when: new Date(order.closedAt ?? order.createdAt).toLocaleString()
    },
    order.items,
    {
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      discountLabel: discountName(order),
      serviceChargeCents: order.serviceChargeCents,
      serviceChargeLabel: settings.serviceChargeLabel,
      totalCents: order.totalCents,
      payments: (order.payments ?? []).map((payment) => ({
        method: PAYMENT_METHOD_LABEL[payment.method],
        amountCents: payment.amountCents,
        tenderedCents: payment.tenderedCents,
        changeCents: payment.changeCents
      })),
      refunds: (order.refunds ?? []).map((refund) => ({
        method: PAYMENT_METHOD_LABEL[refund.method],
        amountCents: refund.amountCents,
        reason: refund.reason
      }))
    },
    settings.receiptFooter
  )
}

export function discountName(order: Pick<OrderDto, 'discountKind' | 'discountValue' | 'discountLabel'>): string {
  if (order.discountLabel) return order.discountLabel
  if (order.discountKind === 'PERCENT') return `${order.discountValue / 100}% off`
  return 'Discount'
}

function receiptPrinter(printers: PrinterDto[]): PrinterDto | undefined {
  return (
    printers.find((printer) => printer.isActive && printer.kind === 'RECEIPT' && printer.isDefault && printer.address) ??
    printers.find((printer) => printer.isActive && printer.kind === 'RECEIPT' && printer.address)
  )
}

/** Sends the guest receipt to the branch receipt printer. */
export async function printGuestReceipt(
  lines: string[],
  printers: PrinterDto[]
): Promise<'printed' | 'missing' | 'failed'> {
  const printer = receiptPrinter(printers)
  if (!printer?.address || !window.towns || lines.length === 0) return 'missing'
  const result = await window.towns.hardware.print(printer.address, lines)
  return result.ok ? 'printed' : 'failed'
}

/** Opens the cash drawer on the receipt printer. A missing printer is ignored. */
export async function openCashDrawer(printers: PrinterDto[]): Promise<void> {
  const printer = receiptPrinter(printers)
  if (!printer?.address || !window.towns) return
  await window.towns.hardware.drawer(printer.address)
}
