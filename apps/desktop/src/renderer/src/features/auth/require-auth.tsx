import { Navigate, Outlet } from 'react-router-dom'
import { Mark } from '@/components/mark'
import { useSession } from '@/stores/session-store'

export function RequireAuth() {
  const hydrated = useSession((state) => state.hydrated)
  const user = useSession((state) => state.user)
  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <Mark />
      </div>
    )
  }
  if (!user) return <Navigate to="/pin" replace />
  return <Outlet />
}
