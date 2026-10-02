import { formatMoney, OPEN_ORDER_STATUSES, ORDER_TYPE_LABEL, orderCancelBlock, PAYMENT_METHOD_LABEL, type OrderDto } from '@towns/shared'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { boardStatusClass, boardStatusLabel, formatBoardTime } from './order-board'
import { discountName } from './print-receipt'

interface OrderDetailPanelProps {
  order: OrderDto | null
  loading: boolean
  failed: boolean
  timeZone?: string
  serviceLabel: string
  asDialog?: boolean
  className?: string
  onOpen: () => void
  onClose?: () => void
  onRetry: () => void
  /** Present when this person may start a cancel. Approval is checked in the dialog and on the server. */
  onCancel?: () => void
  offline?: boolean
}

/** Read-only check. Changes still happen on the existing order screen, except cancelling. */
export function OrderDetailPanel({
  order,
  loading,
  failed,
  timeZone,
  serviceLabel,
  asDialog,
  className,
  onOpen,
  onClose,
  onRetry,
  onCancel,
  offline
}: OrderDetailPanelProps) {
  if (loading) {
    return (
      <div className={cn('space-y-3 p-5', className)}>
        {asDialog ? <DialogTitle className="sr-only">Order</DialogTitle> : null}
        <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-56 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (failed || !order) {
    return (
      <div className={cn('p-5', className)}>
        {asDialog ? <DialogTitle className="sr-only">Order</DialogTitle> : null}
        <p className="text-sm text-muted-foreground">Unable to load this order.</p>
        <Button className="mt-3" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }

  const currency = order.currency
  const when = order.closedAt ?? order.createdAt
  const title = order.ticketNumber ? `Order #${order.ticketNumber}` : 'Order'
  const Heading = asDialog ? DialogTitle : 'h2'
  const active = OPEN_ORDER_STATUSES.includes(order.status)
  const cancelBlock = orderCancelBlock(order)

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className={cn('flex items-start justify-between gap-3', asDialog && 'pr-8')}>
          <div>
            <Heading className="font-serif text-3xl leading-none">{title}</Heading>
            <p className="mt-2 text-sm text-muted-foreground">{formatBoardTime(when, timeZone, true)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-1 text-xs', boardStatusClass(order))}>{boardStatusLabel(order)}</span>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Hide order"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <dl className="mt-5 space-y-3 text-sm">
          <Fact label="Customer" value={order.guestName.trim() || 'No name'} />
          {order.guestPhone.trim() ? <Fact label="Phone" value={order.guestPhone.trim()} /> : null}
          <Fact label="Order type" value={ORDER_TYPE_LABEL[order.type]} />
          {order.tableLabel ? <Fact label="Table" value={order.tableLabel} /> : null}
          <Fact label="Server" value={order.serverName || '—'} />
          {order.guestCount > 0 ? <Fact label="Guests" value={String(order.guestCount)} /> : null}
        </dl>

        {order.notes.trim() ? <p className="mt-4 text-sm text-muted-foreground">Note: {order.notes.trim()}</p> : null}

        {order.cancellation ? (
          <dl className="mt-5 space-y-3 border-t pt-4 text-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Cancellation</p>
            <Fact label="Cancelled at" value={formatBoardTime(order.cancellation.at, timeZone, true) || '—'} />
            <Fact label="Cancelled by" value={order.cancellation.byName ?? 'Staff'} />
            {order.cancellation.approvedByName ? <Fact label="Approved by" value={order.cancellation.approvedByName} /> : null}
            <Fact label="Reason" value={order.cancellation.reason || '—'} />
          </dl>
        ) : null}

        <div className="mt-5 space-y-4 border-t pt-4">
          {order.items.length === 0 ? <p className="text-sm text-muted-foreground">No items on this check.</p> : null}
          {order.items.map((item) => (
            <div key={item.id} className={cn('flex items-start justify-between gap-3', item.voided && 'opacity-50')}>
              <div className="min-w-0">
                <div className="font-serif text-lg leading-tight">
                  <span className="num">{item.quantity} × </span>
                  {item.name}
                  {item.voided ? <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">Voided</span> : null}
                </div>
                {item.modifiers && item.modifiers.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.modifiers
                      .map((modifier) =>
                        modifier.priceCents > 0 ? `${modifier.modifierName} (+${formatMoney(modifier.priceCents, currency)})` : modifier.modifierName
                      )
                      .join(', ')}
                  </p>
                ) : null}
                {item.notes.trim() ? <p className="mt-1 text-xs text-muted-foreground">Note: {item.notes.trim()}</p> : null}
              </div>
              <div className="num shrink-0 text-sm">{formatMoney(item.unitPriceCents * item.quantity, currency)}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-1.5 border-t pt-4 text-sm">
          <Row label="Subtotal" value={formatMoney(order.subtotalCents, currency)} />
          {order.discountCents > 0 ? <Row label={discountName(order)} value={`-${formatMoney(order.discountCents, currency)}`} /> : null}
          {order.serviceChargeCents > 0 ? <Row label={serviceLabel} value={formatMoney(order.serviceChargeCents, currency)} /> : null}
          <div className="flex items-center justify-between pt-1">
            <span className="font-serif text-lg">Total</span>
            <span className="num font-serif text-2xl">{formatMoney(order.totalCents, currency)}</span>
          </div>
          {order.paidCents > 0 ? <Row label="Paid" value={formatMoney(order.paidCents, currency)} /> : null}
          {order.balanceCents > 0 && order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? (
            <Row label="Balance" value={formatMoney(order.balanceCents, currency)} />
          ) : null}
          {order.refundedCents > 0 ? <Row label="Refunded" value={formatMoney(order.refundedCents, currency)} /> : null}
          {order.ar ? (
            <>
              <Row label="Account" value={order.ar.accountName} />
              <Row label="Invoice" value={order.ar.invoiceNumber} />
              <Row label="Balance due" value={formatMoney(order.ar.remainingCents, currency)} />
              <Row label="Due" value={order.ar.dueOn} />
            </>
          ) : null}
        </div>

        {order.payments.length > 0 || order.refunds.length > 0 ? (
          <div className="mt-5 space-y-2 border-t pt-4 text-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Payments</p>
            {order.payments.map((payment) => (
              <div key={payment.id} className="flex items-start justify-between gap-3">
                <div>
                  <div>{PAYMENT_METHOD_LABEL[payment.method]}</div>
                  {payment.changeCents > 0 ? (
                    <div className="text-xs text-muted-foreground">Change {formatMoney(payment.changeCents, currency)}</div>
                  ) : null}
                  {payment.note.trim() ? <div className="text-xs text-muted-foreground">{payment.note.trim()}</div> : null}
                </div>
                <div className="text-right">
                  <div className="num">{formatMoney(payment.amountCents, currency)}</div>
                  <div className="text-xs text-muted-foreground">{formatBoardTime(payment.createdAt, timeZone, true)}</div>
                </div>
              </div>
            ))}
            {order.refunds.map((refund) => (
              <div key={refund.id} className="flex items-start justify-between gap-3">
                <div>
                  <div>Refund · {PAYMENT_METHOD_LABEL[refund.method]}</div>
                  {refund.reason.trim() ? <div className="text-xs text-muted-foreground">{refund.reason.trim()}</div> : null}
                </div>
                <div className="num">{formatMoney(refund.amountCents, currency)}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 space-y-2 border-t p-4">
        <Button className="w-full" onClick={onOpen}>
          Open check
        </Button>
        {onCancel && active && !cancelBlock ? (
          <>
            <Button variant="outline" className="w-full text-accent" disabled={offline} onClick={onCancel}>
              Cancel order
            </Button>
            {offline ? <p className="text-center text-xs text-muted-foreground">Cancelling an order needs a connection.</p> : null}
          </>
        ) : null}
        {onCancel && active && cancelBlock ? <p className="text-xs text-muted-foreground">{cancelBlock}</p> : null}
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-muted-foreground">
      <span>{label}</span>
      <span className="num text-foreground">{value}</span>
    </div>
  )
}
