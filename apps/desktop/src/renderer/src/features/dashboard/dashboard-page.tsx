import { useQuery } from '@tanstack/react-query'
import {
  ORDER_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  formatMoney,
  orderServiceLabel,
  type DailyReportDto,
  type OrderDto,
  type TableStatus
} from '@towns/shared'
import { Link, Navigate } from 'react-router-dom'
import { cached } from '@/features/sync/cache'
import { api } from '@/lib/api'
import { homePath, isAdmin } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useSession } from '@/stores/session-store'

const ROOM: Array<{ status: TableStatus; label: string; color: string }> = [
  { status: 'AVAILABLE', label: 'Open', color: '#2f6f4e' },
  { status: 'OCCUPIED', label: 'Seated', color: '#c4552a' },
  { status: 'RESERVED', label: 'Reserved', color: '#355c7d' },
  { status: 'BILLING', label: 'Billing', color: '#8d4b3c' },
  { status: 'CLEANING', label: 'Cleaning', color: '#8a847a' }
]

const OPEN_CHECK = new Set(['OPEN', 'SENT', 'PREPARING', 'READY', 'SERVED', 'BILLING'])
const COMING = new Set(['PENDING', 'CONFIRMED'])

/** A quiet read of the day for super admins and admins. */
export function DashboardPage() {
  const user = useSession((state) => state.user)
  const branchId = useSession((state) => state.activeBranchId)

  const branches = useQuery({ queryKey: ['branches'], queryFn: api.branches, enabled: !!user })
  const report = useQuery({
    queryKey: ['report', branchId, 'today'],
    enabled: !!branchId,
    queryFn: () => api.dailyReport(branchId!)
  })
  const floor = useQuery({
    queryKey: ['floor', branchId],
    enabled: !!branchId,
    queryFn: () => cached(`floor:${branchId}`, () => api.floor(branchId!))
  })
  const orders = useQuery({
    queryKey: ['orders', branchId, ''],
    enabled: !!branchId,
    queryFn: () => cached(`orders:${branchId}:`, () => api.orders(branchId!))
  })
  const reservations = useQuery({
    queryKey: ['reservations', branchId],
    enabled: !!branchId,
    queryFn: () => cached(`reservations:${branchId}`, () => api.reservations(branchId!))
  })

  if (!user || !isAdmin(user.role)) {
    return <Navigate to={homePath(user?.role)} replace />
  }
  if (!branchId) return <p className="p-8 text-sm text-muted-foreground">Choose a branch first.</p>

  const branchName = branches.data?.find((branch) => branch.id === branchId)?.name ?? 'This house'
  const tables = floor.data?.[0]?.tables ?? []
  const counts = countTables(tables)
  const seated = counts.OCCUPIED + counts.BILLING
  const openChecks = (orders.data ?? []).filter((order) => OPEN_CHECK.has(order.status))
  const coming = (reservations.data ?? [])
    .filter((reservation) => COMING.has(reservation.status))
    .slice()
    .sort((left, right) => left.reservedAt.localeCompare(right.reservedAt))
  const currency = report.data?.currency ?? 'USD'
  const loading = report.isLoading && floor.isLoading && orders.isLoading
  const failed = report.isError && floor.isError && orders.isError

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Overview</p>
          <h1 className="mt-1 font-serif text-4xl leading-none">{branchName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{report.data ? dayLabel(report.data.day) : 'Today'}</p>
        </div>
      </div>

      {loading ? <p className="mt-8 text-sm text-muted-foreground">Reading the house</p> : null}
      {failed ? <p className="mt-8 text-sm text-muted-foreground">The overview could not be loaded.</p> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Net sales"
          value={report.data ? formatMoney(report.data.netCents, currency) : report.isLoading ? '—' : 'Unavailable'}
          detail={report.data ? closedLine(report.data) : undefined}
          emphasis
        />
        <Figure label="Open checks" value={orders.isLoading ? '—' : String(openChecks.length)} detail="Still on the floor" />
        <Figure
          label="Seated"
          value={floor.isLoading ? '—' : `${seated}`}
          detail={floor.data ? `${seated} of ${tables.length} tables` : undefined}
        />
        <Figure label="Coming in" value={reservations.isLoading ? '—' : String(coming.length)} detail="Waiting to be seated" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border bg-card p-5">
          <SectionTitle title="The room" to="/floor" action="Tables" />
          {floor.isError ? <p className="mt-4 text-sm text-muted-foreground">The floor could not be loaded.</p> : null}
          {floor.isSuccess && tables.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No tables on this floor.</p> : null}
          {tables.length > 0 ? (
            <>
              <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                {ROOM.map((item) =>
                  counts[item.status] > 0 ? (
                    <span key={item.status} style={{ flexGrow: counts[item.status], background: item.color }} />
                  ) : null
                )}
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                {ROOM.map((item) => (
                  <li key={item.status} className="flex items-center gap-2 text-sm">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="num ml-auto">{counts[item.status]}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <SectionTitle title="Open checks" to="/orders" action="Orders" />
          {orders.isError ? <p className="mt-4 text-sm text-muted-foreground">Checks could not be loaded.</p> : null}
          {orders.isSuccess && openChecks.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No open checks.</p> : null}
          <ul className="mt-3">
            {openChecks.slice(0, 6).map((order) => (
              <li key={order.id} className="border-b last:border-b-0">
                <Link to={`/orders/${order.id}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                  <span className="min-w-0 flex-1 truncate">{checkTitle(order)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{orderServiceLabel(order)}</span>
                  <span className="num shrink-0 text-sm">{formatMoney(order.totalCents, order.currency || currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-4">
        <section className="rounded-2xl border bg-card p-5">
          <SectionTitle title="Paid today" to="/reports" action="Sales" />
          {report.isError ? <p className="mt-4 text-sm text-muted-foreground">Sales could not be loaded.</p> : null}
          {report.data && report.data.transactionCount === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No checks closed yet today.</p>
          ) : null}
          {report.data && report.data.transactionCount > 0 ? <Tenders report={report.data} /> : null}
        </section>
      </div>
    </div>
  )
}

function Figure({ label, value, detail, emphasis }: { label: string; value: string; detail?: string; emphasis?: boolean }) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-4">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={cn('num mt-2 font-serif', emphasis ? 'text-4xl' : 'text-3xl')}>{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  )
}

function SectionTitle({ title, to, action }: { title: string; to: string; action: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-serif text-2xl">{title}</h2>
      <Link to={to} className="text-sm text-muted-foreground hover:text-foreground">
        {action}
      </Link>
    </div>
  )
}

function Tenders({ report }: { report: DailyReportDto }) {
  const currency = report.currency
  return (
    <ul className="mt-3">
      {report.tenders.map((tender) => (
        <li key={tender.method} className="flex items-center gap-3 border-b py-3 text-sm last:border-b-0">
          <span className="flex-1">{PAYMENT_METHOD_LABEL[tender.method]}</span>
          <span className="num">{formatMoney(tender.netCents, currency)}</span>
        </li>
      ))}
    </ul>
  )
}

function countTables(tables: Array<{ status: TableStatus }>): Record<TableStatus, number> {
  const counts: Record<TableStatus, number> = {
    AVAILABLE: 0,
    OCCUPIED: 0,
    RESERVED: 0,
    CLEANING: 0,
    BILLING: 0
  }
  for (const table of tables) counts[table.status] += 1
  return counts
}

function closedLine(report: DailyReportDto): string {
  return report.transactionCount === 1 ? '1 check closed' : `${report.transactionCount} checks closed`
}

function checkTitle(order: OrderDto): string {
  if (order.type === 'DINE_IN') return order.tableLabel ? `Table ${order.tableLabel}` : 'Dine in'
  if (order.guestName) return order.guestName
  return ORDER_TYPE_LABEL[order.type]
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
