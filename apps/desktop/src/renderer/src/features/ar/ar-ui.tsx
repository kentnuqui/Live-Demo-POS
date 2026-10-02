import { formatMoney, type ArAccountStatus, type ArInvoiceStatus } from '@towns/shared'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function money(cents: number, currency: string): string {
  return formatMoney(cents, currency)
}

export function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [value])
  return debounced
}

export function problem(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function Empty({ children }: { children: string }) {
  return <p className="px-4 py-8 text-sm text-muted-foreground">{children}</p>
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
  className
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  className?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return (
    <div className={cn('flex items-center justify-between gap-3 px-4 py-3 text-sm', className)}>
      <span className="text-muted-foreground">{total === 0 ? 'None' : `${start}–${end} of ${total}`}</span>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

/** Same pill palette as the order board: accent only for what needs attention. */
export function accountStatusClass(status: ArAccountStatus): string {
  if (status === 'ACTIVE') return 'bg-muted text-foreground'
  if (status === 'SUSPENDED') return 'bg-accent/10 text-accent'
  return 'bg-muted text-muted-foreground'
}

export function invoiceStatusClass(status: ArInvoiceStatus): string {
  if (status === 'OVERDUE') return 'bg-accent/10 text-accent'
  if (status === 'OPEN' || status === 'PARTIALLY_PAID') return 'bg-muted text-foreground'
  return 'bg-muted text-muted-foreground'
}

/** Calendar day for a `YYYY-MM-DD` key. Day keys are already in the branch calendar. */
export function dayLabel(value: string): string {
  const [year, month, date] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !date) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, date))
  )
}

/** Date and clock in the branch timezone. Falls back to the calendar day until the zone is known. */
export function stampLabel(iso: string, timeZone: string | undefined): string {
  if (!timeZone) return dayLabel(iso)
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso))
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-4">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="num mt-2 font-serif text-3xl">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  )
}
