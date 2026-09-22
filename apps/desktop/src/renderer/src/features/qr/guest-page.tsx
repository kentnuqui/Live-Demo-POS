import { formatMoney } from '@towns/shared'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

export function GuestPage() {
  const { token = '' } = useParams()
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [done, setDone] = useState(false)
  const context = useQuery({ queryKey: ['qr', token], queryFn: () => api.qr(token) })
  const place = useMutation({
    mutationFn: () =>
      api.qrOrder(token, {
        guestName: name,
        items: Object.entries(cart).map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
      }),
    onSuccess: () => {
      setCart({})
      setDone(true)
    }
  })

  const category = context.data?.menu.find((item) => item.id === categoryId) ?? context.data?.menu[0]
  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0)
  const total = useMemo(() => {
    if (!context.data) return 0
    return context.data.menu
      .flatMap((item) => item.items)
      .reduce((sum, item) => sum + item.priceCents * (cart[item.id] ?? 0), 0)
  }, [cart, context.data])

  if (!context.data) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Finding the table</div>
  }
  if (done) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="font-serif text-5xl">Towns</div>
        <p className="text-lg">The kitchen has the order.</p>
        <p className="text-sm text-muted-foreground">Table {context.data.tableLabel}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="px-5 py-6">
        <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{context.data.restaurantName}</div>
        <h1 className="font-serif text-4xl">Table {context.data.tableLabel}</h1>
      </header>
      <div className="flex gap-2 overflow-auto px-5">
        {context.data.menu.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategoryId(item.id)}
            className={cn('h-10 shrink-0 rounded-full px-4 text-sm', category?.id === item.id ? 'bg-primary text-primary-foreground' : 'bg-muted')}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-2 gap-3 overflow-auto p-5">
        {category?.items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCart((current) => ({ ...current, [item.id]: (current[item.id] ?? 0) + 1 }))}
            className="min-h-28 rounded-2xl border bg-card p-4 text-left"
          >
            <div className="font-serif text-2xl">{item.name}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {formatMoney(item.priceCents, context.data?.currency ?? 'USD')}
              {cart[item.id] ? ` · ${cart[item.id]}` : ''}
            </div>
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-3 border-t p-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (count) place.mutate()
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          className="h-12 flex-1 rounded-xl border bg-card px-3"
        />
        <Button type="submit" size="lg" disabled={!count || place.isPending}>
          Order {count ? formatMoney(total, context.data.currency) : ''}
        </Button>
      </form>
    </div>
  )
}
