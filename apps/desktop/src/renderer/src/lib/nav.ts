import type { UserRole } from '@towns/shared'

/** Cashiers work from Orders and Book. Every other role keeps the full house. */
const CASHIER_PAGES = ['/orders', '/reservations'] as const

/** Where a signed-in person should land. */
export function homePath(role: UserRole | undefined): string {
  return role === 'CASHIER' ? '/orders' : '/floor'
}

/**
 * Cashiers may open Orders (including a check) and Book.
 * Any other path is closed for that role.
 */
export function canOpenPage(role: UserRole | undefined, pathname: string): boolean {
  if (role !== 'CASHIER') return true
  return CASHIER_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))
}
