import { useQuery } from '@tanstack/react-query'
import { formatMoney, ORDER_TYPE_LABEL, type OrderDto, type OrderType } from '@towns/shared'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { cached } from '@/features/sync/cache'
import { useSession } from '@/stores/session-store'

const FILTERS: Array<{ id: '' | OrderType; label: string }> = [
  { id: '', label: 'All' },
  { id: 'DINE_IN', label: 'Dine in' },
  { id: 'TAKEOUT', label: 'Take out' }
]

export function OrdersPage() {
  const branchId = useSession((state) => state.activeBranchId)
  const navigate = useNavigate()
  const [type, setType] = useState<'' | OrderType>('')
  const orders = useQuery({
    queryKey: ['orders', branchId, type],
    enabled: !!branchId,
    queryFn: () => cached(`orders:${branchId}:${type}`, () => api.orders(branchId!, type || undefined))
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-4">
        {FILTERS.map((filter) => (
          <button
            key={filter.id || 'all'}
            type="button"
            onClick={() => setType(filter.id)}
            className={cn('h-10 rounded-full px-4 text-sm', type === filter.id ? 'bg-primary text-primary-foreground' : 'bg-muted')}
          >
            {filter.label}
          </button>
        ))}
        <Button className="ml-auto" onClick={() => navigate('/orders/new')}>
          New order
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        <div className="overflow-hidden rounded-2xl border bg-card">
          {(orders.data ?? []).map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => navigate(`/orders/${order.id}`)}
              className="flex w-full items-center gap-4 border-b px-4 py-4 text-left last:border-b-0 hover:bg-muted/60"
            >
              <div className="min-w-0">
                <div className="truncate font-serif text-2xl">{checkTitle(order)}</div>
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{ORDER_TYPE_LABEL[order.type]}</div>
              </div>
              <div className="text-sm text-muted-foreground">{order.progress.toLowerCase()}</div>
              <div className="ml-auto num">{formatMoney(order.totalCents, order.currency)}</div>
            </button>
          ))}
          {orders.data?.length === 0 ? <p className="p-8 text-sm text-muted-foreground">No checks yet.</p> : null}
        </div>
      </div>
    </div>
  )
}

function checkTitle(order: OrderDto): string {
  if (order.type === 'DINE_IN') return order.tableLabel ? `Table ${order.tableLabel}` : 'Dine in'
  if (order.guestName) return order.guestName
  return ORDER_TYPE_LABEL[order.type]
}
