import { useQuery } from '@tanstack/react-query'
import { PAYMENT_METHOD_LABEL, formatMoney, hasPermission } from '@towns/shared'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { canOpenPage, homePath } from '@/lib/nav'
import { useSession } from '@/stores/session-store'

/** One day of sales, discounts, refunds, and what each payment method took in. */
export function ReportsPage() {
  const branchId = useSession((state) => state.activeBranchId)
  const user = useSession((state) => state.user)
  const [day, setDay] = useState<string | undefined>(undefined)
  const report = useQuery({
    queryKey: ['report', branchId, day ?? 'today'],
    enabled: !!branchId,
    queryFn: () => api.dailyReport(branchId!, day)
  })

  if (!user || !hasPermission(user.role, 'orders.bill') || !canOpenPage(user.role, '/reports')) {
    return <Navigate to={homePath(user?.role)} replace />
  }

  const data = report.data
  const selected = data?.day
  const atToday = !data || data.day >= data.today
  const currency = data?.currency ?? 'USD'

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl">{selected ? dayLabel(selected) : 'Today'}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => selected && setDay(shiftDay(selected, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" disabled={atToday} onClick={() => setDay(undefined)}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next day"
            disabled={atToday || !selected}
            onClick={() => selected && setDay(shiftDay(selected, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {report.isError ? <p className="mt-6 text-sm text-muted-foreground">The report could not be loaded.</p> : null}
      {data ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.transactionCount === 0 ? 'No checks closed on this day.' : `${data.transactionCount} checks closed.`}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Net sales" value={formatMoney(data.netCents, currency)} emphasis />
            <Stat label="Sales" value={formatMoney(data.salesCents, currency)} />
            <Stat label="Discounts" value={formatMoney(data.discountCents, currency)} />
            <Stat label="Refunds" value={formatMoney(data.refundCents, currency)} detail={data.refundCount ? `${data.refundCount} refunds` : undefined} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Stat label="Transactions" value={String(data.transactionCount)} />
            <Stat label="Service" value={formatMoney(data.serviceChargeCents, currency)} />
          </div>
          <h2 className="mt-8 font-serif text-2xl">Payment methods</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border">
            {data.tenders.map((tender) => (
              <div key={tender.method} className="grid grid-cols-4 items-center gap-3 border-b px-4 py-4 last:border-b-0">
                <div>{PAYMENT_METHOD_LABEL[tender.method]}</div>
                <div className="text-sm text-muted-foreground">
                  In <span className="num text-foreground">{formatMoney(tender.paymentsCents, currency)}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  Out <span className="num text-foreground">{formatMoney(tender.refundsCents, currency)}</span>
                </div>
                <div className="num text-right font-medium">{formatMoney(tender.netCents, currency)}</div>
              </div>
            ))}
          </div>
        </>
      ) : report.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Adding up the day</p>
      ) : null}
    </div>
  )
}

function Stat({ label, value, detail, emphasis }: { label: string; value: string; detail?: string; emphasis?: boolean }) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-4">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={emphasis ? 'num mt-2 font-serif text-4xl' : 'num mt-2 font-serif text-3xl'}>{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  )
}

function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, date + delta))
  return next.toISOString().slice(0, 10)
}

function dayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, date)))
}
