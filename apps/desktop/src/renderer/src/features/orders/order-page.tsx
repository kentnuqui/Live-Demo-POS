import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  formatMoney,
  hasPermission,
  kitchenSendMessage,
  ORDER_TYPE_LABEL,
  orderServiceLabel,
  PAYMENT_METHOD_LABEL,
  type MenuCategoryDto,
  type MenuStation,
  type OrderDto,
  type PaymentInput,
  type PaymentMethod,
  type PrinterDto,
  type PrinterKind,
  type MenuItemDto
} from '@towns/shared'
import { ArrowLeft, Minus, MoreHorizontal, Plus, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError, api, isNetworkError } from '@/lib/api'
import { homePath } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { cached } from '@/features/sync/cache'
import { useSession } from '@/stores/session-store'
import { useToasts } from '@/stores/toast-store'
import { DiscountDialog, PayDialog, RefundDialog, clearSplitDrafts } from './cashier-dialogs'
import { discountName, guestReceipt, openCashDrawer, printGuestReceipt } from './print-receipt'
import { ModifierSelectionDialog } from './modifier-selection'

const STATION_PRINTER: Record<MenuStation, PrinterKind> = {
  KITCHEN: 'KITCHEN',
  SUSHI: 'SUSHI',
  BAR: 'BAR',
  DESSERT: 'DESSERT'
}

