import {
  CANCEL_REASONS,
  CANCEL_REASON_LABEL,
  firedCount,
  formatMoney,
  hasPermission,
  type CancelOrderResultDto,
  type CancelReason,
  type OrderDto
} from '@towns/shared'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSession } from '@/stores/session-store'
import { orderTitle } from './order-board'
import { cancelFailure, useCancelOrder } from './use-cancel-order'

interface CancelOrderDialogProps {
  order: OrderDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called once the server confirmed the cancel. */
  onCancelled: (result: CancelOrderResultDto) => void
  /** Called when another terminal got there first. */
  onAlreadyCancelled: (message: string) => void
}

/** Confirms a cancel with a reason. Staff without cancel access enter a manager PIN. */
export function CancelOrderDialog({ order, open, onOpenChange, onCancelled, onAlreadyCancelled }: CancelOrderDialogProps) {
  const branchId = useSession((state) => state.activeBranchId)
  const user = useSession((state) => state.user)
  const cancel = useCancelOrder(branchId)
  const [reason, setReason] = useState<CancelReason | null>(null)
  const [note, setNote] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const lock = useRef(false)

  useEffect(() => {
    if (!open) return
    setReason(null)
    setNote('')
    setPin('')
    setError('')
    lock.current = false
  }, [open, order?.id])

  if (!order) return null

  const needsPin = !user || !hasPermission(user.role, 'orders.cancel')
  const sentToKitchen = order.items.some((item) => !item.voided && firedCount(item) > 0)
  const ready = !!reason && (reason !== 'OTHER' || !!note.trim()) && (!needsPin || pin.length >= 4)
  const pending = cancel.isPending

  function submit() {
    if (!order || !reason || !ready || lock.current) return
    lock.current = true
    setError('')
    cancel.mutate(
      {
        orderId: order.id,
        body: {
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(needsPin ? { overridePin: pin } : {})
        }
      },
      {
        onSuccess: (result) => onCancelled(result),
        onError: (failure) => {
          const { message, alreadyCancelled } = cancelFailure(failure)
          if (alreadyCancelled) {
            onAlreadyCancelled(message)
            return
          }
          setError(message)
        },
        onSettled: () => {
          lock.current = false
        }
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(460px,calc(100%-1.5rem))] overflow-y-auto">
        <DialogTitle>Cancel order?</DialogTitle>
        <DialogDescription>Are you sure you want to cancel {orderTitle(order)}?</DialogDescription>

        <dl className="mt-4 space-y-2 rounded-xl border px-4 py-3 text-sm">
          {order.tableLabel ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Table</dt>
              <dd>Table {order.tableLabel}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="num">{formatMoney(order.totalCents, order.currency)}</dd>
          </div>
        </dl>
        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
          {order.tableLabel ? <p>This will release the table unless another active order is using it.</p> : null}
          {sentToKitchen ? <p>Items already sent will be marked cancelled for the kitchen.</p> : null}
        </div>

        <fieldset className="mt-5" disabled={pending}>
          <legend className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Reason</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {CANCEL_REASONS.map((item) => (
              <Button
                key={item}
                type="button"
                className="h-12"
                variant={reason === item ? 'default' : 'outline'}
                aria-pressed={reason === item}
                onClick={() => setReason(item)}
              >
                {CANCEL_REASON_LABEL[item]}
              </Button>
            ))}
          </div>
          {reason === 'OTHER' ? (
            <Input
              className="mt-3 h-12"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Short explanation"
              aria-label="Cancellation explanation"
              maxLength={120}
              autoFocus
            />
          ) : null}
          {needsPin ? (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">A manager needs to approve this cancellation.</p>
              <Input
                className="mt-2 h-12"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Manager PIN"
                aria-label="Manager PIN"
                inputMode="numeric"
                type="password"
                autoComplete="off"
              />
            </div>
          ) : null}
        </fieldset>

        {error ? (
          <p className="mt-4 text-sm font-medium" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-12 flex-1" disabled={pending} onClick={() => onOpenChange(false)}>
            Keep order
          </Button>
          <Button type="button" variant="accent" className="h-12 flex-1" disabled={!ready || pending} onClick={submit}>
            {pending ? 'Cancelling...' : 'Cancel order'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
