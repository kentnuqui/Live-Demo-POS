import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  creditDecision,
  formatMoney,
  hasPermission,
  minorExponent,
  settleSplitTenders,
  type ArAccountDto,
  type OrderDto,
  type PaymentInput,
  type PaymentMethod
} from '@towns/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useSession } from '@/stores/session-store'
import { useUi } from '@/stores/ui-store'

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
  onPay: (body: {
    method: PaymentMethod
    amountCents?: number
    tenderedCents?: number
    note?: string
    arAccountId?: string
    overridePin?: string
    override?: boolean
  }) => void
  onSplitPay: (payments: PaymentInput[]) => void
}

/** Cash, card, or other. Split payment is a separate screen so a single tender stays one tap. */
export function PayDialog({ order, pending, onPay, onSplitPay }: PayDialogProps) {
  const [split, setSplit] = useState(() => readSplitDrafts(order.id).length > 0)
  if (split) {
    return <SplitPayment order={order} pending={pending} onSingle={() => setSplit(false)} onComplete={onSplitPay} />
  }
  return <SinglePay order={order} pending={pending} onPay={onPay} onSplit={() => setSplit(true)} />
}

/** Cash, card, other, or a house account. Cash shows the change before the cashier confirms. */
function SinglePay({
  order,
  pending,
  onPay,
  onSplit
}: {
  order: OrderDto
  pending: boolean
  onPay: PayDialogProps['onPay']
  onSplit: () => void
}) {
  const due = order.balanceCents
  const currency = order.currency
  const user = useSession((state) => state.user)
  const offline = useUi((state) => state.connection) === 'offline'
  const canAccount = !!user && hasPermission(user.role, 'ar.sell')
  const methods = canAccount ? PAYMENT_METHODS : PAYMENT_METHODS.filter((item) => item !== 'ACCOUNT')
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
      <Button type="button" variant="outline" className="mt-5 h-12 w-full" onClick={onSplit}>
        Split payment
      </Button>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {methods.map((item) => (
          <Button key={item} className="h-12" variant={method === item ? 'default' : 'outline'} onClick={() => setMethod(item)}>
            {item === 'ACCOUNT' ? 'Account' : PAYMENT_METHOD_LABEL[item]}
          </Button>
        ))}
      </div>
      {method === 'ACCOUNT' ? (
        <AccountCharge
          order={order}
          pending={pending}
          offline={offline}
          canOverride={!!user && hasPermission(user.role, 'ar.override')}
          onPay={onPay}
        />
      ) : method === 'CASH' ? (
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

const SPLIT_LIMIT = 12

interface SplitDraft {
  id: string
  method: PaymentMethod
  tenderedCents: number
  note: string
}

interface SplitPaymentProps {
  order: OrderDto
  pending: boolean
  onSingle: () => void
  onComplete: (payments: PaymentInput[]) => void
}

/**
 * Stages several tenders on one check. Nothing is saved until the balance is covered
 * and the cashier completes, so a removed line never touches another payment.
 */
function SplitPayment({ order, pending, onSingle, onComplete }: SplitPaymentProps) {
  const currency = order.currency
  const [drafts, setDrafts] = useState<SplitDraft[]>(() => readSplitDrafts(order.id))
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [amount, setAmount] = useState(order.balanceCents)
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const editingRef = useRef(false)
  const addLock = useRef(false)
  const completeLock = useRef(false)

  const review = reviewDrafts(order.balanceCents, drafts)
  const paidCents = order.paidCents + review.appliedCents
  const offered = editing ? amount : review.remainingCents
  const change = method === 'CASH' ? Math.max(0, offered - review.remainingCents) : 0
  const ready = review.ready && drafts.length > 0

  useEffect(() => {
    writeSplitDrafts(order.id, drafts)
    addLock.current = false
  }, [drafts, order.id])

  useEffect(() => {
    if (!pending) completeLock.current = false
  }, [pending])

  useEffect(() => {
    editingRef.current = false
    setEditing(false)
    setAmount(review.remainingCents)
  }, [review.remainingCents])

  function addPayment() {
    if (addLock.current || pending || completeLock.current) return
    if (drafts.length >= SPLIT_LIMIT) {
      setMessage('Too many payments on this check.')
      return
    }
    if (review.remainingCents <= 0) {
      setMessage('This check is already covered.')
      return
    }
    if (method === 'ACCOUNT') {
      setMessage('Account sales cover the full balance. Use Account on the main payment screen.')
      return
    }
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      setMessage('Please choose a payment method.')
      return
    }
    const tendered = offered
    if (tendered <= 0) {
      setMessage('Please enter a valid payment amount.')
      return
    }
    if (method !== 'CASH' && tendered > review.remainingCents) {
      setMessage('Payment amount cannot exceed the remaining balance.')
      return
    }
    addLock.current = true
    setMessage('')
    setNote('')
    setDrafts((current) => [
      ...current,
      { id: crypto.randomUUID(), method, tenderedCents: tendered, note: note.trim() }
    ])
  }

  function complete() {
    if (!ready || pending || completeLock.current) return
    completeLock.current = true
    onComplete(drafts.map(toPayment))
  }

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.target instanceof HTMLButtonElement) return
        event.preventDefault()
        addPayment()
      }}
    >
      <DialogTitle>Payment</DialogTitle>
      <DialogDescription>Add each payment until nothing is left.</DialogDescription>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Figure label="Order total" value={formatMoney(order.totalCents, currency)} />
        <Figure label="Paid" value={formatMoney(paidCents, currency)} />
        <Figure label="Remaining" value={formatMoney(review.remainingCents, currency)} emphasis />
      </div>

      <div className={review.remainingCents > 0 ? 'mt-5 grid items-start gap-6 md:grid-cols-2' : 'mt-5'}>
      {review.remainingCents > 0 ? (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Payment method</div>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.filter((item) => item !== 'ACCOUNT').map((item) => (
              <Button key={item} type="button" className="h-12" variant={method === item ? 'default' : 'outline'} onClick={() => setMethod(item)}>
                {PAYMENT_METHOD_LABEL[item]}
              </Button>
            ))}
          </div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Amount</div>
              <div className="num font-serif text-4xl">{formatMoney(offered, currency)}</div>
            </div>
            {method === 'CASH' && change > 0 ? (
              <div className="text-right">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Change</div>
                <div className="num font-serif text-3xl">{formatMoney(change, currency)}</div>
              </div>
            ) : null}
          </div>
          {method === 'CASH' ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  editingRef.current = true
                  setEditing(true)
                  setAmount(review.remainingCents)
                }}
              >
                Exact
              </Button>
              {cashShortcuts(review.remainingCents, currency).map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    editingRef.current = true
                    setEditing(true)
                    setAmount(value)
                  }}
                >
                  {formatMoney(value, currency)}
                </Button>
              ))}
            </div>
          ) : null}
          {method === 'OTHER' ? (
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note, optional" maxLength={40} />
          ) : null}
          <Keypad
            compact
            onPress={(digits) => {
              const reset = !editingRef.current
              editingRef.current = true
              setEditing(true)
              const cap = method === 'CASH' ? MAX_CENTS : review.remainingCents
              setAmount((current) => appendDigits(current, digits, cap, reset))
            }}
            onClear={() => {
              editingRef.current = false
              setEditing(false)
              setAmount(review.remainingCents)
            }}
          />
          {message ? (
            <p className="text-sm font-medium" role="alert">
              {message}
            </p>
          ) : null}
          <Button type="button" size="lg" className="w-full" disabled={pending} onClick={addPayment}>
            Add payment
          </Button>
        </div>
      ) : null}

      <div className={review.remainingCents > 0 ? 'md:border-l md:pl-6' : ''}>
        <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Payments</div>
        {order.payments.length === 0 && drafts.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <div className="mt-1 max-h-48 overflow-y-auto">
            {order.payments.map((payment, index) => (
              <PaymentRow
                key={payment.id}
                index={index + 1}
                method={payment.method}
                amountCents={payment.amountCents}
                changeCents={payment.changeCents}
                note={payment.note}
                currency={currency}
              />
            ))}
            {review.lines.map((line, index) => (
              <PaymentRow
                key={line.draft.id}
                index={order.payments.length + index + 1}
                method={line.draft.method}
                amountCents={line.appliedCents > 0 ? line.appliedCents : line.draft.tenderedCents}
                changeCents={line.changeCents}
                note={line.draft.note}
                currency={currency}
                problem={line.problem}
                onRemove={
                  pending
                    ? undefined
                    : () => {
                        setMessage('')
                        setDrafts((current) => current.filter((item) => item.id !== line.draft.id))
                      }
                }
              />
            ))}
          </div>
        )}
        <div className="mt-3 space-y-1 border-t pt-3 text-sm">
          <div className="flex justify-between">
            <span>Total paid</span>
            <span className="num">{formatMoney(paidCents, currency)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Remaining</span>
            <span className="num">{formatMoney(review.remainingCents, currency)}</span>
          </div>
        </div>

      <div className="pt-4">
        <Button
          type="button"
          size="lg"
          className={`h-14 w-full ${!ready && !pending ? '!opacity-100' : ''}`}
          variant={ready ? 'accent' : 'outline'}
          disabled={pending || !ready}
          onClick={complete}
        >
          {review.remainingCents > 0 ? `Remaining balance: ${formatMoney(review.remainingCents, currency)}` : 'Complete payment'}
        </Button>
        <Button type="button" variant="ghost" className="mt-2 w-full" disabled={pending} onClick={onSingle}>
          Single payment
        </Button>
      </div>
      </div>
      </div>
    </div>
  )
}

