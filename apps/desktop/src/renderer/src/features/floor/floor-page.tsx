import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hasPermission, type FloorTableDto, type TableStatus } from '@towns/shared'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, isNetworkError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { cached, queueOperation } from '@/features/sync/cache'
import { useSession } from '@/stores/session-store'

const STATUS_LABEL: Record<TableStatus, string> = {
  AVAILABLE: 'Open',
  OCCUPIED: 'Seated',
  RESERVED: 'Reserved',
  CLEANING: 'Cleaning',
  BILLING: 'Billing'
}

const DOT: Record<TableStatus, string> = {
  AVAILABLE: '#2f6f4e',
  OCCUPIED: '#c4552a',
  RESERVED: '#355c7d',
  CLEANING: '#8a847a',
  BILLING: '#8d4b3c'
}

export function FloorPage() {
  const branchId = useSession((state) => state.activeBranchId)
  const user = useSession((state) => state.user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [positions, setPositions] = useState<Record<string, { posX: number; posY: number }>>({})
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const [reserved, setReserved] = useState<FloorTableDto | null>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const canEdit = !!user && hasPermission(user.role, 'floor.edit')
  const canWrite = !!user && hasPermission(user.role, 'orders.write')

  const floor = useQuery({
    queryKey: ['floor', branchId],
    enabled: !!branchId,
    queryFn: () => cached(`floor:${branchId}`, () => api.floor(branchId!))
  })

  const plan = floor.data?.[0]
  const tables = useMemo(() => {
    const list = plan?.tables ?? []
    const needle = query.trim().toLowerCase()
    return needle ? list.filter((table) => table.label.toLowerCase().includes(needle)) : list
  }, [plan, query])

  const layout = useMutation({
    mutationFn: async (body: { tables: Array<{ id: string; posX: number; posY: number; width: number; height: number }> }) => {
      try {
        if (!navigator.onLine) throw new TypeError('offline')
        await api.saveLayout(branchId!, body)
      } catch (error) {
        if (!isNetworkError(error)) throw error
        await queueOperation('table.layout', branchId!, body)
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['floor', branchId] })
  })

  const openTable = useMutation({
    mutationFn: (table: FloorTableDto) =>
      api.createOrder(branchId!, { type: 'DINE_IN', tableId: table.id, guestCount: Math.min(table.seats, 2) }),
    onSuccess: (order) => navigate(`/orders/${order.id}`)
  })

  const clearTable = useMutation({
    mutationFn: (tableId: string) => api.tableStatus(branchId!, tableId, 'AVAILABLE'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['floor', branchId] })
  })

  const seat = useMutation({
    mutationFn: (table: FloorTableDto) => {
      if (!table.nextReservation) throw new Error('No reservation')
      return api.seatReservation(branchId!, table.nextReservation.id, table.id)
    },
    onSuccess: (order) => navigate(`/orders/${order.id}`)
  })

  function place(table: FloorTableDto) {
    return positionsRef.current[table.id] ?? { posX: table.posX, posY: table.posY }
  }

  function onPointerDown(event: React.PointerEvent, table: FloorTableDto) {
    if (!editing) return
    const bounds = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const point = place(table)
    drag.current = {
      id: table.id,
      dx: event.clientX - bounds.left - (point.posX / 100) * bounds.width,
      dy: event.clientY - bounds.top - (point.posY / 100) * bounds.height,
      moved: false
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current) return
    const bounds = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const id = drag.current.id
    const table = tables.find((item) => item.id === id)
    if (!table) return
    const posX = Math.min(100 - table.width, Math.max(0, ((event.clientX - bounds.left - drag.current.dx) / bounds.width) * 100))
    const posY = Math.min(100 - table.height, Math.max(0, ((event.clientY - bounds.top - drag.current.dy) / bounds.height) * 100))
    drag.current.moved = true
    const next = { ...positionsRef.current, [id]: { posX, posY } }
    positionsRef.current = next
    setPositions(next)
  }

  function onPointerUp() {
    const moved = drag.current?.moved ?? false
    if (!moved || !plan) {
      drag.current = null
      return
    }
    suppressClick.current = true
    drag.current = null
    layout.mutate({
      tables: plan.tables.map((table) => {
        const point = place(table)
        return { id: table.id, posX: point.posX, posY: point.posY, width: table.width, height: table.height }
      })
    })
  }

  function activate(table: FloorTableDto) {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (editing) return
    if (table.status === 'CLEANING') return
    if (table.activeOrder) {
      navigate(`/orders/${table.activeOrder.id}`)
      return
    }
    if (table.status === 'RESERVED') {
      setReserved(table)
      return
    }
    if (!canWrite) return
    openTable.mutate(table)
  }

  const seated = plan?.tables.filter((table) => table.status === 'OCCUPIED' || table.status === 'BILLING').length ?? 0
  const total = plan?.tables.length ?? 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-3">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a table" className="max-w-xs" />
        <p className="text-sm text-muted-foreground">
          {seated} of {total} seated
        </p>
        <div className="ml-auto flex gap-2">
          <Button size="lg" onClick={() => navigate('/orders/new?service=takeout')}>
            Take out
          </Button>
          {canEdit ? (
            <Button variant={editing ? 'default' : 'outline'} onClick={() => setEditing((value) => !value)}>
              {editing ? 'Done' : 'Arrange'}
            </Button>
          ) : null}
        </div>
      </div>
      <div
        className="paper-grid relative mx-5 mb-5 min-h-0 flex-1 overflow-hidden rounded-3xl border bg-card"
      >
        {tables.map((table) => {
          const point = place(table)
          return (
            <button
              key={table.id}
              type="button"
              onPointerDown={(event) => onPointerDown(event, table)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={() => activate(table)}
              style={{ left: `${point.posX}%`, top: `${point.posY}%`, width: `${table.width}%`, height: `${table.height}%` }}
              className={cn(
                'absolute flex flex-col items-start justify-between border bg-background/80 p-3 text-left transition',
                table.shape === 'ROUND' ? 'rounded-full' : 'rounded-2xl',
                editing ? 'cursor-grab touch-none' : 'hover:-translate-y-0.5'
              )}
            >
              <span className="flex w-full items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {table.zone.toLowerCase()}
                <span className="h-2 w-2 rounded-full" style={{ background: DOT[table.status] }} />
              </span>
              <span className="font-serif text-3xl leading-none">{table.label}</span>
              <span className="text-xs text-muted-foreground">
                {STATUS_LABEL[table.status]}
                {table.activeOrder ? ` · ${table.activeOrder.guestCount}` : ` · ${table.seats}`}
                {table.openOrderCount > 1 ? ` · +${table.openOrderCount - 1}` : ''}
              </span>
              {table.status === 'CLEANING' && canEdit ? (
                <span
                  className="text-xs underline"
                  onClick={(event) => {
                    event.stopPropagation()
                    clearTable.mutate(table.id)
                  }}
                >
                  Mark open
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <Dialog open={!!reserved} onOpenChange={(open) => !open && setReserved(null)}>
        <DialogContent>
          <DialogTitle>{reserved?.label}</DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {reserved?.nextReservation
              ? `${reserved.nextReservation.guestName} · ${reserved.nextReservation.guestCount} guests`
              : 'Reserved'}
          </p>
          <Button
            size="lg"
            className="mt-6 w-full"
            disabled={!reserved?.nextReservation || seat.isPending}
            onClick={() => reserved && seat.mutate(reserved)}
          >
            Seat
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
