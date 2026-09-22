import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, formatMoney, minorExponent, type OrderDto, type PaymentMethod } from '@towns/shared'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const PRESET_PERCENTS = [10, 15, 20]
const REFUND_REASONS = ['Wrong item', 'Guest changed mind', 'Quality']
const MAX_CENTS = 100_000_000

interface DiscountDialogProps {
  order: OrderDto
  pending: boolean
  onApply: (body: { kind: 'NONE' | 'PERCENT' | 'AMOUNT'; value: number; label?: string }) => void
}

/** Percent chips or a fixed amount, taken off the items before tax. */
export function DiscountDialog({ order, pending, onApply }: DiscountDialogProps) {
  const [label, setLabel] = useState(order.discountLabel)
  const [amountText, setAmountText] = useState('')
  const currency = order.currency

  return (
    <>
      <DialogTitle>Discount</DialogTitle>
      <DialogDescription>Taken off the items before tax.</DialogDescription>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {PRESET_PERCENTS.map((percent) => (
          <Button key={percent} variant="outline" disabled={pending} onClick={() => onApply({ kind: 'PERCENT', value: percent * 100, label })}>
            {percent}%
          </Button>
        ))}
      </div>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const cents = parseMajor(amountText, currency)
          if (cents === null || cents <= 0) return
          onApply({ kind: 'AMOUNT', value: cents, label })
        }}
      >
        <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Reason, optional" maxLength={40} />
        <div className="flex gap-2">
          <Input
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            inputMode="decimal"
            placeholder="Amount off"
          />
          <Button type="submit" disabled={pending || !amountText.trim()}>
            Apply
          </Button>
        </div>
      </form>
      {order.discountCents > 0 ? (
        <Button className="mt-3 w-full" variant="ghost" disabled={pending} onClick={() => onApply({ kind: 'NONE', value: 0 })}>
          Remove discount
        </Button>
      ) : null}
    </>
  )
}

interface PayDialogProps {
  order: OrderDto
  pending: boolean
  onPay: (body: { method: PaymentMethod; amountCents?: number; tenderedCents?: number; note?: string }) => void
}

/** Cash, card, or other. Cash shows the change before the cashier confirms. */
export function PayDialog({ order, pending, onPay }: PayDialogProps) {
  const due = order.balanceCents
  const currency = order.currency
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [tendered, setTendered] = useState(0)
  const [amount, setAmount] = useState(due)
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const editingRef = useRef(false)

  useEffect(() => {
    setAmount(due)
    setTendered(0)
    setEditing(false)
    editingRef.current = false
  }, [due])

  const change = Math.max(0, tendered - due)
  const cashApplied = Math.min(tendered, due)

  return (
    <>
      <DialogTitle>Pay {formatMoney(due, currency)}</DialogTitle>
      <DialogDescription>
        {order.paidCents > 0 ? `${formatMoney(order.paidCents, currency)} already taken.` : 'Choose how the guest is paying.'}
      </DialogDescription>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {PAYMENT_METHODS.map((item) => (
          <Button key={item} variant={method === item ? 'default' : 'outline'} onClick={() => setMethod(item)}>
            {PAYMENT_METHOD_LABEL[item]}
          </Button>
        ))}
      </div>
      {method === 'CASH' ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Received</div>
              <div className="num font-serif text-4xl">{formatMoney(tendered, currency)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Change</div>
              <div className="num font-serif text-3xl">{formatMoney(change, currency)}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setTendered(due)}>
              Exact
            </Button>
            {cashShortcuts(due, currency).map((value) => (
              <Button key={value} variant="outline" onClick={() => setTendered(value)}>
                {formatMoney(value, currency)}
              </Button>
            ))}
          </div>
          <Keypad onPress={(digits) => setTendered((current) => appendDigits(current, digits, MAX_CENTS, false))} onClear={() => setTendered(0)} />
          <Button
            size="lg"
            className="w-full"
            variant="accent"
            disabled={pending || tendered <= 0}
            onClick={() => onPay({ method: 'CASH', tenderedCents: tendered, amountCents: cashApplied })}
          >
            {tendered >= due ? `Change ${formatMoney(change, currency)}` : `Take ${formatMoney(cashApplied, currency)}`}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Amount</div>
            <div className="num font-serif text-4xl">{formatMoney(editing ? amount : due, currency)}</div>
          </div>
          {method === 'OTHER' ? (
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note, optional" maxLength={40} />
          ) : null}
          <Keypad
            onPress={(digits) => {
              const reset = !editingRef.current
              editingRef.current = true
              setEditing(true)
              setAmount((current) => appendDigits(current, digits, due, reset))
            }}
            onClear={() => {
              editingRef.current = false
              setEditing(false)
              setAmount(due)
            }}
          />
          <Button
            size="lg"
            className="w-full"
            variant="accent"
            disabled={pending || (editing && amount <= 0)}
            onClick={() => onPay({ method, amountCents: editing ? amount : due, note: note || undefined })}
          >
            Charge {formatMoney(editing ? amount : due, currency)}
          </Button>
        </div>
      )}
    </>
  )
}

