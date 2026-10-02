import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  KITCHEN_STATUS_STEP,
  type KitchenBoardDto,
  type KitchenStatus,
  type KitchenTicketDto,
  type OrderType
} from '@towns/shared'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { ApiError, api, apiBase } from '@/lib/api'
import { canUseKitchen, homePath } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useSession } from '@/stores/session-store'

const LANES: Array<{ status: Exclude<KitchenStatus, 'COMPLETED'>; label: string }> = [
  { status: 'NEW', label: 'New' },
  { status: 'PREPARING', label: 'Preparing' },
  { status: 'READY', label: 'Ready' }
]

const ACTION_LABEL: Record<Exclude<KitchenStatus, 'COMPLETED'>, string> = {
  NEW: 'Start',
  PREPARING: 'Ready',
  READY: 'Done'
}

const TYPE_LABEL: Record<OrderType, string> = {
  DINE_IN: 'Dine-in',
  TAKEOUT: 'Takeout',
  DELIVERY: 'Delivery',
  ONLINE: 'Online',
  QR: 'QR'
}

const DELAYED_MINUTES = 12

/** Refuses the pass unless the signed-in role is kitchen or manager. */
export function KitchenGate() {
  const user = useSession((state) => state.user)
  if (!user || !canUseKitchen(user.role)) return <Navigate to={homePath(user?.role)} replace />
  return <KitchenPage />
}

