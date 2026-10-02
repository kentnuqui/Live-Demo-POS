import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelSuccessMessage,
  formatMoney,
  hasPermission,
  ORDER_TYPES,
  ORDER_TYPE_LABEL,
  type OrderDto,
  type OrderListQuery,
  type OrderType
} from '@towns/shared'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useWide } from '@/lib/use-wide'
import { cn } from '@/lib/utils'
import { cached } from '@/features/sync/cache'
import { useSession } from '@/stores/session-store'
import { useToasts } from '@/stores/toast-store'
import { useUi } from '@/stores/ui-store'
import { CancelOrderDialog } from './cancel-order-dialog'
import { boardStatusClass, boardStatusLabel, formatBoardTime, orderTitle } from './order-board'
import { OrderDetailPanel } from './order-detail-panel'

type Scope = OrderListQuery['scope']
type Focus = OrderListQuery['focus']
type DateRange = '' | NonNullable<OrderListQuery['range']>

const ACTIVE_FOCUSES: Array<{ id: Focus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'ready', label: 'Ready' },
  { id: 'billing', label: 'Billing' }
]

const PAST_FOCUSES: Array<{ id: Focus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' }
]

const DATE_LABEL: Record<Exclude<DateRange, '' | 'custom'>, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  month: 'This month'
}

const PAGE_SIZE = 25

