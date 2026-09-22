import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatMoney, type ReservationType } from '@towns/shared'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { cached } from '@/features/sync/cache'
import { useSession } from '@/stores/session-store'

export function ReservationsPage() {
  const branchId = useSession((state) => state.activeBranchId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [type, setType] = useState<ReservationType>('ADVANCE')
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestCount, setGuestCount] = useState(2)
  const [when, setWhen] = useState(() => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16))
  const [deposit, setDeposit] = useState('0')
  const [tableId, setTableId] = useState('')

  const reservations = useQuery({
    queryKey: ['reservations', branchId],
    enabled: !!branchId,
    queryFn: () => cached(`reservations:${branchId}`, () => api.reservations(branchId!))
  })
  const floor = useQuery({
    queryKey: ['floor', branchId],
    enabled: !!branchId,
    queryFn: () => cached(`floor:${branchId}`, () => api.floor(branchId!))
  })
  const settings = useQuery({
    queryKey: ['settings', branchId],
    enabled: !!branchId,
    queryFn: () => cached(`settings:${branchId}`, () => api.settings(branchId!))
  })

  const create = useMutation({
    mutationFn: () =>
      api.createReservation(branchId!, {
        type,
        guestName,
        guestPhone,
        guestCount,
        tableId: tableId || null,
        reservedAt: new Date(when).toISOString(),
        depositAmountCents: Math.round(Number(deposit || 0) * 100),
        depositPaid: Number(deposit) > 0
      }),
    onSuccess: async (reservation) => {
      setGuestName('')
      await queryClient.invalidateQueries({ queryKey: ['reservations', branchId] })
      await queryClient.invalidateQueries({ queryKey: ['floor', branchId] })
      if (type === 'WALK_IN') {
        const order = await api.seatReservation(branchId!, reservation.id, tableId || undefined)
        navigate(`/orders/${order.id}`)
      }
    }
  })

  const seat = useMutation({
    mutationFn: (id: string) => api.seatReservation(branchId!, id),
    onSuccess: (order) => navigate(`/orders/${order.id}`)
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelReservation(branchId!, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reservations', branchId] })
  })

  const currency = settings.data?.currency ?? 'USD'
  const tables = floor.data?.[0]?.tables ?? []

  return (
    <div className="grid h-full grid-cols-[340px_minmax(0,1fr)]">
      <form
        className="space-y-4 border-r p-5"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <h1 className="font-serif text-4xl">Book</h1>
        <div className="grid grid-cols-2 gap-2">
          {(['WALK_IN', 'ADVANCE'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setType(item)}
              className={cn('h-12 rounded-xl border', type === item ? 'bg-primary text-primary-foreground' : 'bg-card')}
            >
              {item === 'WALK_IN' ? 'Walk in' : 'Advance'}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={guestName} onChange={(event) => setGuestName(event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Guests</Label>
            <Input type="number" min={1} max={30} value={guestCount} onChange={(event) => setGuestCount(Number(event.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>Deposit</Label>
            <Input value={deposit} onChange={(event) => setDeposit(event.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>When</Label>
          <Input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Table</Label>
          <select className="h-12 w-full rounded-xl border bg-card px-3" value={tableId} onChange={(event) => setTableId(event.target.value)}>
            <option value="">Unassigned</option>
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={create.isPending}>
          {type === 'WALK_IN' ? 'Seat now' : 'Save'}
        </Button>
      </form>
      <div className="overflow-auto p-5">
        <div className="overflow-hidden rounded-2xl border bg-card">
          {(reservations.data ?? []).map((reservation) => (
            <div key={reservation.id} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
              <div className="w-24 text-sm text-muted-foreground">
                {new Date(reservation.reservedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </div>
              <div>
                <div className="font-serif text-2xl">{reservation.guestName}</div>
                <div className="text-sm text-muted-foreground">
                  {reservation.guestCount} · {reservation.tableLabel ?? 'No table'} · {reservation.type === 'WALK_IN' ? 'Walk in' : 'Advance'} ·{' '}
                  {reservation.status.toLowerCase()}
                  {reservation.depositAmountCents ? ` · ${formatMoney(reservation.depositAmountCents, currency)} deposit` : ''}
                </div>
              </div>
              <div className="ml-auto flex gap-2">
                {reservation.status === 'CONFIRMED' ? (
                  <Button variant="outline" onClick={() => seat.mutate(reservation.id)}>
                    Seat
                  </Button>
                ) : null}
                {reservation.status === 'CONFIRMED' || reservation.status === 'PENDING' ? (
                  <Button variant="ghost" onClick={() => cancel.mutate(reservation.id)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