function KitchenPage() {
  const user = useSession((state) => state.user)
  const branchId = useSession((state) => state.activeBranchId)
  const signOut = useSession((state) => state.signOut)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const live = useKitchenSocket(branchId)
  const now = useClock()
  const [view, setView] = useState<'active' | 'done'>('active')
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const inflight = useRef(new Set<string>())
  const known = useRef(new Set<string>())
  const noticeTimer = useRef<number | null>(null)

  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile })
  const board = useQuery({
    queryKey: ['kitchen', branchId],
    enabled: !!branchId,
    queryFn: () => api.kitchen(branchId!),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    retry: 2
  })

  const active = useMemo(() => unique(board.data?.active ?? []), [board.data])
  const completed = useMemo(() => unique(board.data?.completed ?? []), [board.data])
  const activeKey = active.map((ticket) => ticket.id).join('|')

  useEffect(() => {
    const current = new Set(active.map((ticket) => ticket.id))
    const arrivals = active.filter((ticket) => known.current.size > 0 && !known.current.has(ticket.id))
    known.current = current
    if (arrivals.length === 0) return
    setFresh(new Set(arrivals.map((ticket) => ticket.id)))
    setNotice(arrivals.some((ticket) => ticket.kind === 'ADDITION') ? 'Items added' : 'New order')
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => {
      setFresh(new Set())
      setNotice(null)
    }, 8000)
  }, [activeKey, active])

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    }
  }, [])

  const delayed = active.filter((ticket) => ageMinutes(ticket.startedAt, now) >= DELAYED_MINUTES).length
  const interrupted = !live || (board.isError && !!board.data)
  const manager = user?.role !== 'KITCHEN_STAFF'

  async function advance(ticket: KitchenTicketDto) {
    const status = KITCHEN_STATUS_STEP[ticket.kitchenStatus]
    if (!isAdvance(status) || !branchId || inflight.current.has(ticket.id)) return
    inflight.current.add(ticket.id)
    setBusy(new Set(inflight.current))
    setFailures((current) => {
      if (!current[ticket.id]) return current
      const next = { ...current }
      delete next[ticket.id]
      return next
    })
    const key = ['kitchen', branchId] as const
    const snapshot = queryClient.getQueryData<KitchenBoardDto>(key)
    if (snapshot) queryClient.setQueryData(key, place(snapshot, { ...ticket, kitchenStatus: status }))
    try {
      const saved = await api.kitchenStatus(branchId, ticket.id, status)
      queryClient.setQueryData<KitchenBoardDto>(key, (current) => (current ? place(current, saved) : current))
    } catch (error) {
      if (snapshot) queryClient.setQueryData(key, snapshot)
      const message = error instanceof ApiError ? error.message : 'Could not update this order.'
      setFailures((current) => ({ ...current, [ticket.id]: message }))
    } finally {
      inflight.current.delete(ticket.id)
      setBusy(new Set(inflight.current))
    }
  }

  return (
    <div className="kitchen-pass dark flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="truncate font-serif text-2xl leading-none sm:text-3xl">{profile.data?.name || 'Towns'}</p>
          <p className="mt-1 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <span className={cn('h-1.5 w-1.5 rounded-full', interrupted ? 'bg-accent' : 'bg-[#2f6f4e]')} />
            Kitchen
            {interrupted ? <span className="normal-case tracking-normal">Reconnecting...</span> : null}
            {notice && !interrupted ? <span className="normal-case tracking-normal text-foreground">{notice}</span> : null}
          </p>
        </div>
        <time className="num text-lg text-muted-foreground">
          {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now)}
        </time>
        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="text-right">
            <p className="num text-sm">{active.length} active</p>
            {delayed > 0 ? <p className="text-xs text-accent">{delayed} delayed</p> : null}
          </div>
          <ViewSwitch view={view} onChange={setView} />
          {manager ? (
            <Link to="/floor" className="inline-flex h-12 items-center rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted">
              Floor
            </Link>
          ) : null}
          <span className="text-sm text-muted-foreground">{user?.firstName}</span>
          <button
            type="button"
            className="inline-flex h-12 items-center rounded-xl px-3 text-sm hover:bg-muted"
            onClick={() => {
              signOut()
              navigate('/pin')
            }}
          >
            Log out
          </button>
        </div>
      </header>

      {board.isPending ? (
        <StatusMessage title="Loading kitchen orders..." />
      ) : board.isError && !board.data ? (
        <StatusMessage title="Unable to load kitchen orders.">
          <button type="button" className="mt-6 h-14 rounded-2xl bg-primary px-8 text-base text-primary-foreground" onClick={() => void board.refetch()}>
            Retry
          </button>
        </StatusMessage>
      ) : view === 'done' ? (
        <CompletedList tickets={completed} now={now} />
      ) : active.length === 0 ? (
        <StatusMessage title="Kitchen is clear" detail="No active orders right now." />
      ) : (
        <div className="grid min-h-0 flex-1 content-start gap-6 overflow-auto p-4 sm:p-6 min-[1200px]:grid-cols-3 min-[1200px]:content-stretch min-[1200px]:overflow-hidden">
          {LANES.map((lane) => {
            const tickets = active.filter((ticket) => ticket.kitchenStatus === lane.status)
            return (
              <section key={lane.status} className="flex min-w-0 flex-col min-[1200px]:min-h-0 min-[1200px]:overflow-hidden">
                <div className="mb-3 flex items-baseline justify-between px-1">
                  <h2 className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">{lane.label}</h2>
                  <span className="num text-sm text-muted-foreground">{tickets.length}</span>
                </div>
                <div className="flex flex-col gap-4 min-[1200px]:min-h-0 min-[1200px]:flex-1 min-[1200px]:overflow-y-auto">
                  {tickets.length === 0 ? <p className="px-1 text-sm text-muted-foreground">Clear</p> : null}
                  {tickets.map((ticket) => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      now={now}
                      fresh={fresh.has(ticket.id)}
                      busy={busy.has(ticket.id)}
                      failure={failures[ticket.id] ?? null}
                      onAdvance={advance}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CompletedList({ tickets, now }: { tickets: KitchenTicketDto[]; now: number }) {
  if (tickets.length === 0) return <StatusMessage title="No completed orders yet today." />
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <div className="grid gap-4 md:grid-cols-2 min-[1400px]:grid-cols-3">
        {tickets.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} now={now} fresh={false} busy={false} failure={null} readOnly />
        ))}
      </div>
    </div>
  )
}

const TicketCard = memo(function TicketCard({
  ticket,
  now,
  fresh,
  busy,
  failure,
  readOnly = false,
  onAdvance
}: {
  ticket: KitchenTicketDto
  now: number
  fresh: boolean
  busy: boolean
  failure: string | null
  readOnly?: boolean
  onAdvance?: (ticket: KitchenTicketDto) => void
}) {
  const minutes = ageMinutes(ticket.startedAt, now)
  const delayed = !readOnly && minutes >= DELAYED_MINUTES
  const action = ticket.kitchenStatus === 'COMPLETED' ? null : ACTION_LABEL[ticket.kitchenStatus]
  const next = KITCHEN_STATUS_STEP[ticket.kitchenStatus]
  return (
    <article
      className={cn(
        'rounded-2xl border bg-card px-5 py-4',
        fresh && 'rise',
        delayed && 'border-accent/50'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-serif text-4xl leading-none tracking-tight sm:text-5xl">#{ticket.ticketNumber}</h3>
        <p className={cn('num pt-2 text-sm', delayed ? 'text-accent' : 'text-muted-foreground')}>
          {readOnly ? 'Done' : waitingLabel(minutes)}
        </p>
      </div>
      <p className="mt-3 text-sm uppercase tracking-[0.14em] text-muted-foreground">{serviceLine(ticket)}</p>
      {ticket.kind === 'ADDITION' ? (
        <p className="mt-2 text-sm font-medium uppercase tracking-[0.16em]">Additional order</p>
      ) : null}
      {ticket.kind === 'ADDITION' ? (
        <p className="mt-1 text-sm text-muted-foreground">Added {clockLabel(ticket.startedAt)}</p>
      ) : null}
      {ticket.serverName ? <p className="mt-1 text-sm text-muted-foreground">Server {ticket.serverName}</p> : null}
      {ticket.guestName ? <p className="mt-1 text-lg">{ticket.guestName}</p> : null}
      {ticket.type === 'DELIVERY' && ticket.deliveryAddress ? (
        <p className="mt-1 text-sm text-muted-foreground">{ticket.deliveryAddress}</p>
      ) : null}

      <ul className="mt-5 space-y-4">
        {ticket.items.map((item) => {
          const cancelled = item.quantity <= 0 && item.cancelledQuantity > 0
          const shown = item.quantity > 0 ? item.quantity : item.cancelledQuantity
          return (
            <li key={item.id}>
              <p className={cn('text-xl leading-snug sm:text-2xl', cancelled && 'text-muted-foreground line-through')}>
                <span className="num">{shown}</span>
                <span className="px-2 text-muted-foreground">×</span>
                {item.name}
              </p>
              {item.modifiers.length > 0 ? (
                <ul className="mt-1 space-y-0.5 pl-1">
                  {item.modifiers.map((modifier) => (
                    <li key={modifier.id} className="text-base text-foreground/90">
                      · {modifier.name}
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.notes ? (
                <p className="mt-1 text-sm font-medium uppercase tracking-[0.12em] text-accent">{item.notes}</p>
              ) : null}
              {item.cancelledQuantity > 0 ? (
                <p className="mt-1 text-sm uppercase tracking-[0.12em] text-accent">
                  {cancelled ? 'Cancelled' : `${item.cancelledQuantity} cancelled`}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      {ticket.notes ? <p className="mt-4 text-sm uppercase tracking-[0.08em] text-accent">{ticket.notes}</p> : null}

      {action && next && onAdvance ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAdvance(ticket)}
          className="mt-5 flex h-16 w-full items-center justify-center rounded-2xl bg-primary text-lg text-primary-foreground active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? 'Saving...' : action}
        </button>
      ) : null}
      {failure ? <p className="mt-2 text-sm text-accent">{failure}</p> : null}
    </article>
  )
})

function ViewSwitch({ view, onChange }: { view: 'active' | 'done'; onChange: (view: 'active' | 'done') => void }) {
  return (
    <div className="flex rounded-xl bg-muted p-1">
      {(
        [
          ['active', 'Active'],
          ['done', 'Done']
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn('h-10 rounded-lg px-3 text-sm sm:px-4', view === id ? 'bg-card text-foreground' : 'text-muted-foreground')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function StatusMessage({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h2 className="font-serif text-4xl sm:text-5xl">{title}</h2>
      {detail ? <p className="mt-3 text-muted-foreground">{detail}</p> : null}
      {children}
    </div>
  )
}

function useClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** Keeps the current tickets on screen if the socket drops, and refetches when it returns. */
function useKitchenSocket(branchId: string | null): boolean {
  const token = useSession((state) => state.accessToken)
  const queryClient = useQueryClient()
  const [live, setLive] = useState(true)

  useEffect(() => {
    if (!branchId || !token) {
      setLive(false)
      return
    }
    const socket = io(apiBase, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000
    })
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['kitchen', branchId] })
    }
    socket.on('connect', () => {
      setLive(true)
      socket.emit('branch:join', branchId)
      refresh()
    })
    socket.on('disconnect', () => setLive(false))
    socket.on('connect_error', () => setLive(false))
    socket.on('order.updated', refresh)
    socket.on('order.sent', refresh)
    socket.on('order.items.added', refresh)
    socket.on('order.items.cancelled', refresh)
    socket.on('sync.applied', refresh)
    return () => {
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [branchId, queryClient, token])

  return live
}

function isAdvance(status: KitchenStatus | null): status is 'PREPARING' | 'READY' | 'COMPLETED' {
  return status === 'PREPARING' || status === 'READY' || status === 'COMPLETED'
}

function unique(rows: KitchenTicketDto[]): KitchenTicketDto[] {
  const map = new Map<string, KitchenTicketDto>()
  for (const row of rows) map.set(row.id, row)
  return [...map.values()]
}

function place(board: KitchenBoardDto, ticket: KitchenTicketDto): KitchenBoardDto {
  const drop = (rows: KitchenTicketDto[]) => rows.filter((row) => row.id !== ticket.id)
  if (ticket.kitchenStatus === 'COMPLETED') {
    return { ...board, active: drop(board.active), completed: [ticket, ...drop(board.completed)] }
  }
  const active = [...drop(board.active), ticket].sort(
    (a, b) => a.startedAt.localeCompare(b.startedAt) || a.sequence - b.sequence || a.ticketNumber - b.ticketNumber
  )
  return { ...board, active, completed: drop(board.completed) }
}

function ageMinutes(startedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000))
}

function waitingLabel(minutes: number): string {
  if (minutes < 1) return 'Just now'
  if (minutes === 1) return '1 min'
  return `${minutes} min`
}

function clockLabel(startedAt: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(startedAt))
}

function serviceLine(ticket: KitchenTicketDto): string {
  const type = TYPE_LABEL[ticket.type]
  if (ticket.tableLabel) return `${type} · Table ${ticket.tableLabel}`
  return type
}
