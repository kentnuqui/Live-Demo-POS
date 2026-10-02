import { hasPermission, type UserRole } from '@towns/shared'

/** Cashiers work from Orders and Book. Every other role keeps the full house. */
const CASHIER_PAGES = ['/orders', '/reservations', '/ar'] as const

/** House overview. Super admins and admins only. */
const ADMIN_PAGES = ['/dashboard'] as const

/** Super admin and admin. Managers and floor staff are not included. */
export function isAdmin(role: UserRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN'
}

/** Kitchen staff and managers. Everyone else is refused, including a typed URL. */
export function canUseKitchen(role: UserRole | undefined): boolean {
  return !!role && hasPermission(role, 'kitchen.display')
}

/** Where a signed-in person should land. Kitchen opens on the pass. */
export function homePath(role: UserRole | undefined): string {
  if (role === 'KITCHEN_STAFF') return '/kitchen'
  return role === 'CASHIER' ? '/orders' : '/floor'
}

function isKitchenPath(pathname: string): boolean {
  return pathname === '/kitchen' || pathname.startsWith('/kitchen/')
}

/**
 * Cashiers may open Orders (including a check) and Book.
 * The overview is limited to admins.
 * Kitchen staff stay on the pass. The pass itself is limited to kitchen and managers.
 */
export function canOpenPage(role: UserRole | undefined, pathname: string): boolean {
  if (isKitchenPath(pathname)) return canUseKitchen(role)
  if (role === 'KITCHEN_STAFF') return false
  if (ADMIN_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))) return isAdmin(role)
  if (pathname === '/ar' || pathname.startsWith('/ar/')) return !!role && hasPermission(role, 'ar.view')
  if (role !== 'CASHIER') return true
  return CASHIER_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))
}