/** Branch order board. Active checks first. Past checks stay on their own lane. */
export function OrdersPage() {
  const branchId = useSession((state) => state.activeBranchId)
  const user = useSession((state) => state.user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const wide = useWide()
  const offline = useUi((state) => state.connection) === 'offline'
  const canWrite = !!user && hasPermission(user.role, 'orders.write')
  const [cancelOpen, setCancelOpen] = useState(false)

  const [scope, setScope] = useState<Scope>('active')
  const [focus, setFocus] = useState<Focus>('all')
  const [range, setRange] = useState<DateRange>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [type, setType] = useState<'' | OrderType>('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [scope, focus, range, from, to, type, debounced, branchId])

  useEffect(() => {
    setSelectedId(null)
  }, [branchId])

  useEffect(() => {
    setCancelOpen(false)
  }, [selectedId])

  const customReady = range !== 'custom' || (!!from && !!to)
  const query = useMemo<OrderListQuery>(
    () => ({
      scope,
      focus,
      page,
      pageSize: PAGE_SIZE,
      ...(type ? { type } : {}),
      ...(debounced ? { q: debounced } : {}),
      ...(range && customReady ? { range } : {}),
      ...(range === 'custom' && from && to ? { from, to } : {})
    }),
    [scope, focus, page, type, debounced, range, from, to, customReady]
  )

  const board = useQuery({
    queryKey: ['orders', branchId, 'board', query],
    enabled: !!branchId,
    placeholderData: keepPreviousData,
    queryFn: () => cached(`orders-board:${branchId}:${JSON.stringify(query)}`, () => api.orderBoard(branchId!, query))
  })
  const settings = useQuery({
    queryKey: ['settings', branchId],
    enabled: !!branchId,
    queryFn: () => cached(`settings:${branchId}`, () => api.settings(branchId!))
  })
  const detail = useQuery({
    queryKey: ['order', selectedId],
    enabled: !!selectedId,
    queryFn: () => cached(`order:${selectedId}`, () => api.order(selectedId!))
  })

  const total = board.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  if (!branchId) return <p className="p-8 text-sm text-muted-foreground">Choose a branch first.</p>

  const timeZone = board.data?.timezone
  const orders = board.data?.orders ?? []
  const listed = orders.find((order) => order.id === selectedId) ?? null
  const shown = detail.data ?? listed
  const focuses = scope === 'past' ? PAST_FOCUSES : ACTIVE_FOCUSES
  const chips = activeChips({
    scope,
    focus,
    range,
    from,
    to,
    type,
    search: debounced,
    clearFocus: () => setFocus('all'),
    clearDate: () => {
      setRange('')
      setFrom('')
      setTo('')
    },
    clearType: () => setType(''),
    clearSearch: () => {
      setSearch('')
      setDebounced('')
    }
  })
  const onlyToday = scope === 'past' && range === 'today' && focus === 'all' && !type && !debounced
  const filtering = chips.length > 0 && !onlyToday

  const chooseScope = (next: Scope) => {
    setScope(next)
    setFocus('all')
    setRange(next === 'past' ? 'today' : '')
    setFrom('')
    setTo('')
  }

  const clearFilters = () => {
    setFocus('all')
    setType('')
    setRange('')
    setFrom('')
    setTo('')
    setSearch('')
    setDebounced('')
  }

  const closeCancelled = (message: string) => {
    setCancelOpen(false)
    setSelectedId(null)
    useToasts.getState().push(message)
  }

  const detailPanel = (
    <>
      <OrderDetailPanel
        order={shown}
        loading={!!selectedId && !shown && detail.isLoading}
        failed={!!selectedId && !shown && detail.isError}
        timeZone={timeZone}
        serviceLabel={settings.data?.serviceChargeLabel ?? 'Service'}
        asDialog={!wide}
        onOpen={() => {
          if (selectedId) navigate(`/orders/${selectedId}`)
        }}
        onClose={wide ? () => setSelectedId(null) : undefined}
        onRetry={() => void detail.refetch()}
        onCancel={canWrite ? () => setCancelOpen(true) : undefined}
        offline={offline}
        className="h-full min-h-0"
      />
      <CancelOrderDialog
        order={shown}
        open={cancelOpen && !!shown}
        onOpenChange={setCancelOpen}
        onCancelled={(result) => closeCancelled(cancelSuccessMessage(orderTitle(result.order), result.table))}
        onAlreadyCancelled={(message) => {
          void queryClient.invalidateQueries({ queryKey: ['orders', branchId] })
          closeCancelled(message)
        }}
      />
    </>
  )

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <h1 className="font-serif text-3xl leading-none">Orders</h1>
          {canWrite ? (
            <Button className="h-10" onClick={() => navigate('/orders/new')}>
              New order
            </Button>
          ) : null}
        </header>

        <div className="px-5 pt-4">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search order #, name, or table"
            aria-label="Search orders"
            autoComplete="off"
            className="h-11"
          />

          <div className="mt-3 flex items-center gap-2 overflow-x-auto">
            <ScopeSwitch scope={scope} onChange={chooseScope} />
            <FocusChips focus={focus} options={focuses} onChange={setFocus} />
            <Button variant="ghost" className="h-9 shrink-0 px-3 text-muted-foreground" onClick={() => setFiltersOpen(true)}>
              Date
            </Button>
          </div>

          {chips.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.clear}
                  className="inline-flex h-8 items-center gap-2 rounded-full bg-muted px-3 text-xs"
                >
                  {chip.label}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Remove {chip.label}</span>
                </button>
              ))}
              <button type="button" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={clearFilters}>
                Clear all
              </button>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4" aria-busy={board.isFetching}>
          {board.isError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
              <p className="text-sm">Unable to load orders.</p>
              <Button variant="outline" onClick={() => void board.refetch()} disabled={board.isFetching}>
                Retry
              </Button>
            </div>
          ) : null}

          {board.isLoading ? <OrderSkeleton /> : null}

          {!board.isLoading && !board.isError && orders.length === 0 ? (
            <EmptyState
              title={
                filtering
                  ? 'No orders match your current filters.'
                  : scope === 'past'
                    ? 'No past orders for today.'
                    : 'No active orders'
              }
              body={
                filtering
                  ? 'Try a different status, date, or search.'
                  : scope === 'past'
                    ? 'Completed and cancelled checks from today will appear here.'
                    : 'Orders currently being prepared will appear here.'
              }
              onClear={chips.length > 0 ? clearFilters : undefined}
            />
          ) : null}

          {orders.length > 0 ? (
            <div className={cn('overflow-hidden rounded-2xl border bg-card', board.isPlaceholderData && 'opacity-60')}>
              {orders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  timeZone={timeZone}
                  selected={order.id === selectedId}
                  onSelect={() => setSelectedId((current) => (current === order.id ? null : order.id))}
                />
              ))}
            </div>
          ) : null}

          {total > 0 ? (
            <Pager
              page={page}
              pageCount={pageCount}
              total={total}
              disabled={board.isFetching}
              onPage={setPage}
            />
          ) : null}
        </div>
      </section>

      {wide && selectedId ? (
        <aside className="flex w-[400px] shrink-0 flex-col border-l">{detailPanel}</aside>
      ) : wide ? null : (
        <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
          <DialogContent className="flex h-[min(720px,calc(100dvh-2rem))] w-[min(480px,calc(100%-1.5rem))] flex-col overflow-hidden p-0">
            {detailPanel}
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogTitle className="text-2xl">Date</DialogTitle>
          <div className="mt-5 space-y-4">
            <DateFilter range={range} from={from} to={to} onRange={setRange} onFrom={setFrom} onTo={setTo} stacked />
            <TypeFilter type={type} onChange={setType} stacked />
            <Button className="w-full" variant="outline" onClick={() => setFiltersOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ScopeSwitch({ scope, onChange }: { scope: Scope; onChange: (scope: Scope) => void }) {
  return (
    <div className="flex h-10 shrink-0 rounded-full bg-muted p-1">
      {(['active', 'past'] as const).map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            'rounded-full px-4 text-sm',
            scope === id ? 'bg-card text-foreground' : 'text-muted-foreground'
          )}
        >
          {id === 'active' ? 'Active' : 'Past'}
        </button>
      ))}
    </div>
  )
}

