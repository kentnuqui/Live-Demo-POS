import { hasPermission, type Permission } from '@towns/shared'
import { BarChart3, ClipboardList, LayoutGrid, Moon, Settings, Sun, Users, UtensilsCrossed, Wrench } from 'lucide-react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { canOpenPage, homePath } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useBranchSocket } from '@/features/sync/use-branch-socket'
import { useSync } from '@/features/sync/use-sync'
import { useSession } from '@/stores/session-store'
import { useUi } from '@/stores/ui-store'

const LINKS: Array<{ to: string; label: string; icon: typeof LayoutGrid; permission?: Permission }> = [
  { to: '/floor', label: 'Tables', icon: LayoutGrid, permission: 'orders.read' },
  { to: '/orders', label: 'Orders', icon: ClipboardList, permission: 'orders.read' },
  { to: '/reports', label: 'Sales', icon: BarChart3, permission: 'orders.bill' },
  { to: '/reservations', label: 'Book', icon: Users, permission: 'orders.read' },
  { to: '/menu', label: 'Menu', icon: UtensilsCrossed, permission: 'settings.manage' },
  { to: '/modifiers', label: 'Modifiers', icon: Wrench, permission: 'settings.manage' },
  { to: '/settings', label: 'House', icon: Settings, permission: 'settings.manage' }
]

export function Shell() {
  const user = useSession((state) => state.user)
  const branchId = useSession((state) => state.activeBranchId)
  const setBranch = useSession((state) => state.setBranch)
  const signOut = useSession((state) => state.signOut)
  const zen = useUi((state) => state.zen)
  const theme = useUi((state) => state.theme)
  const toggleTheme = useUi((state) => state.toggleTheme)
  const toggleZen = useUi((state) => state.toggleZen)
  const connection = useUi((state) => state.connection)
  const outbox = useUi((state) => state.outbox)
  const navigate = useNavigate()
  const location = useLocation()
  const branches = useQuery({ queryKey: ['branches'], queryFn: api.branches, enabled: !!user })

  useSync(branchId)
  useBranchSocket(branchId)

  useEffect(() => {
    if (!branchId && branches.data?.[0]) setBranch(branches.data[0].id)
  }, [branchId, branches.data, setBranch])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.altKey || event.metaKey) || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const map: Record<string, string> = { '1': '/floor', '2': '/orders', '3': '/reservations', '4': '/reports' }
      const path = map[event.key]
      const link = LINKS.find((item) => item.to === path)
      if (!path || !link || !user || !canOpenPage(user.role, path)) return
      if (link.permission && !hasPermission(user.role, link.permission)) return
      event.preventDefault()
      navigate(path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, user])

  const canSwitch = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'

  return (
    <div className="flex h-full">
      {zen ? null : (
        <nav className="flex w-[92px] shrink-0 flex-col items-center border-r bg-card py-4">
          <div className="font-serif text-2xl">T</div>
          <div className="mt-6 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {LINKS.filter((link) => user && canOpenPage(user.role, link.to) && (!link.permission || hasPermission(user.role, link.permission))).map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'flex w-[76px] flex-col items-center gap-1 rounded-2xl px-2 py-3 text-[11px] tracking-wide',
                    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  )
                }
              >
                <link.icon className="h-5 w-5" />
                {link.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-4 border-b px-5">
          <div className="font-serif text-2xl leading-none">Towns</div>
          {canSwitch && !zen ? (
            <select
              className="h-9 rounded-lg border bg-card px-2 text-sm"
              value={branchId ?? ''}
              onChange={(event) => setBranch(event.target.value)}
            >
              {branches.data?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              {connection === 'offline' ? 'Emergency mode' : connection === 'syncing' ? 'Syncing' : 'Live'}
              {outbox ? ` · ${outbox} waiting` : ''}
            </span>
            <button type="button" onClick={toggleZen} className="rounded-lg px-2 py-1 hover:bg-muted">
              {zen ? 'Exit zen' : 'Zen'}
            </button>
            <button type="button" onClick={toggleTheme} className="rounded-lg p-2 hover:bg-muted" aria-label="Theme">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <span>
              {user?.firstName} {user?.lastName}
            </span>
            <button
              type="button"
              className="rounded-lg px-2 py-1 hover:bg-muted"
              onClick={() => {
                signOut()
                navigate('/pin')
              }}
            >
              Lock
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0 overflow-hidden">
            {user && !canOpenPage(user.role, location.pathname) ? <Navigate to={homePath(user.role)} replace /> : <Outlet />}
          </div>
        </main>
      </div>
    </div>
  )
}