interface RefundDialogProps {
  order: OrderDto
  pending: boolean
  onRefund: (body: { method: PaymentMethod; amountCents: number; reason: string }) => void
}

/** Full or partial refund against a closed check. */
export function RefundDialog({ order, pending, onRefund }: RefundDialogProps) {
  const cap = order.refundableCents
  const currency = order.currency
  const lastMethod = order.payments[order.payments.length - 1]?.method ?? 'CASH'
  const [method, setMethod] = useState<PaymentMethod>(lastMethod)
  const [amount, setAmount] = useState(cap)
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const editingRef = useRef(false)
  const chosen = editing ? amount : cap

  return (
    <>
      <DialogTitle>Refund</DialogTitle>
      <DialogDescription>{formatMoney(cap, currency)} can still be returned.</DialogDescription>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {PAYMENT_METHODS.map((item) => (
          <Button key={item} variant={method === item ? 'default' : 'outline'} onClick={() => setMethod(item)}>
            {PAYMENT_METHOD_LABEL[item]}
          </Button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {REFUND_REASONS.map((item) => (
          <Button key={item} variant={reason === item ? 'default' : 'outline'} onClick={() => setReason(item)}>
            {item}
          </Button>
        ))}
      </div>
      <Input className="mt-3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" maxLength={80} />
      <div className="mt-4">
        <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Amount</div>
        <div className="num font-serif text-4xl">{formatMoney(chosen, currency)}</div>
      </div>
      <div className="mt-3">
        <Keypad
          onPress={(digits) => {
            const reset = !editingRef.current
            editingRef.current = true
            setEditing(true)
            setAmount((current) => appendDigits(current, digits, cap, reset))
          }}
          onClear={() => {
            editingRef.current = false
            setEditing(false)
            setAmount(cap)
          }}
        />
      </div>
      <Button
        className="mt-4 w-full"
        size="lg"
        variant="accent"
        disabled={pending || !reason.trim() || chosen <= 0}
        onClick={() => onRefund({ method, amountCents: chosen, reason: reason.trim() })}
      >
        Refund {formatMoney(chosen, currency)}
      </Button>
    </>
  )
}

function Keypad({ onPress, onClear }: { onPress: (digits: string) => void; onClear: () => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((digit) => (
        <Button key={digit} type="button" variant="outline" className="h-14 text-lg" onClick={() => onPress(digit)}>
          {digit}
        </Button>
      ))}
      <Button type="button" variant="outline" className="h-14" onClick={onClear}>
        Clear
      </Button>
      <Button type="button" variant="outline" className="h-14 text-lg" onClick={() => onPress('0')}>
        0
      </Button>
      <Button type="button" variant="outline" className="h-14 text-lg" onClick={() => onPress('00')}>
        00
      </Button>
    </div>
  )
}

function appendDigits(current: number, digits: string, max: number, reset: boolean): number {
  let next = reset ? 0 : current
  for (const digit of digits) {
    const value = next * 10 + Number(digit)
    if (value > max) return next
    next = value
  }
  return next
}

function cashShortcuts(due: number, currency: string): number[] {
  const exponent = minorExponent(currency)
  const major = due / 10 ** exponent
  const steps = exponent === 0 ? [1000, 5000, 10000] : [5, 10, 20, 50]
  const amounts: number[] = []
  for (const step of steps) {
    const rounded = Math.ceil((major + 0.0001) / step) * step
    const cents = Math.round(rounded * 10 ** exponent)
    if (cents > due && !amounts.includes(cents)) amounts.push(cents)
    if (amounts.length === 3) break
  }
  return amounts
}

function parseMajor(text: string, currency: string): number | null {
  const cleaned = text.replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const exponent = minorExponent(currency)
  const [whole, fraction = ''] = cleaned.split('.')
  if (cleaned.split('.').length > 2) return null
  const padded = (fraction + '0'.repeat(exponent)).slice(0, exponent)
  const minor = Number(whole || '0') * 10 ** exponent + Number(padded || '0')
  return Number.isFinite(minor) ? minor : null
}