function Figure({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`num font-serif ${emphasis ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'}`}>{value}</div>
    </div>
  )
}

function PaymentRow({
  index,
  method,
  amountCents,
  changeCents,
  note,
  currency,
  problem,
  onRemove
}: {
  index: number
  method: PaymentMethod
  amountCents: number
  changeCents: number
  note: string
  currency: string
  problem?: string
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b py-2">
      <span className="num w-5 text-sm text-muted-foreground">{index}</span>
      <div className="min-w-0 flex-1">
        <div>{PAYMENT_METHOD_LABEL[method]}</div>
        {changeCents > 0 ? <div className="text-xs text-muted-foreground">Change {formatMoney(changeCents, currency)}</div> : null}
        {note ? <div className="truncate text-xs text-muted-foreground">{note}</div> : null}
        {problem ? (
          <div className="text-xs font-medium" role="alert">
            {problem}
          </div>
        ) : null}
      </div>
      <span className="num shrink-0">{formatMoney(amountCents, currency)}</span>
      {onRemove ? (
        <Button type="button" variant="ghost" className="h-11 shrink-0 px-3" onClick={onRemove}>
          Remove
        </Button>
      ) : null}
    </div>
  )
}

function reviewDrafts(dueCents: number, drafts: SplitDraft[]) {
  const settled = settleSplitTenders(dueCents, drafts.map(toOffer))
  if (settled.ok) {
    return {
      lines: drafts.map((draft, index) => ({
        draft,
        appliedCents: settled.lines[index]?.amountCents ?? 0,
        changeCents: settled.lines[index]?.changeCents ?? 0,
        problem: undefined as string | undefined
      })),
      appliedCents: settled.lines.reduce((sum, line) => sum + line.amountCents, 0),
      remainingCents: settled.remainingCents,
      ready: settled.remainingCents === 0 && drafts.length > 0
    }
  }
  const prefix = settleSplitTenders(dueCents, drafts.slice(0, settled.index).map(toOffer))
  const applied = prefix.ok ? prefix.lines : []
  return {
    lines: drafts.map((draft, index) => {
      if (index < settled.index) {
        return {
          draft,
          appliedCents: applied[index]?.amountCents ?? 0,
          changeCents: applied[index]?.changeCents ?? 0,
          problem: undefined as string | undefined
        }
      }
      if (index === settled.index) {
        return { draft, appliedCents: 0, changeCents: 0, problem: tenderMessage(settled.reason) }
      }
      return { draft, appliedCents: 0, changeCents: 0, problem: undefined as string | undefined }
    }),
    appliedCents: applied.reduce((sum, line) => sum + line.amountCents, 0),
    remainingCents: prefix.ok ? prefix.remainingCents : dueCents,
    ready: false
  }
}