function FocusChips({
  focus,
  options,
  onChange
}: {
  focus: Focus
  options: Array<{ id: Focus; label: string }>
  onChange: (focus: Focus) => void
}) {
  return (
    <div className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={focus === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'h-9 shrink-0 rounded-full px-3 text-sm',
            focus === option.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function DateFilter({
  range,
  from,
  to,
  onRange,
  onFrom,
  onTo,
  stacked
}: {
  range: DateRange
  from: string
  to: string
  onRange: (range: DateRange) => void
  onFrom: (value: string) => void
  onTo: (value: string) => void
  stacked?: boolean
}) {
  return (
    <div className={cn('flex gap-2', stacked && 'flex-col')}>
      <label className={cn('text-sm', stacked && 'block')}>
        {stacked ? <span className="mb-1 block text-muted-foreground">Date</span> : <span className="sr-only">Date</span>}
        <select
          value={range}
          onChange={(event) => onRange(event.target.value as DateRange)}
          className="h-10 rounded-xl border bg-card px-3 text-sm"
          aria-label="Date"
        >
          <option value="">Any date</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="custom">Custom date</option>
        </select>
      </label>
      {range === 'custom' ? (
        <div className="flex gap-2">
          <Input type="date" value={from} onChange={(event) => onFrom(event.target.value)} aria-label="Start date" className="h-10 w-[11rem]" />
          <Input type="date" value={to} onChange={(event) => onTo(event.target.value)} aria-label="End date" className="h-10 w-[11rem]" />
        </div>
      ) : null}
    </div>
  )
}

function TypeFilter({ type, onChange, stacked }: { type: '' | OrderType; onChange: (type: '' | OrderType) => void; stacked?: boolean }) {
  return (
    <label className={cn('text-sm', stacked && 'block')}>
      {stacked ? <span className="mb-1 block text-muted-foreground">Order type</span> : <span className="sr-only">Order type</span>}
      <select
        value={type}
        onChange={(event) => onChange(event.target.value as '' | OrderType)}
        className="h-10 rounded-xl border bg-card px-3 text-sm"
        aria-label="Order type"
      >
        <option value="">All types</option>
        {ORDER_TYPES.map((id) => (
          <option key={id} value={id}>
            {ORDER_TYPE_LABEL[id]}
          </option>
        ))}
      </select>
    </label>
  )
}

function OrderRow({
  order,
  timeZone,
  selected,
  onSelect
}: {
  order: OrderDto
  timeZone?: string
  selected: boolean
  onSelect: () => void
}) {
  const when = order.closedAt && order.status !== 'OPEN' ? order.closedAt : order.createdAt

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-4 border-b px-4 py-4 text-left last:border-b-0 hover:bg-muted/60',
        selected && 'bg-muted/70'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-serif text-2xl leading-none">{heading(order)}</span>
          <span className={cn('rounded-full px-2.5 py-1 text-xs', boardStatusClass(order))}>{boardStatusLabel(order)}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{meta(order)}</p>
      </div>
      <div className="shrink-0 text-right">
        <div className="num text-sm">{formatMoney(order.totalCents, order.currency)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{formatBoardTime(when, timeZone, false)}</div>
      </div>
    </button>
  )
}

function Pager({
  page,
  pageCount,
  total,
  disabled,
  onPage
}: {
  page: number
  pageCount: number
  total: number
  disabled: boolean
  onPage: (page: number) => void
}) {
  const start = Math.min(total, (page - 1) * PAGE_SIZE + 1)
  const end = Math.min(total, page * PAGE_SIZE)
  const numbers = pageWindow(page, pageCount)
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {start}–{end} of {total}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <Button variant="outline" className="h-11 px-3" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          {numbers.map((number) => (
            <button
              key={number}
              type="button"
              disabled={disabled}
              onClick={() => onPage(number)}
              className={cn(
                'h-11 w-11 rounded-xl text-sm',
                number === page ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              )}
            >
              {number}
            </button>
          ))}
          <Button variant="outline" className="h-11 px-3" disabled={disabled || page >= pageCount} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function EmptyState({ title, body, onClear }: { title: string; body: string; onClear?: () => void }) {
  return (
    <div className="rounded-2xl border bg-card px-6 py-12 text-center">
      <p className="font-serif text-2xl">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {onClear ? (
        <Button className="mt-4" variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}

function OrderSkeleton() {
  return (
    <div className="space-y-px overflow-hidden rounded-2xl border bg-card">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
          <div className="flex-1 space-y-2">
            <div className="h-6 w-36 animate-pulse rounded bg-muted" />
            <div className="h-4 w-52 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-5 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

function heading(order: OrderDto): string {
  if (order.ticketNumber) return `Order #${order.ticketNumber}`
  if (order.type === 'DINE_IN' && order.tableLabel) return `Table ${order.tableLabel}`
  if (order.guestName.trim()) return order.guestName.trim()
  return ORDER_TYPE_LABEL[order.type]
}

function meta(order: OrderDto): string {
  const parts = [ORDER_TYPE_LABEL[order.type]]
  if (order.type === 'DINE_IN' && order.tableLabel && order.ticketNumber) parts.push(`Table ${order.tableLabel}`)
  const name = order.guestName.trim()
  if (name && name !== heading(order)) parts.push(name)
  if (order.serverName) parts.push(order.serverName)
  return parts.join(' · ')
}

function pageWindow(page: number, count: number): number[] {
  const start = Math.max(1, Math.min(page - 2, count - 4))
  const end = Math.min(count, start + 4)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

function activeChips(input: {
  scope: Scope
  focus: Focus
  range: DateRange
  from: string
  to: string
  type: '' | OrderType
  search: string
  clearFocus: () => void
  clearDate: () => void
  clearType: () => void
  clearSearch: () => void
}): Array<{ key: string; label: string; clear: () => void }> {
  const chips: Array<{ key: string; label: string; clear: () => void }> = []
  if (input.focus !== 'all') {
    const options = input.scope === 'past' ? PAST_FOCUSES : ACTIVE_FOCUSES
    chips.push({ key: 'focus', label: options.find((item) => item.id === input.focus)?.label ?? input.focus, clear: input.clearFocus })
  }
  if (input.range && input.range !== 'custom' && !(input.scope === 'past' && input.range === 'today')) {
    chips.push({ key: 'date', label: DATE_LABEL[input.range], clear: input.clearDate })
  }
  if (input.range === 'custom' && input.from && input.to) {
    chips.push({ key: 'date', label: `${input.from} – ${input.to}`, clear: input.clearDate })
  }
  if (input.type) chips.push({ key: 'type', label: ORDER_TYPE_LABEL[input.type], clear: input.clearType })
  if (input.search) chips.push({ key: 'search', label: input.search, clear: input.clearSearch })
  return chips
}
