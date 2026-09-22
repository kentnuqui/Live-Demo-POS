import type {
  AuthSessionDto,
  BranchDto,
  BranchSettingsDto,
  BranchSettingsInput,
  DailyReportDto,
  DiscountInput,
  FloorPlanDto,
  CategoryCreateInput,
  CategoryUpdateInput,
  MenuCategoryDto,
  MenuItemCreateInput,
  MenuItemUpdateInput,
  ModifierGroupDto,
  ModifierGroupCreateInput,
  ModifierGroupUpdateInput,
  ModifierOptionCreateInput,
  ModifierOptionUpdateInput,
  MenuItemModifierAssignInput,
  OrderDto,
  PaymentInput,
  RefundInput,
  PrinterDto,
  PrinterInput,
  ProfileInput,
  ReceiptInput,
  ReservationDto,
  ReservationInput,
  RestaurantProfileDto,
  StationTicketDto,
  SyncPullDto,
  SyncPushSummaryDto,
  UserDto
} from '@towns/shared'
import { useSession } from '@/stores/session-store'

export const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
const base = apiBase

export class ApiError extends Error {
  readonly status: number
  readonly details: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.status = status
    this.details = details ?? []
  }
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof ApiError && error.status === 0)
}

let refreshing: Promise<string | null> | null = null