function tenderMessage(reason: 'empty' | 'over'): string {
  return reason === 'empty' ? 'Please enter a valid payment amount.' : 'Payment amount cannot exceed the remaining balance.'
}

function toOffer(draft: SplitDraft) {
  return draft.method === 'CASH'
    ? { method: draft.method, tenderedCents: draft.tenderedCents }
    : { method: draft.method, amountCents: draft.tenderedCents }
}

function toPayment(draft: SplitDraft): PaymentInput {
  const note = draft.note.trim()
  if (draft.method === 'CASH') {
    return { id: draft.id, method: draft.method, tenderedCents: draft.tenderedCents, ...(note ? { note } : {}) }
  }
  return { id: draft.id, method: draft.method, amountCents: draft.tenderedCents, ...(note ? { note } : {}) }
}

function draftKey(orderId: string): string {
  return `towns.split-pay.${orderId}`
}

export function clearSplitDrafts(orderId: string): void {
  try {
    sessionStorage.removeItem(draftKey(orderId))
  } catch {
    /* private mode */
  }
}

function readSplitDrafts(orderId: string): SplitDraft[] {
  try {
    const raw = sessionStorage.getItem(draftKey(orderId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDraft).slice(0, SPLIT_LIMIT)
  } catch {
    return []
  }
}

function writeSplitDrafts(orderId: string, drafts: SplitDraft[]): void {
  try {
    if (drafts.length === 0) sessionStorage.removeItem(draftKey(orderId))
    else sessionStorage.setItem(draftKey(orderId), JSON.stringify(drafts))
  } catch {
    /* the check can still be completed in this visit */
  }
}

function isDraft(value: unknown): value is SplitDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as SplitDraft
  return (
    typeof draft.id === 'string' &&
    (PAYMENT_METHODS as readonly string[]).includes(draft.method) &&
    Number.isInteger(draft.tenderedCents) &&
    draft.tenderedCents > 0 &&
    draft.tenderedCents <= MAX_CENTS &&
    typeof draft.note === 'string' &&
    draft.note.length <= 40
  )
}

