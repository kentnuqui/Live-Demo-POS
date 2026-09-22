import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from '@/components/shell'
import { ToastViewport } from '@/components/toast-viewport'
import { LoginPage } from '@/features/auth/login-page'
import { PinPage } from '@/features/auth/pin-page'
import { RequireAuth } from '@/features/auth/require-auth'
import { FloorPage } from '@/features/floor/floor-page'
import { NewOrderPage } from '@/features/orders/new-order-page'
import { OrderPage } from '@/features/orders/order-page'
import { OrdersPage } from '@/features/orders/orders-page'
import { MenuPage } from '@/features/menu/menu-page'
import { ModifiersPage } from '@/features/modifiers/modifiers-page'
import { GuestPage } from '@/features/qr/guest-page'
import { ReportsPage } from '@/features/reports/reports-page'
import { ReservationsPage } from '@/features/reservations/reservations-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { apiBase } from '@/lib/api'
import { homePath } from '@/lib/nav'
import { loadStoredSession, useSession } from '@/stores/session-store'
import { applyStoredTheme } from '@/stores/ui-store'
import type { AuthSessionDto } from '@towns/shared'

/** Cashiers open on Orders. Everyone else opens on the floor. */
function HomeRedirect() {
  const user = useSession((state) => state.user)
  return <Navigate to={homePath(user?.role)} replace />
}

export function App() {
  const markHydrated = useSession((state) => state.markHydrated)
  const setSession = useSession((state) => state.setSession)
  const setBranch = useSession((state) => state.setBranch)

  useEffect(() => {
    applyStoredTheme()
    void (async () => {
      const stored = await loadStoredSession()
      if (stored.activeBranchId) setBranch(stored.activeBranchId)
      if (stored.refreshToken) {
        try {
          const response = await fetch(`${apiBase}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: stored.refreshToken })
          })
          if (response.ok) {
            const json = (await response.json()) as { data: AuthSessionDto }
            setSession(json.data)
          }
        } catch {
          // The PIN screen can still unlock a terminal that has signed in before.
        }
      }
      markHydrated()
    })()
  }, [markHydrated, setBranch, setSession])

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pin" element={<PinPage />} />
        <Route path="/q/:token" element={<GuestPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route index element={<HomeRedirect />} />
            <Route path="/floor" element={<FloorPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/orders/new" element={<NewOrderPage />} />
            <Route path="/orders/:orderId" element={<OrderPage />} />
            <Route path="/reservations" element={<ReservationsPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/modifiers" element={<ModifiersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<HomeRedirect />} />
          </Route>
        </Route>
      </Routes>
      <ToastViewport />
    </HashRouter>
  )
}