async function refreshAccess(): Promise<string | null> {
  const refreshToken = useSession.getState().refreshToken
  if (!refreshToken) return null
  const response = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  })
  if (!response.ok) return null
  const json = (await response.json()) as { data: AuthSessionDto }
  useSession.getState().setSession(json.data)
  return json.data.accessToken
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  const token = useSession.getState().accessToken
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(`${base}${path}`, { ...init, headers })
  } catch (error) {
    if (error instanceof TypeError) throw error
    throw new ApiError('Network unavailable', 0)
  }
  if (response.status === 401 && retry && !path.startsWith('/api/auth/')) {
    refreshing ??= refreshAccess().finally(() => {
      refreshing = null
    })
    const next = await refreshing
    if (next) return request<T>(path, init, false)
  }
  const json = (await response.json()) as { status: string; data: T; message?: string; details?: unknown }
  if (!response.ok || json.status === 'error') {
    throw new ApiError(json.message ?? 'Request failed', response.status, json.details)
  }
  return json.data
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthSessionDto>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  pin: (pin: string) => request<AuthSessionDto>('/api/auth/pin', { method: 'POST', body: JSON.stringify({ pin }) }),
  logout: (refreshToken: string) =>
    request<{ signedOut: boolean }>('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  me: () => request<UserDto>('/api/auth/me'),
  branches: () => request<BranchDto[]>('/api/branches'),
  createBranch: (body: unknown) => request<BranchDto>('/api/branches', { method: 'POST', body: JSON.stringify(body) }),
  updateBranch: (id: string, body: unknown) =>
    request<BranchDto>(`/api/branches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  profile: () => request<RestaurantProfileDto>('/api/profile'),
  saveProfile: (body: ProfileInput) => request<RestaurantProfileDto>('/api/profile', { method: 'PUT', body: JSON.stringify(body) }),
  settings: (branchId: string) => request<BranchSettingsDto>(`/api/branches/${branchId}/settings`),
  saveSettings: (branchId: string, body: BranchSettingsInput) =>
    request<BranchSettingsDto>(`/api/branches/${branchId}/settings`, { method: 'PUT', body: JSON.stringify(body) }),
  saveReceipt: (branchId: string, body: ReceiptInput) =>
    request<BranchSettingsDto>(`/api/branches/${branchId}/receipt`, { method: 'PUT', body: JSON.stringify(body) }),
  printers: (branchId: string) => request<PrinterDto[]>(`/api/branches/${branchId}/printers`),
  createPrinter: (branchId: string, body: PrinterInput) =>
    request<PrinterDto>(`/api/branches/${branchId}/printers`, { method: 'POST', body: JSON.stringify(body) }),
  updatePrinter: (branchId: string, printerId: string, body: PrinterInput) =>
    request<PrinterDto>(`/api/branches/${branchId}/printers/${printerId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePrinter: (branchId: string, printerId: string) =>
    request<{ deleted: boolean }>(`/api/branches/${branchId}/printers/${printerId}`, { method: 'DELETE' }),
  users: () => request<UserDto[]>('/api/users'),
  createUser: (body: unknown) => request<UserDto>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: unknown) => request<UserDto>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deactivateUser: (id: string) => request<UserDto>(`/api/users/${id}`, { method: 'DELETE' }),
  floor: (branchId: string) => request<FloorPlanDto[]>(`/api/branches/${branchId}/floor`),
  createTable: (branchId: string, body: unknown) =>
    request<{ id: string }>(`/api/branches/${branchId}/tables`, { method: 'POST', body: JSON.stringify(body) }),
  saveLayout: (branchId: string, body: unknown) =>
    request<{ saved: boolean }>(`/api/branches/${branchId}/layout`, { method: 'PUT', body: JSON.stringify(body) }),
  tableStatus: (branchId: string, tableId: string, status: 'AVAILABLE' | 'CLEANING') =>
    request<{ saved: boolean }>(`/api/branches/${branchId}/tables/${tableId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    }),
  deleteTable: (branchId: string, tableId: string) =>
    request<{ deleted: boolean }>(`/api/branches/${branchId}/tables/${tableId}`, { method: 'DELETE' }),
  menu: (branchId: string) => request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu`),
  menuManage: (branchId: string) => request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/manage`),
  createCategory: (branchId: string, body: CategoryCreateInput) =>
    request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/categories`, { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (branchId: string, categoryId: string, body: CategoryUpdateInput) =>
    request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/categories/${categoryId}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    }),
  deleteCategory: (branchId: string, categoryId: string) =>
    request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/categories/${categoryId}`, { method: 'DELETE' }),
  reorderCategories: (branchId: string, ids: string[]) =>
    request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/categories/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ ids })
    }),
  createMenuItem: (branchId: string, body: MenuItemCreateInput) =>
    request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/items`, { method: 'POST', body: JSON.stringify(body) }),
  updateMenuItem: (branchId: string, itemId: string, body: MenuItemUpdateInput) =>
    request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    }),
  deleteMenuItem: (branchId: string, itemId: string) =>
    request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/items/${itemId}`, { method: 'DELETE' }),
  reorderMenuItems: (branchId: string, categoryId: string, ids: string[]) =>
    request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/items/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ categoryId, ids })
    }),

  // Modifier Management
  modifierGroups: (branchId: string) => request<ModifierGroupDto[]>(`/api/branches/${branchId}/modifiers`),
  createModifierGroup: (branchId: string, body: ModifierGroupCreateInput) =>
    request<ModifierGroupDto[]>(`/api/branches/${branchId}/modifiers`, { method: 'POST', body: JSON.stringify(body) }),
  updateModifierGroup: (branchId: string, groupId: string, body: ModifierGroupUpdateInput) =>
    request<ModifierGroupDto[]>(`/api/branches/${branchId}/modifiers/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    }),
  deleteModifierGroup: (branchId: string, groupId: string) =>
    request<ModifierGroupDto[]>(`/api/branches/${branchId}/modifiers/${groupId}`, { method: 'DELETE' }),
  createModifierOption: (branchId: string, body: ModifierOptionCreateInput) =>
    request<ModifierGroupDto[]>(`/api/branches/${branchId}/modifier-options`, { method: 'POST', body: JSON.stringify(body) }),
  updateModifierOption: (branchId: string, optionId: string, body: ModifierOptionUpdateInput) =>
    request<ModifierGroupDto[]>(`/api/branches/${branchId}/modifier-options/${optionId}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    }),
  deleteModifierOption: (branchId: string, optionId: string) =>
    request<ModifierGroupDto[]>(`/api/branches/${branchId}/modifier-options/${optionId}`, { method: 'DELETE' }),
  assignModifierGroups: (branchId: string, itemId: string, body: MenuItemModifierAssignInput) =>
    request<MenuCategoryDto[]>(`/api/branches/${branchId}/menu/items/${itemId}/modifiers`, {
      method: 'PUT',
      body: JSON.stringify(body)
    }),
  reservations: (branchId: string) => request<ReservationDto[]>(`/api/branches/${branchId}/reservations`),
  createReservation: (branchId: string, body: ReservationInput) =>
    request<ReservationDto>(`/api/branches/${branchId}/reservations`, { method: 'POST', body: JSON.stringify(body) }),
  seatReservation: (branchId: string, id: string, tableId?: string) =>
    request<OrderDto>(`/api/branches/${branchId}/reservations/${id}/seat`, {
      method: 'POST',
      body: JSON.stringify({ tableId })
    }),
  cancelReservation: (branchId: string, id: string) =>
    request<ReservationDto>(`/api/branches/${branchId}/reservations/${id}/cancel`, { method: 'POST', body: '{}' }),
  orders: (branchId: string, type?: string) =>
    request<OrderDto[]>(`/api/branches/${branchId}/orders${type ? `?type=${type}` : ''}`),
  createOrder: (branchId: string, body: unknown) =>
    request<OrderDto>(`/api/branches/${branchId}/orders`, { method: 'POST', body: JSON.stringify(body) }),
  order: (orderId: string) => request<OrderDto>(`/api/orders/${orderId}`),
  patchOrder: (orderId: string, body: unknown) =>
    request<OrderDto>(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addItems: (orderId: string, body: unknown) =>
    request<OrderDto>(`/api/orders/${orderId}/items`, { method: 'POST', body: JSON.stringify(body) }),
  voidItem: (orderId: string, itemId: string) =>
    request<OrderDto>(`/api/orders/${orderId}/items/${itemId}/void`, { method: 'POST', body: '{}' }),
  adjustItem: (orderId: string, itemId: string, delta: number) =>
    request<OrderDto>(`/api/orders/${orderId}/items/${itemId}/quantity`, {
      method: 'POST',
      body: JSON.stringify({ delta })
    }),
  send: (orderId: string) =>
    request<{ order: OrderDto; tickets: StationTicketDto[] }>(`/api/orders/${orderId}/send`, { method: 'POST', body: '{}' }),
  progress: (orderId: string, status: string) =>
    request<OrderDto>(`/api/orders/${orderId}/progress`, { method: 'POST', body: JSON.stringify({ status }) }),
  transfer: (orderId: string, tableId: string) =>
    request<OrderDto>(`/api/orders/${orderId}/transfer`, { method: 'POST', body: JSON.stringify({ tableId }) }),
  merge: (orderId: string, sourceOrderId: string) =>
    request<OrderDto>(`/api/orders/${orderId}/merge`, { method: 'POST', body: JSON.stringify({ sourceOrderId }) }),
  split: (orderId: string, body: unknown) =>
    request<{ order: OrderDto; split: OrderDto }>(`/api/orders/${orderId}/split`, { method: 'POST', body: JSON.stringify(body) }),
  bill: (orderId: string) => request<OrderDto>(`/api/orders/${orderId}/bill`, { method: 'POST', body: '{}' }),
  discount: (orderId: string, body: DiscountInput) =>
    request<OrderDto>(`/api/orders/${orderId}/discount`, { method: 'POST', body: JSON.stringify(body) }),
  pay: (orderId: string, body: PaymentInput) =>
    request<OrderDto>(`/api/orders/${orderId}/pay`, { method: 'POST', body: JSON.stringify(body) }),
  refund: (orderId: string, body: RefundInput) =>
    request<OrderDto>(`/api/orders/${orderId}/refund`, { method: 'POST', body: JSON.stringify(body) }),
  finish: (orderId: string) => request<OrderDto>(`/api/orders/${orderId}/finish`, { method: 'POST', body: '{}' }),
  dailyReport: (branchId: string, day?: string) =>
    request<DailyReportDto>(`/api/branches/${branchId}/reports/daily${day ? `?day=${day}` : ''}`),
  push: (operations: unknown[]) =>
    request<SyncPushSummaryDto>('/api/sync/push', { method: 'POST', body: JSON.stringify({ operations }) }),
  pull: (branchId: string, lastSyncTimestamp?: string) => {
    const query = new URLSearchParams({ branchId })
    if (lastSyncTimestamp) query.set('lastSyncTimestamp', lastSyncTimestamp)
    return request<SyncPullDto>(`/api/sync/pull?${query.toString()}`)
  },
  qr: (token: string) => request<QrContext>(`/api/qr/${token}`),
  qrOrder: (token: string, body: unknown) => request<OrderDto>(`/api/qr/${token}/orders`, { method: 'POST', body: JSON.stringify(body) })
}

export interface QrContext {
  token: string
  branchId: string
  branchName: string
  restaurantName: string
  tableId: string
  tableLabel: string
  currency: string
  menu: MenuCategoryDto[]
  order: OrderDto | null
}
