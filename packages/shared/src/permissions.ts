import { ROLE_RANK, type UserRole } from './enums.js'

export const PERMISSIONS = [
  'settings.manage',
  'users.manage',
  'branches.manage',
  'floor.edit',
  'orders.write',
  'orders.bill',
  'orders.kitchen',
  'orders.read',
  'reservations.write'
] as const

export type Permission = (typeof PERMISSIONS)[number]

const GRANTS: Record<Permission, readonly UserRole[]> = {
  'settings.manage': ['SUPER_ADMIN', 'ADMIN', 'RESTAURANT_MANAGER'],
  'users.manage': ['SUPER_ADMIN', 'ADMIN', 'RESTAURANT_MANAGER'],
  'branches.manage': ['SUPER_ADMIN', 'ADMIN'],
  'floor.edit': ['SUPER_ADMIN', 'ADMIN', 'RESTAURANT_MANAGER'],
  'orders.write': ['SUPER_ADMIN', 'ADMIN', 'RESTAURANT_MANAGER', 'CASHIER', 'WAITER'],
  'orders.bill': ['SUPER_ADMIN', 'ADMIN', 'RESTAURANT_MANAGER', 'CASHIER'],
  'orders.kitchen': ['SUPER_ADMIN', 'ADMIN', 'RESTAURANT_MANAGER', 'KITCHEN_STAFF', 'BARTENDER'],
  'orders.read': [
    'SUPER_ADMIN',
    'ADMIN',
    'RESTAURANT_MANAGER',
    'CASHIER',
    'WAITER',
    'KITCHEN_STAFF',
    'BARTENDER',
    'INVENTORY_STAFF'
  ],
  'reservations.write': ['SUPER_ADMIN', 'ADMIN', 'RESTAURANT_MANAGER', 'CASHIER', 'WAITER']
}

/** Returns whether a role may perform the action. */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return GRANTS[permission].includes(role)
}

/** Admins span every branch. Everyone else is bound to the branch on their account. */
export function canAccessBranch(role: UserRole, userBranchId: string | null, branchId: string): boolean {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true
  return userBranchId === branchId
}

/** A person may only grant roles at or below their own rank, and never their own rank for super/admin creation by managers. */
export function canAssignRole(actor: UserRole, target: UserRole): boolean {
  if (actor === 'SUPER_ADMIN') return true
  if (actor === 'ADMIN') return target !== 'SUPER_ADMIN'
  if (actor === 'RESTAURANT_MANAGER') return ROLE_RANK[target] < ROLE_RANK.RESTAURANT_MANAGER
  return false
}
