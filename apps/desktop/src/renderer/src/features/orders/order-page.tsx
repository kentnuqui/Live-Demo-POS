import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  formatMoney,
  hasPermission,
  ORDER_TYPE_LABEL,
  type MenuCategoryDto,
  type MenuStation,
  type OrderDto,
  type PaymentMethod,
  type PrinterDto,
  type PrinterKind,
  type MenuItemDto
} from '@towns/shared'
import { ArrowLeft } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { homePath } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { cached } from '@/features/sync/cache'
import { useSession } from '@/stores/session-store'
import { useToasts } from '@/stores/toast-store'
import { DiscountDialog, PayDialog, RefundDialog } from './cashier-dialogs'
import { discountName, guestReceipt, openCashDrawer, printGuestReceipt } from './print-receipt'
import { ModifierSelectionDialog } from './modifier-selection'

const WASH: Record<string, string> = {
  Sushi: 'from-stone-200/80',
  Ramen: 'from-amber-100/70',
  Donburi: 'from-orange-50',
  Tempura: 'from-yellow-50',
  Drinks: 'from-slate-200/70',
  Desserts: 'from-rose-50'
}

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
    mutationFn: (itemId: string) => api.adjustItem(orderId, itemId, -1),
    onSuccess: refresh
  })
  const send = useMutation({
    mutationFn: () => api.send(orderId),
    onSuccess: async (result) => {
      refresh(result.order)
      await routeTickets(result.tickets, printers.data ?? [])
      useToasts.getState().push(result.tickets.length ? 'Sent' : 'Nothing new')
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
    mutationFn: (body: { method: PaymentMethod; amountCents?: number; tenderedCents?: number; note?: string }) =>
      api.pay(orderId, { ...body, id: crypto.randomUUID() }),
    onSuccess: async (next, body) => {
      refresh(next)
      if (body.method === 'CASH') void openCashDrawer(printers.data ?? [])
      if (next.status === 'COMPLETED') {
        setDialog(null)
        await handReceipt(next, 'Paid')
      } else {
        useToasts.getState().push('Payment saved')
      }
    },
    onError: tell
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
    mutationFn: async (ids: string[]) => {
      let latest: OrderDto | null = null
      for (const id of ids) latest = await api.voidItem(orderId, id)
      if (!latest) throw new Error('Nothing to void')
      return latest
    },
    onSuccess: refresh
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
  const alreadySent = current.status !== 'OPEN'
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

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_380px] grid-rows-[minmax(0,1fr)] overflow-hidden">
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-3 px-5 py-3">
          <button type="button" onClick={() => navigate(homePath(user?.role))} className="rounded-xl p-2 hover:bg-muted" aria-label={user?.role === 'CASHIER' ? 'Back to orders' : 'Back to tables'}>
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="truncate font-serif text-3xl leading-none">{checkHeading(current)}</div>
            <div className="mt-1 truncate text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {labelFor(current.type)} · {current.progress.toLowerCase()}
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
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 content-start gap-2 overflow-y-auto px-4 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          {dishes.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-16">
              <div className="text-4xl mb-4">🍽️</div>
              <p className="text-sm text-muted-foreground text-center">
                {search.trim() ? 'No dishes match that search' : 'No dishes in this category'}
              </p>
            </div>
          ) : null}
          {dishes.map((dish) => {
            const category = categoryNameByItem.get(dish.id) ?? ''
            const hasModifiers = dish.modifierGroups && dish.modifierGroups.length > 0
            
            return (
              <button
                key={dish.id}
                type="button"
                disabled={!canWrite || closed || !dish.isAvailable}
                onClick={() => handleItemClick(dish)}
                className={cn(
                  'group relative overflow-hidden rounded-xl border transition-all duration-200 hover:shadow-md active:scale-[0.97] disabled:opacity-40',
                  'bg-gradient-to-br to-white/50',
                  WASH[category] ?? 'from-stone-50'
                )}
              >
                {/* Content */}
                <div className="relative p-4">
                  {/* Dish Name */}
                  <div className="mb-2">
                    <h3 className="font-serif text-lg leading-tight text-left line-clamp-2">
                      {dish.name}
                    </h3>
                    {dish.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-1 text-left">
                        {dish.description}
                      </p>
                    )}
                  </div>
                  
                  {/* Bottom Row */}
                  <div className="flex items-center justify-between">
                    {/* Price */}
                    <div className="num text-lg font-serif">
                      {formatMoney(dish.priceCents, currency)}
                    </div>
                    
                    {/* Indicators */}
                    <div className="flex items-center gap-1">
                      {hasModifiers && (
                        <div className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700">
                          <span className="mr-1">🎛️</span>
                          Customize
                        </div>
                      )}
                      {!dish.isAvailable && (
                        <div className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700">
                          Out
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Hover Effect */}
                <div className="absolute inset-0 bg-primary/5 opacity-0 transition-opacity group-hover:opacity-100" />
                
                {/* Category Badge */}
                <div className="absolute top-2 right-2 rounded-full bg-white/80 px-2 py-1 text-xs opacity-0 transition-opacity group-hover:opacity-100">
                  {category}
                </div>
              </button>
            )
          })}
        </div>
      </section>
      <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-card">
        {/* Order Info Header with More Button */}
        <div className="shrink-0 p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1" />
            <div className="inline-flex items-center gap-2 rounded-full bg-muted/50 px-3 py-1.5 text-sm">
              <span className="text-lg">
                {current.type === 'DINE_IN' ? '🍽️' : '🥡'}
              </span>
              <span>
                {current.type === 'DINE_IN'
                  ? current.tableLabel
                    ? `Table ${current.tableLabel}`
                    : 'Dine In'
                  : current.type === 'TAKEOUT'
                    ? current.guestName || 'Take Out'
                    : labelFor(current.type)}
              </span>
            </div>
            <div className="flex-1 flex justify-end">
              <button
                className="rounded-lg bg-muted/50 p-2 hover:bg-muted transition-colors"
                onClick={() => setDialog('actions')}
                title="More options"
              >
                <span className="text-lg">⚙️</span>
              </button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {lines.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              No items added yet
            </div>
          ) : (
            <div className="space-y-3">
              {lines.map((line) => (
                <div key={line.id} className="group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-serif text-lg leading-tight">
                        {line.quantity > 1 ? `${line.quantity}× ` : ''}
                        {line.name}
                      </div>
                      {line.modifiers && line.modifiers.length > 0 && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {line.modifiers
                            .map((modifier) =>
                              modifier.priceCents > 0
                                ? `${modifier.name} (+${formatMoney(modifier.priceCents, currency)})`
                                : modifier.name
                            )
                            .join(', ')}
                        </div>
                      )}
                      {line.notes && (
                        <div className="mt-1 text-xs text-muted-foreground">Note: {line.notes}</div>
                      )}
                      {!line.sentAt && <div className="mt-1 text-xs text-amber-600">Pending</div>}
                      {canWrite && !closed && (
                        <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                            onClick={() => adjust.mutate(line.ids[line.ids.length - 1] ?? line.id)}
                            title="Remove one"
                          >
                            −
                          </button>
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                            onClick={() => voidLines.mutate(line.ids)}
                            title="Remove all"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="num shrink-0 font-serif text-lg">
                      {formatMoney(line.unitPriceCents * line.quantity, currency)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Cart Summary */}
        <div className="shrink-0 border-t bg-muted/20">
          <div className="p-4 space-y-3">
            {/* Breakdown - only show if there are adjustments */}
            {(current.discountCents > 0 || current.serviceChargeCents > 0 || current.paidCents > 0 || current.refundedCents > 0) && (
              <div className="space-y-2 text-sm">
                {current.discountCents > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>{discountName(current)}</span>
                    <span className="num">-{formatMoney(current.discountCents, currency)}</span>
                  </div>
                )}
                {current.serviceChargeCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{settings.data?.serviceChargeLabel ?? 'Service'}</span>
                    <span className="num">{formatMoney(current.serviceChargeCents, currency)}</span>
                  </div>
                )}
                {current.paidCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Paid</span>
                    <span className="num">-{formatMoney(current.paidCents, currency)}</span>
                  </div>
                )}
                {current.refundedCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Refunded</span>
                    <span className="num">-{formatMoney(current.refundedCents, currency)}</span>
                  </div>
                )}
                <div className="border-t pt-2 mt-2"></div>
              </div>
            )}
            
            {/* Total */}
            <div className="flex items-center justify-between">
              <span className="font-serif text-lg">
                {current.paidCents > 0 && !closed ? 'Balance' : 'Total'}
              </span>
              <span className="num font-serif text-xl">
                {formatMoney(current.paidCents > 0 && !closed ? current.balanceCents : current.totalCents, currency)}
              </span>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              {canBill && !closed && (
                <button 
                  type="button" 
                  className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm hover:bg-muted/80 transition-colors" 
                  onClick={() => setDialog('discount')}
                >
                  {current.discountCents > 0 ? 'Change Discount' : 'Add Discount'}
                </button>
              )}
              {canWrite && !closed && !alreadySent && (
                <Button 
                  size="lg" 
                  className="flex-1" 
                  disabled={send.isPending || lines.length === 0} 
                  onClick={() => send.mutate()}
                >
                  Send to Kitchen
                </Button>
              )}
            </div>
          </div>
        </div>
        
        {/* Smart Action Bar */}
        <div className="shrink-0 border-t bg-background">
          <div className="p-3">
            {/* Primary Action - Context Aware */}
            {canBill && !closed && current.balanceCents > 0 ? (
              <button 
                className="w-full rounded-xl bg-primary hover:bg-primary/90 px-4 py-4 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 active:scale-[0.98]"
                onClick={() => setDialog('pay')}
              >
                <div className="flex items-center justify-center gap-3">
                  <span className="text-2xl">💳</span>
                  <div className="text-left">
                    <div className="text-lg leading-tight">Pay Now</div>
                    <div className="num text-sm opacity-90">{formatMoney(current.balanceCents, currency)}</div>
                  </div>
                </div>
              </button>
            ) : canBill && !closed && current.balanceCents === 0 && lines.length > 0 ? (
              <button 
                className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-4 text-white shadow-lg hover:shadow-xl transition-all duration-200 active:scale-[0.98]"
                disabled={closeCheck.isPending}
                onClick={() => closeCheck.mutate()}
              >
                <div className="flex items-center justify-center gap-3">
                  <span className="text-2xl">✅</span>
                  <div className="text-lg">Close Check</div>
                </div>
              </button>
            ) : closed && current.status === 'COMPLETED' ? (
              <button 
                className="w-full rounded-xl bg-gradient-to-r from-gray-600 to-gray-700 px-4 py-4 text-white shadow-lg hover:shadow-xl transition-all duration-200 active:scale-[0.98]"
                onClick={() => void handReceipt(current, 'Receipt')}
              >
                <div className="flex items-center justify-center gap-3">
                  <span className="text-2xl">🧾</span>
                  <div className="text-lg">Print Receipt</div>
                </div>
              </button>
            ) : null}
            
            {/* Secondary Actions */}
            {canBill && current.status === 'COMPLETED' && current.refundableCents > 0 && (
              <div className="mt-3">
                <button
                  className="w-full rounded-lg bg-muted px-3 py-2.5 text-sm hover:bg-muted/80 transition-colors flex items-center justify-center gap-2"
                  onClick={() => setDialog('refund')}
                >
                  <span className="text-lg">↩️</span>
                  <span>Refund</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[calc(100%-2rem)] w-[min(520px,calc(100%-2rem))] overflow-y-auto">
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
          {dialog === 'pay' ? <PayDialog order={current} pending={pay.isPending} onPay={(body) => pay.mutate(body)} /> : null}
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
  unitPriceCents: number
  sentAt: string | null
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
    
    // Include modifiers in the grouping key to prevent incorrect grouping
    const modifierKey = item.modifiers
      ? item.modifiers.map(mod => `${mod.modifierName}:${mod.priceCents}`).sort().join(',')
      : ''
    const key = `${item.menuItemId ?? item.name}|${item.unitPriceCents}|${item.notes}|${modifierKey}`
    
    const existing = grouped.get(key)
    if (existing) {
      existing.quantity += item.quantity
      existing.ids.push(item.id)
      if (!item.sentAt) existing.sentAt = null
      continue
    }
    
    // Map modifiers for display
    const modifiers = item.modifiers?.map(mod => ({
      name: mod.modifierName,
      priceCents: mod.priceCents
    }))
    
    grouped.set(key, {
      id: item.id,
      ids: [item.id],
      name: item.name,
      notes: item.notes,
      modifiers,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      sentAt: item.sentAt
    })
  }
  return [...grouped.values()]
}

/** Fills payment fields when a cached check was saved before cashier support. */
function settle(order: OrderDto): OrderDto {
  const payments = order.payments ?? []
  const refunds = order.refunds ?? []
  const paidCents = order.paidCents ?? payments.reduce((sum, payment) => sum + payment.amountCents, 0)
  const refundedCents = order.refundedCents ?? refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
  return {
    ...order,
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