export function OrderPage() {
  const { orderId = '' } = useParams()
  const branchId = useSession((state) => state.activeBranchId)
  const user = useSession((state) => state.user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [dialog, setDialog] = useState<'actions' | 'transfer' | 'merge' | 'split' | 'receipt' | 'pay' | 'discount' | 'refund' | 'seat' | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [cancelAsk, setCancelAsk] = useState<null | { title: string; detail: string; confirm: string; run: () => void }>(null)
  const [modifierDialog, setModifierDialog] = useState<{ isOpen: boolean; item: MenuItemDto | null }>({ 
    isOpen: false, 
    item: null 
  })
  const canWrite = !!user && hasPermission(user.role, 'orders.write')
  const canBill = !!user && hasPermission(user.role, 'orders.bill')

  const order = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => settle(await cached(`order:${orderId}`, () => api.order(orderId)))
  })
  const menu = useQuery({
    queryKey: ['menu', branchId],
    enabled: !!branchId,
    staleTime: 60_000,
    queryFn: () => cached(`menu:${branchId}`, () => api.menu(branchId!))
  })
  const settings = useQuery({
    queryKey: ['settings', branchId],
    enabled: !!branchId,
    queryFn: () => cached(`settings:${branchId}`, () => api.settings(branchId!))
  })
  const floor = useQuery({
    queryKey: ['floor', branchId],
    enabled: !!branchId && (dialog === 'transfer' || dialog === 'seat'),
    queryFn: () => api.floor(branchId!)
  })
  const orders = useQuery({
    queryKey: ['orders', branchId],
    enabled: !!branchId && dialog === 'merge',
    queryFn: () => api.orders(branchId!)
  })
  const printers = useQuery({
    queryKey: ['printers', branchId],
    enabled: !!branchId,
    queryFn: () => api.printers(branchId!)
  })
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => cached('profile', api.profile) })

  const refresh = (next: OrderDto) => {
    queryClient.setQueryData(['order', next.id], next)
    void queryClient.invalidateQueries({ queryKey: ['floor', branchId] })
    void queryClient.invalidateQueries({ queryKey: ['orders', branchId] })
    void queryClient.invalidateQueries({ queryKey: ['report', branchId] })
  }

  const tell = (error: unknown) => {
    useToasts.getState().push(error instanceof Error ? error.message : 'Could not save')
  }

  const addQueue = useRef(Promise.resolve())
  const sendKey = useRef<string | null>(null)
  const sendLock = useRef(false)
  const add = useMutation({
    mutationFn: ({ menuItemId, modifiers }: { menuItemId: string; modifiers?: Array<{ modifierGroupId: string; modifierOptionId: string }> }) => {
      const run = addQueue.current.then(() => api.addItems(orderId, { 
        items: [{ 
          menuItemId, 
          quantity: 1,
          modifiers: modifiers || []
        }] 
      }))
      addQueue.current = run.then(
        () => undefined,
        () => undefined
      )
      return run
    },
    onSuccess: refresh,
    onError: tell
  })

  const handleItemClick = (dish: MenuItemDto) => {
    if (!canWrite || closed || !dish.isAvailable) return
    
    // Check if item has modifier groups
    if (dish.modifierGroups && dish.modifierGroups.length > 0) {
      // Show modifier selection dialog
      setModifierDialog({ isOpen: true, item: dish })
    } else {
      // Add item directly
      add.mutate({ menuItemId: dish.id })
    }
  }

  const handleModifierConfirm = (modifiers: Array<{ modifierGroupId: string; modifierOptionId: string }>) => {
    if (modifierDialog.item) {
      add.mutate({ 
        menuItemId: modifierDialog.item.id, 
        modifiers 
      })
      setModifierDialog({ isOpen: false, item: null })
    }
  }
  const adjust = useMutation({
    mutationFn: ({ itemId, delta, confirmCancel }: { itemId: string; delta: number; confirmCancel?: boolean }) =>
      api.adjustItem(orderId, itemId, delta, confirmCancel),
    onSuccess: refresh,
    onError: tell
  })
  const send = useMutation({
    mutationFn: () => {
      if (!sendKey.current) sendKey.current = crypto.randomUUID()
      return api.send(orderId, sendKey.current)
    },
    onSuccess: async (result) => {
      sendKey.current = null
      refresh(result.order)
      await routeTickets(result.tickets, printers.data ?? [])
      useToasts.getState().push(kitchenSendMessage(result.sentCount))
    },
    onError: (error) => {
      const lost = isNetworkError(error) || (error instanceof ApiError && error.status >= 500)
      if (!lost) sendKey.current = null
      if (lost) {
        useToasts.getState().push('Unable to send new items to kitchen.')
        return
      }
      tell(error)
    }
  })
  const closeCheck = useMutation({
    mutationFn: () => api.finish(orderId),
    onSuccess: async (next) => {
      refresh(next)
      setDialog(null)
      await handReceipt(next, 'Closed')
    },
    onError: tell
  })
  const discount = useMutation({
    mutationFn: (body: { kind: 'NONE' | 'PERCENT' | 'AMOUNT'; value: number; label?: string }) => api.discount(orderId, body),
    onSuccess: (next) => {
      refresh(next)
      setDialog(null)
    },
    onError: tell
  })
  const pay = useMutation({
    mutationFn: (body: {
      method: PaymentMethod
      amountCents?: number
      tenderedCents?: number
      note?: string
      arAccountId?: string
      overridePin?: string
      override?: boolean
    }) => api.pay(orderId, { ...body, id: crypto.randomUUID() }),
    onSuccess: async (next, body) => {
      clearSplitDrafts(orderId)
      refresh(next)
      if (body.method === 'CASH') void openCashDrawer(printers.data ?? [])
      if (next.status === 'COMPLETED') {
        setDialog(null)
        await handReceipt(next, 'Paid')
      } else {
        useToasts.getState().push('Payment saved')
      }
    },
    onError: (error, body) => {
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] })
      if (isNetworkError(error)) {
        useToasts.getState().push(
          body.method === 'ACCOUNT'
            ? 'Connection lost. The transaction was not confirmed. Please verify the transaction before trying again.'
            : 'Transaction could not be completed. Please try again.'
        )
        return
      }
      tell(error)
    }
  })
  const splitPay = useMutation({
    mutationFn: (payments: PaymentInput[]) => api.paySplit(orderId, payments),
    onSuccess: async (next, payments) => {
      clearSplitDrafts(orderId)
      refresh(next)
      if (payments.some((payment) => payment.method === 'CASH')) void openCashDrawer(printers.data ?? [])
      setDialog(null)
      await handReceipt(next, 'Paid')
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] })
      useToasts.getState().push(splitFailure(error))
    }
  })
  const refund = useMutation({
    mutationFn: (body: { method: PaymentMethod; amountCents: number; reason: string }) =>
      api.refund(orderId, { ...body, id: crypto.randomUUID() }),
    onSuccess: async (next) => {
      refresh(next)
      await handReceipt(next, 'Refunded')
    },
    onError: tell
  })
  const transfer = useMutation({
    mutationFn: (tableId: string) => api.transfer(orderId, tableId),
    onSuccess: (next) => {
      refresh(next)
      setDialog(null)
    }
  })
  const merge = useMutation({
    mutationFn: (sourceOrderId: string) => api.merge(orderId, sourceOrderId),
    onSuccess: (next) => {
      refresh(next)
      setDialog(null)
    }
  })
  const split = useMutation({
    mutationFn: () => api.split(orderId, { itemIds: picked, newOrderId: crypto.randomUUID() }),
    onSuccess: (result) => {
      refresh(result.order)
      setDialog(null)
      navigate(`/orders/${result.split.id}`)
    }
  })
  const voidLines = useMutation({
    mutationFn: async ({ ids, confirmCancel }: { ids: string[]; confirmCancel?: boolean }) => {
      let latest: OrderDto | null = null
      for (const id of ids) latest = await api.voidItem(orderId, id, confirmCancel)
      if (!latest) throw new Error('Nothing to void')
      return latest
    },
    onSuccess: refresh,
    onError: tell
  })
  const service = useMutation({
    mutationFn: (body: { type: 'DINE_IN' | 'TAKEOUT'; tableId?: string; guestName?: string }) => api.patchOrder(orderId, body),
    onSuccess: (next) => {
      refresh(next)
      setDialog(null)
    },
    onError: tell
  })

  const lines = useMemo(() => groupLines(order.data?.items ?? []), [order.data?.items])
  const categories = useMemo(() => visibleCategories(menu.data ?? []), [menu.data])
  const activeCategory = categories.find((category) => category.id === categoryId) ?? null
  const categoryNameByItem = useMemo(() => {
    const names = new Map<string, string>()
    for (const category of categories) {
      for (const item of category.items) names.set(item.id, category.name)
    }
    return names
  }, [categories])
  const dishes = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const pool = activeCategory ? activeCategory.items : categories.flatMap((category) => category.items)
    return needle ? categories.flatMap((category) => category.items).filter((item) => item.name.toLowerCase().includes(needle)) : pool
  }, [activeCategory, categories, search])

  const current = order.data
  if (!current) {
    return <div className="p-8 text-sm text-muted-foreground">{order.isLoading ? 'Opening the check' : 'Check not found'}</div>
  }

  const currency = current.currency || settings.data?.currency || 'USD'
  const closed = current.status === 'COMPLETED' || current.status === 'CANCELLED'
  const unsentCount = lines.reduce((sum, line) => sum + line.unsent, 0)
  const canSend = canWrite && !closed && current.status !== 'BILLING' && unsentCount > 0
  const tables = floor.data?.[0]?.tables.filter((table) => table.status === 'AVAILABLE') ?? []
  const siblings = (orders.data ?? []).filter((item) => item.id !== current.id && item.status !== 'COMPLETED' && item.status !== 'CANCELLED')

  const branchName = queryClient.getQueryData<Array<{ id: string; name: string }>>(['branches'])?.find((branch) => branch.id === branchId)?.name ?? ''
  const receipt = settings.data ? guestReceipt(current, settings.data, profile.data?.name ?? 'Towns', branchName) : []

  async function handReceipt(next: OrderDto, headline: string) {
    if (!settings.data) {
      useToasts.getState().push(headline)
      setDialog('receipt')
      return
    }
    const lines = guestReceipt(next, settings.data, profile.data?.name ?? 'Towns', branchName)
    const result = await printGuestReceipt(lines, printers.data ?? [])
    const printed = headline === 'Receipt' ? 'Receipt printed' : `${headline}. Receipt printed`
    if (result === 'printed') useToasts.getState().push(printed)
    else if (result === 'failed') {
      useToasts.getState().push(`${headline}. The receipt printer did not answer`)
      setDialog('receipt')
    } else {
      useToasts.getState().push(headline)
      setDialog('receipt')
    }
  }

  function askCancel(title: string, detail: string, confirm: string, run: () => void) {
    setCancelAsk({ title, detail, confirm, run })
  }

  function changeQuantity(line: TicketLine, delta: number) {
    const itemId = line.ids[line.ids.length - 1]
    if (!itemId) return
    const next = line.quantity + delta
    if (next < line.firedQuantity) {
      const dropping = line.firedQuantity - Math.max(next, 0)
      askCancel(
        next <= 0 ? 'Remove sent item?' : 'Cancel sent quantity?',
        next <= 0
          ? `${line.name} was already sent to the kitchen.`
          : `Cancel ${dropping} ${line.name} already sent to the kitchen? The kitchen will not cook a negative.`,
        next <= 0 ? 'Remove from check' : 'Cancel sent quantity',
        () => adjust.mutate({ itemId, delta, confirmCancel: true })
      )
      return
    }
    adjust.mutate({ itemId, delta })
  }

  function removeLine(line: TicketLine) {
    if (line.firedQuantity > 0) {
      askCancel(
        'Remove sent item?',
        `${line.name} was already sent to the kitchen.`,
        'Remove from check',
        () => voidLines.mutate({ ids: line.ids, confirmCancel: true })
      )
      return
    }
    voidLines.mutate({ ids: line.ids })
  }

  function fireKitchen() {
    if (sendLock.current || send.isPending) return
    sendLock.current = true
    send.mutate(undefined, {
      onSettled: () => {
        sendLock.current = false
      }
    })
  }

  const showBreakdown = current.discountCents > 0 || current.serviceChargeCents > 0 || current.paidCents > 0 || current.refundedCents > 0
  const dueLabel = current.paidCents > 0 && !closed ? 'Balance' : 'Total'
  const dueCents = current.paidCents > 0 && !closed ? current.balanceCents : current.totalCents

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden md:grid md:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-3 px-5 py-3">
          <button type="button" onClick={() => navigate(homePath(user?.role))} className="rounded-xl p-2 hover:bg-muted" aria-label={user?.role === 'CASHIER' ? 'Back to orders' : 'Back to tables'}>
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="truncate font-serif text-3xl leading-none">{checkHeading(current)}</div>
            <div className="mt-1 truncate text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {labelFor(current.type)} · {current.status === 'CANCELLED' ? 'Cancelled' : orderServiceLabel(current)}
            </div>
          </div>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the menu" className="ml-auto min-w-36 max-w-xs" />
        </div>
        <div className="flex shrink-0 gap-2 overflow-x-auto px-5 pb-3">
          <button
            type="button"
            onClick={() => {
              setCategoryId('all')
              setSearch('')
            }}
            className={cn(
              'h-11 shrink-0 rounded-full px-4 text-sm',
              !search && !activeCategory ? 'bg-primary text-primary-foreground' : 'bg-muted'
            )}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => {
                setCategoryId(category.id)
                setSearch('')
              }}
              className={cn(
                'h-11 shrink-0 rounded-full px-4 text-sm',
                !search && activeCategory?.id === category.id ? 'bg-primary text-primary-foreground' : 'bg-muted'
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-2 overflow-y-auto px-4 pb-4 sm:grid-cols-3 xl:grid-cols-4">
          {dishes.length === 0 ? (
            <p className="col-span-full px-2 py-16 text-center text-sm text-muted-foreground">
              {search.trim() ? 'No dishes match that search' : 'No dishes in this category'}
            </p>
          ) : null}
          {dishes.map((dish) => {
            const category = categoryNameByItem.get(dish.id) ?? ''
            const hasModifiers = !!dish.modifierGroups && dish.modifierGroups.length > 0

            return (
              <button
                key={dish.id}
                type="button"
                disabled={!canWrite || closed || !dish.isAvailable}
                onClick={() => handleItemClick(dish)}
                className="flex min-h-[112px] flex-col justify-between rounded-2xl border bg-card p-3.5 text-left active:scale-[0.99] disabled:opacity-40"
              >
                <div>
                  <div className="line-clamp-2 font-serif text-lg leading-tight">{dish.name}</div>
                  {dish.description ? <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{dish.description}</p> : null}
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <span className="num text-sm">{formatMoney(dish.priceCents, currency)}</span>
                  <span className="truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {!dish.isAvailable ? 'Unavailable' : hasModifiers ? 'Options' : category}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </section>
      <aside className="flex h-[46%] min-h-[240px] shrink-0 flex-col overflow-hidden border-t bg-card md:h-full md:min-h-0 md:border-l md:border-t-0">
        <div className="flex shrink-0 items-center gap-2 px-4 py-3">
          <div className="min-w-0 flex-1 truncate text-sm">{checkHeading(current)}</div>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-muted"
            onClick={() => setDialog('actions')}
            aria-label="More check actions"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {lines.length === 0 ? (
            <p className="px-1 py-8 text-sm text-muted-foreground">Nothing on this check yet.</p>
          ) : (
            <div className="space-y-4">
              {lines.map((line) => (
                  <div key={line.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-serif text-lg leading-tight">{line.name}</div>
                      {line.modifiers && line.modifiers.length > 0 ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {line.modifiers
                            .map((modifier) =>
                              modifier.priceCents > 0
                                ? `${modifier.name} (+${formatMoney(modifier.priceCents, currency)})`
                                : modifier.name
                            )
                            .join(', ')}
                        </div>
                      ) : null}
                      {line.notes ? <div className="mt-1 text-xs text-muted-foreground">Note: {line.notes}</div> : null}
                      {line.unsent > 0 ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {line.unsent < line.quantity ? `${line.unsent} not sent` : 'Not sent'}
                        </div>
                      ) : null}
                      {canWrite && !closed ? (
                        <div className="mt-2 flex items-center gap-1">
                          <button
                            type="button"
                            className="flex h-10 w-10 items-center justify-center rounded-xl border"
                            onClick={() => changeQuantity(line, -1)}
                            aria-label={`Decrease ${line.name}`}
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="num w-8 text-center text-sm">{line.quantity}</span>
                          <button
                            type="button"
                            className="flex h-10 w-10 items-center justify-center rounded-xl border"
                            onClick={() => changeQuantity(line, 1)}
                            aria-label={`Increase ${line.name}`}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="ml-1 flex h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted-foreground hover:bg-muted"
                            onClick={() => removeLine(line)}
                            aria-label={`Remove ${line.name}`}
                          >
                            <X className="h-4 w-4" />
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="num mt-1 text-sm text-muted-foreground">{line.quantity}</div>
                      )}
                    </div>
                    <div className="num shrink-0 text-sm">{formatMoney(line.unitPriceCents * line.quantity, currency)}</div>
                  </div>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 space-y-3 border-t px-4 py-3">
          {showBreakdown ? (
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="num text-foreground">{formatMoney(current.subtotalCents, currency)}</span>
              </div>
              {current.discountCents > 0 ? (
                <div className="flex justify-between">
                  <span>{discountName(current)}</span>
                  <span className="num">-{formatMoney(current.discountCents, currency)}</span>
                </div>
              ) : null}
              {current.serviceChargeCents > 0 ? (
                <div className="flex justify-between">
                  <span>{settings.data?.serviceChargeLabel ?? 'Service'}</span>
                  <span className="num text-foreground">{formatMoney(current.serviceChargeCents, currency)}</span>
                </div>
              ) : null}
              {current.payments.length > 1
                ? current.payments.map((payment) => (
                    <div key={payment.id} className="flex justify-between">
                      <span>{PAYMENT_METHOD_LABEL[payment.method]}</span>
                      <span className="num text-foreground">{formatMoney(payment.amountCents, currency)}</span>
                    </div>
                  ))
                : null}
              {current.payments.length > 1 && current.payments.some((payment) => payment.changeCents > 0) ? (
                <div className="flex justify-between">
                  <span>Change</span>
                  <span className="num">{formatMoney(current.payments.reduce((sum, payment) => sum + payment.changeCents, 0), currency)}</span>
                </div>
              ) : null}
              {current.paidCents > 0 ? (
                <div className="flex justify-between">
                  <span>Paid</span>
                  <span className="num">-{formatMoney(current.paidCents, currency)}</span>
                </div>
              ) : null}
              {current.refundedCents > 0 ? (
                <div className="flex justify-between">
                  <span>Refunded</span>
                  <span className="num">-{formatMoney(current.refundedCents, currency)}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="font-serif text-lg">{dueLabel}</span>
            <span className="num font-serif text-2xl">{formatMoney(dueCents, currency)}</span>
          </div>
          <div className="flex gap-2">
            {canBill && !closed ? (
              <Button variant="outline" className="flex-1" onClick={() => setDialog('discount')}>
                {current.discountCents > 0 ? 'Discount' : 'Add discount'}
              </Button>
            ) : null}
            {canSend ? (
              <Button className="flex-1" disabled={send.isPending} onClick={fireKitchen}>
                {send.isPending ? 'Sending...' : 'Send to kitchen'}
              </Button>
            ) : null}
          </div>
          {canBill && !closed && current.balanceCents > 0 ? (
            <Button size="lg" className="h-14 w-full text-base" onClick={() => setDialog('pay')}>
              Pay
              <span className="num">{formatMoney(current.balanceCents, currency)}</span>
            </Button>
          ) : null}
          {canBill && !closed && current.balanceCents === 0 && lines.length > 0 ? (
            <Button size="lg" className="h-14 w-full" disabled={closeCheck.isPending} onClick={() => closeCheck.mutate()}>
              Close check
            </Button>
          ) : null}
          {closed && current.status === 'COMPLETED' ? (
            <Button size="lg" className="h-14 w-full" variant="outline" onClick={() => void handReceipt(current, 'Receipt')}>
              Print receipt
            </Button>
          ) : null}
          {canBill && current.status === 'COMPLETED' && current.refundableCents > 0 ? (
            <Button variant="ghost" className="w-full" onClick={() => setDialog('refund')}>
              Refund
            </Button>
          ) : null}
        </div>
      </aside>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent
          className={
            dialog === 'pay'
              ? 'top-4 max-h-[calc(100dvh-2rem)] w-[min(860px,calc(100%-1.5rem))] translate-y-0 overflow-y-auto'
              : 'max-h-[calc(100%-2rem)] w-[min(520px,calc(100%-2rem))] overflow-y-auto'
          }
        >
          {dialog === 'actions' ? (
            <>
              <DialogTitle>Check</DialogTitle>
              <div className="mt-5 grid gap-2">
                {!closed ? <Button variant="outline" onClick={() => setDialog('transfer')}>Transfer table</Button> : null}
                {!closed ? <Button variant="outline" onClick={() => setDialog('merge')}>Merge a check</Button> : null}
                {!closed ? <Button variant="outline" onClick={() => setDialog('split')}>Split items</Button> : null}
                <Button variant="outline" onClick={() => setDialog('receipt')}>Preview receipt</Button>
                {canBill && !closed && lines.length === 0 ? (
                  <Button variant="accent" disabled={closeCheck.isPending} onClick={() => closeCheck.mutate()}>
                    Release table
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
          {dialog === 'pay' ? (
            <PayDialog
              order={current}
              pending={pay.isPending || splitPay.isPending}
              onPay={(body) => pay.mutate(body)}
              onSplitPay={(payments) => splitPay.mutate(payments)}
            />
          ) : null}
          {dialog === 'discount' ? (
            <DiscountDialog order={current} pending={discount.isPending} onApply={(body) => discount.mutate(body)} />
          ) : null}
          {dialog === 'refund' ? <RefundDialog order={current} pending={refund.isPending} onRefund={(body) => refund.mutate(body)} /> : null}
          {dialog === 'seat' ? (
            <>
              <DialogTitle>Where are they sitting?</DialogTitle>
              <p className="mt-2 text-sm text-muted-foreground">Pick an open table. The check stays with them.</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {tables.map((table) => (
                  <Button
                    key={table.id}
                    variant="outline"
                    className="h-16 flex-col"
                    disabled={service.isPending}
                    onClick={() => service.mutate({ type: 'DINE_IN', tableId: table.id })}
                  >
                    <span className="font-serif text-xl">{table.label}</span>
                  </Button>
                ))}
              </div>
              {floor.isSuccess && tables.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No open tables. Leave this as take out, or clear a table on the floor.</p>
              ) : null}
            </>
          ) : null}
          {dialog === 'transfer' ? (
            <>
              <DialogTitle>Transfer</DialogTitle>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {tables.map((table) => (
                  <Button key={table.id} variant="outline" onClick={() => transfer.mutate(table.id)}>
                    {table.label}
                  </Button>
                ))}
              </div>
            </>
          ) : null}
          {dialog === 'merge' ? (
            <>
              <DialogTitle>Merge into this check</DialogTitle>
              <div className="mt-4 space-y-2">
                {siblings.map((item) => (
                  <Button key={item.id} variant="outline" className="w-full justify-between" onClick={() => merge.mutate(item.id)}>
                    <span>{item.tableLabel ?? item.guestName ?? 'Check'}</span>
                    <span className="num">{formatMoney(item.totalCents, currency)}</span>
                  </Button>
                ))}
              </div>
            </>
          ) : null}
          {dialog === 'split' ? (
            <>
              <DialogTitle>Split</DialogTitle>
              <div className="mt-4 space-y-2">
                {current.items.filter((item) => !item.voided).map((item) => (
                  <label key={item.id} className="flex items-center gap-3 rounded-xl border px-3 py-3">
                    <input
                      type="checkbox"
                      checked={picked.includes(item.id)}
                      onChange={() =>
                        setPicked((currentPick) =>
                          currentPick.includes(item.id) ? currentPick.filter((id) => id !== item.id) : [...currentPick, item.id]
                        )
                      }
                    />
                    {item.name}
                  </label>
                ))}
                <Button disabled={!picked.length || split.isPending} onClick={() => split.mutate()}>
                  Move to a new check
                </Button>
              </div>
            </>
          ) : null}
          {dialog === 'receipt' ? (
            <>
              <DialogTitle>Receipt</DialogTitle>
              <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-muted p-4 text-xs leading-5">{receipt.join('\n')}</pre>
              <Button className="mt-4 w-full" onClick={() => void handReceipt(current, 'Receipt')}>
                Print
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      
      <Dialog open={cancelAsk !== null} onOpenChange={(open) => !open && setCancelAsk(null)}>
        <DialogContent className="max-h-[calc(100%-2rem)] w-[min(420px,calc(100%-2rem))]">
          <DialogTitle>{cancelAsk?.title}</DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">{cancelAsk?.detail}</p>
          <div className="mt-5 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setCancelAsk(null)}>
              Keep it
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                const run = cancelAsk?.run
                setCancelAsk(null)
                run?.()
              }}
            >
              {cancelAsk?.confirm ?? 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ModifierSelectionDialog
        isOpen={modifierDialog.isOpen}
        onClose={() => setModifierDialog({ isOpen: false, item: null })}
        onConfirm={handleModifierConfirm}
        modifierGroups={modifierDialog.item?.modifierGroups || []}
        currency={currency}
        itemName={modifierDialog.item?.name || ''}
      />
    </div>
  )
}

interface TicketLine {
  id: string
  ids: string[]
  name: string
  notes: string
  modifiers?: Array<{ name: string; priceCents: number }>
  quantity: number
  firedQuantity: number
  unsent: number
  unitPriceCents: number
}

/** Same dish, price, and note are one row. Quantity is the sum, shown as x1, x2, and so on. */
/** Cashier chips follow the saved order and omit hidden categories and dishes. */
function visibleCategories(categories: MenuCategoryDto[]): MenuCategoryDto[] {
  return categories
    .filter((category) => category.isActive !== false)
    .map((category) => ({
      ...category,
      items: category.items
        .filter((item) => item.isAvailable)
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
}

function groupLines(items: OrderDto['items']): TicketLine[] {
  const grouped = new Map<string, TicketLine>()
  for (const item of items) {
    if (item.voided) continue
    const fired = firedOf(item)
    const modifierKey = item.modifiers
      ? item.modifiers.map((mod) => `${mod.modifierName}:${mod.priceCents}`).sort().join(',')
      : ''
    const key = `${item.menuItemId ?? item.name}|${item.unitPriceCents}|${item.notes}|${modifierKey}`
    const modifiers = item.modifiers?.map((mod) => ({
      name: mod.modifierName,
      priceCents: mod.priceCents
    }))
    const existing = grouped.get(key)
    if (existing) {
      existing.quantity += item.quantity
      existing.firedQuantity += fired
      existing.unsent = Math.max(0, existing.quantity - existing.firedQuantity)
      existing.ids.push(item.id)
      continue
    }
    grouped.set(key, {
      id: item.id,
      ids: [item.id],
      name: item.name,
      notes: item.notes,
      modifiers,
      quantity: item.quantity,
      firedQuantity: fired,
      unsent: Math.max(0, item.quantity - fired),
      unitPriceCents: item.unitPriceCents
    })
  }
  return [...grouped.values()]
}

function firedOf(item: OrderDto['items'][number]): number {
  if (typeof item.firedQuantity === 'number' && item.firedQuantity > 0) return item.firedQuantity
  if (item.sentAt) return item.quantity
  return 0
}

/** Fills payment fields when a cached check was saved before cashier support. */
function settle(order: OrderDto): OrderDto {
  const payments = order.payments ?? []
  const refunds = order.refunds ?? []
  const paidCents = order.paidCents ?? payments.reduce((sum, payment) => sum + payment.amountCents, 0)
  const refundedCents = order.refundedCents ?? refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
  return {
    ...order,
    items: (order.items ?? []).map((item) => ({
      ...item,
      firedQuantity: firedOf(item)
    })),
    discountKind: order.discountKind ?? 'NONE',
    discountValue: order.discountValue ?? 0,
    discountCents: order.discountCents ?? 0,
    discountLabel: order.discountLabel ?? '',
    payments,
    refunds,
    paidCents,
    refundedCents,
    balanceCents: order.balanceCents ?? Math.max(0, order.totalCents - paidCents),
    refundableCents: order.refundableCents ?? Math.max(0, Math.min(order.totalCents, paidCents) - refundedCents)
  }
}

function splitFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.message === 'Invalid request' ||
      error.message === 'Something went wrong' ||
      error.message === 'Request failed' ||
      error.status >= 500 ||
      error.status === 0
    ) {
      return 'Transaction could not be completed. Please try again.'
    }
    return error.message
  }
  if (isNetworkError(error)) return 'Transaction could not be completed. Please try again.'
  return 'Transaction could not be completed. Please try again.'
}

function checkHeading(order: OrderDto): string {
  if (order.type === 'DINE_IN' && order.tableLabel) return `Table ${order.tableLabel}`
  if (order.guestName) return order.guestName
  return ORDER_TYPE_LABEL[order.type]
}

function labelFor(type: OrderDto['type']): string {
  return ORDER_TYPE_LABEL[type]
}

async function routeTickets(tickets: Array<{ station: MenuStation; lines: string[] }>, printers: PrinterDto[]) {
  if (!window.towns) return
  for (const ticket of tickets) {
    const kind = STATION_PRINTER[ticket.station]
    const printer = printers.find((item) => item.isActive && item.kind === kind && item.address) ?? printers.find((item) => item.isActive && item.kind === 'KITCHEN' && item.address)
    if (!printer?.address) continue
    const result = await window.towns.hardware.print(printer.address, ticket.lines)
    if (!result.ok) useToasts.getState().push(`${printer.name}: ${result.message}`)
  }
}
