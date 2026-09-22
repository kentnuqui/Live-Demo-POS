import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSession } from '@/stores/session-store'

type ServiceChoice = 'DINE_IN' | 'TAKEOUT'

function initialService(value: string | null): ServiceChoice | null {
  if (value === 'takeout') return 'TAKEOUT'
  if (value === 'dine-in') return 'DINE_IN'
  return null
}

export function NewOrderPage() {
  const branchId = useSession((state) => state.activeBranchId)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [service, setService] = useState<ServiceChoice | null>(initialService(params.get('service')))
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestCount, setGuestCount] = useState(2)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const floor = useQuery({
    queryKey: ['floor', branchId],
    enabled: !!branchId && service === 'DINE_IN',
    queryFn: () => api.floor(branchId!)
  })
  const openTables = (floor.data?.[0]?.tables ?? []).filter((table) => table.status === 'AVAILABLE')

  async function openCheck(body: { type: ServiceChoice; tableId?: string; guestCount?: number }) {
    if (!branchId) return
    setPending(true)
    setError('')
    try {
      const order = await api.createOrder(branchId, {
        ...body,
        guestName: service === 'TAKEOUT' ? guestName.trim() || 'Walk-in' : undefined,
        guestPhone: guestPhone.trim() || undefined,
        source: 'POS'
      })
      navigate(`/orders/${order.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open the check')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="font-serif text-4xl">New order</h1>
        <p className="mt-2 text-sm text-muted-foreground">Dine in or take out?</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Choice
          title="Dine in"
          detail="Seat them at a table"
          selected={service === 'DINE_IN'}
          onClick={() => setService('DINE_IN')}
        />
        <Choice
          title="Take out"
          detail="Pack it to go"
          selected={service === 'TAKEOUT'}
          onClick={() => setService('TAKEOUT')}
        />
      </div>

      {service === 'DINE_IN' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Guests</span>
            <button type="button" className="h-10 w-10 rounded-full border" onClick={() => setGuestCount((count) => Math.max(1, count - 1))}>
              –
            </button>
            <span className="num w-6 text-center text-lg">{guestCount}</span>
            <button type="button" className="h-10 w-10 rounded-full border" onClick={() => setGuestCount((count) => Math.min(30, count + 1))}>
              +
            </button>
          </div>
          <p className="text-sm text-muted-foreground">Tap an open table</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {openTables.map((table) => (
              <Button
                key={table.id}
                type="button"
                variant="outline"
                size="lg"
                className="h-20 flex-col gap-1"
                disabled={pending}
                onClick={() => void openCheck({ type: 'DINE_IN', tableId: table.id, guestCount })}
              >
                <span className="font-serif text-2xl leading-none">{table.label}</span>
                <span className="text-xs text-muted-foreground">{table.seats} seats</span>
              </Button>
            ))}
          </div>
          {floor.isLoading ? <p className="text-sm text-muted-foreground">Looking up tables</p> : null}
          {floor.isSuccess && openTables.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every table is in use. Clear one on the floor, or switch to take out.</p>
          ) : null}
        </div>
      ) : null}

      {service === 'TAKEOUT' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void openCheck({ type: 'TAKEOUT', guestCount: 1 })
          }}
          className="flex flex-col gap-5"
        >
          <div className="space-y-2">
            <Label>Name on the order</Label>
            <Input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Walk-in" autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} placeholder="Optional" />
          </div>
          <Button type="submit" size="lg" disabled={pending}>
            Open takeout check
          </Button>
        </form>
      ) : null}

      {error ? <p className="text-sm text-accent">{error}</p> : null}
    </div>
  )
}

function Choice({
  title,
  detail,
  selected,
  onClick
}: {
  title: string
  detail: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-32 flex-col items-start justify-between rounded-2xl border p-5 text-left transition',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'
      )}
    >
      <span className="font-serif text-3xl">{title}</span>
      <span className={cn('text-sm', selected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{detail}</span>
    </button>
  )
}