interface RefundDialogProps {
  order: OrderDto
  pending: boolean
  onRefund: (body: { method: PaymentMethod; amountCents: number; reason: string }) => void
}

/** Full or partial refund against a closed check. */
export function RefundDialog({ order, pending, onRefund }: RefundDialogProps) {
  const accountSale = order.payments.some((payment) => payment.method === 'ACCOUNT') || !!order.ar
  const methods = accountSale ? PAYMENT_METHODS : PAYMENT_METHODS.filter((item) => item !== 'ACCOUNT')
  const currency = order.currency
  const lastMethod = order.payments[order.payments.length - 1]?.method ?? 'CASH'
  const [method, setMethod] = useState<PaymentMethod>(accountSale ? lastMethod : lastMethod === 'ACCOUNT' ? 'CASH' : lastMethod)
  const cap = method === 'ACCOUNT' ? (order.ar?.remainingCents ?? 0) : order.refundableCents
  const [amount, setAmount] = useState(cap)
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const editingRef = useRef(false)
  const chosen = editing ? amount : cap

  return (
    <>
      <DialogTitle>Refund</DialogTitle>
      <DialogDescription>
        {method === 'ACCOUNT'
          ? `${formatMoney(cap, currency)} is still unpaid on this account.`
          : accountSale
            ? 'This returns money already collected. The open account balance stays the same.'
            : `${formatMoney(order.refundableCents, currency)} can still be returned.`}
      </DialogDescription>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {methods.map((item) => (
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

function AccountCharge({
  order,
  pending,
  offline,
  canOverride,
  onPay
}: {
  order: OrderDto
  pending: boolean
  offline: boolean
  canOverride: boolean
  onPay: PayDialogProps['onPay']
}) {
  const due = order.balanceCents
  const currency = order.currency
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [override, setOverride] = useState(false)

  /** First press opens the company. Pressing that same name again hides or shows the details. */
  function toggleAccount(id: string) {
    if (id === accountId) {
      setDetailsOpen((open) => !open)
      return
    }
    setAccountId(id)
    setDetailsOpen(true)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const accounts = useQuery({
    queryKey: ['ar-pick', order.branchId, search],
    enabled: !offline,
    queryFn: () => api.arAccounts(order.branchId, { q: search || undefined, status: 'ACTIVE', page: 1, pageSize: 8 })
  })
  const selected = accounts.data?.accounts.find((account) => account.id === accountId) ?? null
  const decision = selected
    ? creditDecision({
        limitCents: selected.creditLimitCents,
        enforce: selected.enforceCreditLimit,
        balanceCents: selected.balanceCents,
        requestedCents: due
      })
    : null
  const needsApproval = !!decision && !decision.ok
  const approved = !needsApproval || override || pin.length >= 4

  return (
    <div className="mt-4 space-y-3">
      <div>
        <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Invoice amount</div>
        <div className="num font-serif text-4xl">{formatMoney(due, currency)}</div>
      </div>
      {offline ? <p className="text-sm">AR transactions require a connection.</p> : null}
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search account" />
      <div className="max-h-40 space-y-1 overflow-auto">
        {accounts.isLoading ? <p className="text-sm text-muted-foreground">Loading accounts...</p> : null}
        {accounts.data && accounts.data.accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AR accounts found.</p>
        ) : null}
        {accounts.data?.accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left ${account.id === accountId ? 'border-foreground' : ''}`}
            aria-expanded={account.id === accountId ? detailsOpen : false}
            onClick={() => toggleAccount(account.id)}
          >
            <span>
              <span className="block">{account.companyName}</span>
              <span className="text-xs text-muted-foreground">{account.accountNumber}</span>
            </span>
            <span className="num text-sm">{formatMoney(account.balanceCents, currency)}</span>
          </button>
        ))}
      </div>
      {selected && detailsOpen ? <AccountFacts account={selected} due={due} currency={currency} /> : null}
      {needsApproval && decision && !decision.ok ? (
        <p className="text-sm">
          Credit limit exceeded. Available credit: {formatMoney(decision.availableCents, currency)}. Requested credit:{' '}
          {formatMoney(due, currency)}.
        </p>
      ) : null}
      {needsApproval && canOverride ? (
        <Button type="button" variant={override ? 'default' : 'outline'} onClick={() => setOverride((current) => !current)}>
          Approve credit limit
        </Button>
      ) : null}
      {needsApproval && !canOverride ? (
        <Input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Manager PIN" inputMode="numeric" />
      ) : null}
      <Button
        size="lg"
        className="w-full"
        variant="accent"
        disabled={pending || offline || !selected || !approved}
        onClick={() => {
          if (!selected) return
          onPay({
            method: 'ACCOUNT',
            amountCents: due,
            arAccountId: selected.id,
            ...(override ? { override: true } : {}),
            ...(pin ? { overridePin: pin } : {})
          })
        }}
      >
        {pending ? 'Processing AR sale...' : 'Charge to account'}
      </Button>
    </div>
  )
}

function AccountFacts({ account, due, currency }: { account: ArAccountDto; due: number; currency: string }) {
  const rows = [
    ['Credit limit', account.creditLimitCents == null ? 'No limit' : formatMoney(account.creditLimitCents, currency)],
    ['Current balance', formatMoney(account.balanceCents, currency)],
    ['Available credit', account.availableCents == null ? 'No limit' : formatMoney(account.availableCents, currency)],
    ['Balance after sale', formatMoney(account.balanceCents + due, currency)]
  ]
  return (
    <div className="rounded-xl border px-3 py-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 py-1">
          <span className="text-muted-foreground">{label}</span>
          <span className="num">{value}</span>
        </div>
      ))}
    </div>
  )
}

function Keypad({ onPress, onClear, compact }: { onPress: (digits: string) => void; onClear: () => void; compact?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  const height = compact ? 'h-12 text-base' : 'h-14 text-lg'
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((digit) => (
        <Button key={digit} type="button" variant="outline" className={height} onClick={() => onPress(digit)}>
          {digit}
        </Button>
      ))}
      <Button type="button" variant="outline" className={height} onClick={onClear}>
        Clear
      </Button>
      <Button type="button" variant="outline" className={height} onClick={() => onPress('0')}>
        0
      </Button>
      <Button type="button" variant="outline" className={height} onClick={() => onPress('00')}>
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
