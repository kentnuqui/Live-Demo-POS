import type {
  ArAccountStatus,
  ArInvoiceStatus,
  ArLedgerKind,
  ArTerms,
  DiningProgress,
  DiscountKind,
  MenuStation,
  KitchenStatus,
  KitchenSubmissionKind,
  OrderSource,
  ServiceStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PrinterConnection,
  PrinterKind,
  ReservationStatus,
  ReservationType,
  TableShape,
  TableStatus,
  TableZone,
  UserRole
} from './enums.js'

export interface UserDto {
  id: string
  email: string | null
  firstName: string
  lastName: string
  role: UserRole
  branchId: string | null
  isActive: boolean
}

export interface AuthSessionDto {
  accessToken: string
  refreshToken: string
  user: UserDto
}

export interface BranchDto {
  id: string
  name: string
  code: string
  address: string
  city: string
  phone: string
  timezone: string
  isActive: boolean
}

export interface RestaurantProfileDto {
  id: string
  name: string
  legalName: string
  tagline: string
  phone: string
  email: string
  address: string
}

export interface BranchSettingsDto {
  branchId: string
  currency: string
  serviceChargeBps: number
  serviceChargeLabel: string
  receiptHeader: string
  receiptFooter: string
  showServerOnReceipt: boolean
  showTableOnReceipt: boolean
}

export interface PrinterDto {
  id: string
  branchId: string
  name: string
  kind: PrinterKind
  connection: PrinterConnection
  address: string
  paperWidth: number
  isDefault: boolean
  isActive: boolean
}

export interface FloorOrderSummary {
  id: string
  status: OrderStatus
  progress: DiningProgress
  guestCount: number
  guestName: string
  totalCents: number
  currency: string
  openedAt: string
}

export interface FloorReservationSummary {
  id: string
  guestName: string
  guestCount: number
  reservedAt: string
  type: ReservationType
}

export interface FloorTableDto {
  id: string
  branchId: string
  floorPlanId: string
  label: string
  zone: TableZone
  shape: TableShape
  seats: number
  posX: number
  posY: number
  width: number
  height: number
  rotation: number
  status: TableStatus
  qrToken: string | null
  openOrderCount: number
  activeOrder: FloorOrderSummary | null
  nextReservation: FloorReservationSummary | null
}

export interface FloorPlanDto {
  id: string
  branchId: string
  name: string
  isDefault: boolean
  tables: FloorTableDto[]
}

export interface ReservationDto {
  id: string
  branchId: string
  tableId: string | null
  tableLabel: string | null
  type: ReservationType
  status: ReservationStatus
  guestName: string
  guestPhone: string
  guestCount: number
  reservedAt: string
  durationMinutes: number
  depositAmountCents: number
  depositPaid: boolean
  notes: string
}

export interface ModifierOptionDto {
  id: string
  modifierGroupId: string
  name: string
  description: string
  priceCents: number
  sortOrder: number
  isActive: boolean
}

export interface ModifierGroupDto {
  id: string
  branchId: string
  name: string
  description: string
  isRequired: boolean
  minSelections: number
  maxSelections: number
  isMultipleSelect: boolean
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  options: ModifierOptionDto[]
}

export interface MenuItemDto {
  id: string
  categoryId: string
  name: string
  description: string
  priceCents: number
  station: MenuStation
  isAvailable: boolean
  sortOrder: number
  modifierGroups?: ModifierGroupDto[]
}

export interface MenuCategoryDto {
  id: string
  branchId: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  items: MenuItemDto[]
}

export interface PaymentDto {
  id: string
  method: PaymentMethod
  amountCents: number
  tenderedCents: number
  changeCents: number
  note: string
  createdAt: string
}

export interface RefundDto {
  id: string
  method: PaymentMethod
  amountCents: number
  reason: string
  createdAt: string
}

export interface OrderItemModifierDto {
  id: string
  orderItemId: string
  modifierGroupId: string
  modifierOptionId: string
  modifierName: string
  priceCents: number
}

export interface OrderItemDto {
  id: string
  orderId: string
  menuItemId: string | null
  name: string
  unitPriceCents: number
  quantity: number
  notes: string
  station: MenuStation
  voided: boolean
  sentAt: string | null
  /** How many of this line have already been fired. The rest is still unsent. */
  firedQuantity: number
  modifiers?: OrderItemModifierDto[]
}

export interface OrderDto {
  id: string
  branchId: string
  type: OrderType
  status: OrderStatus
  progress: DiningProgress
  /** Floor state set by the pass. Null until the kitchen starts the ticket. */
  serviceStatus: ServiceStatus | null
  ticketNumber: number | null
  source: OrderSource
  tableId: string | null
  tableLabel: string | null
  serverId: string | null
  serverName: string | null
  guestName: string
  guestPhone: string
  guestCount: number
  deliveryAddress: string
  notes: string
  currency: string
  subtotalCents: number
  discountKind: DiscountKind
  discountValue: number
  discountCents: number
  discountLabel: string
  serviceChargeCents: number
  totalCents: number
  paidCents: number
  refundedCents: number
  balanceCents: number
  refundableCents: number
  mergedIntoId: string | null
  splitFromId: string | null
  items: OrderItemDto[]
  payments: PaymentDto[]
  refunds: RefundDto[]
  createdAt: string
  updatedAt: string
  closedAt: string | null
  /** Present when this check was charged to an account. */
  ar: ArSaleStamp | null
}

export interface ArSaleStamp {
  invoiceNumber: string
  accountName: string
  remainingCents: number
  dueOn: string
  termsLabel: string
  status: ArInvoiceStatus
}

/** One page of the orders board. Counts are the live branch snapshot, not the filtered page. */
export interface OrderListDto {
  orders: OrderDto[]
  page: number
  pageSize: number
  total: number
  timezone: string
  summary: {
    active: number
    readyToServe: number
    completedToday: number
  }
}

export interface TenderTotalDto {
  method: PaymentMethod
  paymentsCents: number
  paymentCount: number
  refundsCents: number
  refundCount: number
  netCents: number
}

export interface DailyReportDto {
  day: string
  today: string
  timezone: string
  currency: string
  transactionCount: number
  grossCents: number
  discountCents: number
  serviceChargeCents: number
  salesCents: number
  refundCents: number
  refundCount: number
  netCents: number
  tenders: TenderTotalDto[]
  /** New credit sales. Included in sales, excluded from the cash drawer. */
  arSalesCents: number
  /** Money collected against existing account balances. */
  arCollectionsCents: number
  /** Cash sales plus cash collected on account, minus cash refunds. */
  cashDrawerCents: number
}

export interface KitchenTicketItemDto {
  id: string
  name: string
  /** Still to cook. Zero when the whole firing of this line was cancelled. */
  quantity: number
  cancelledQuantity: number
  notes: string
  modifiers: Array<{ id: string; name: string }>
}

/**
 * One kitchen firing.
 * Later additions share the order's ticket number and carry only the new quantities.
 */
export interface KitchenTicketDto {
  id: string
  orderId: string
  ticketNumber: number
  sequence: number
  kind: KitchenSubmissionKind
  type: OrderType
  kitchenStatus: KitchenStatus
  tableLabel: string | null
  guestName: string
  serverName: string | null
  deliveryAddress: string
  notes: string
  startedAt: string
  items: KitchenTicketItemDto[]
}

/** Result of firing unsent quantities. Tickets contain only what was just sent. */
export interface SendOrderResultDto {
  order: OrderDto
  tickets: StationTicketDto[]
  sentCount: number
  replayed: boolean
}

export interface KitchenBoardDto {
  serverTime: string
  active: KitchenTicketDto[]
  completed: KitchenTicketDto[]
}

export interface StationTicketDto {
  station: MenuStation
  lines: string[]
}

export interface SyncResultDto {
  operationId: string
  status: 'accepted' | 'conflict'
  message?: string
}

export interface SyncPushSummaryDto {
  accepted: number
  conflicts: SyncResultDto[]
  serverTime: string
}

export interface SyncPullDto {
  serverTime: string
  branches: BranchDto[]
  profile: RestaurantProfileDto | null
  settings: BranchSettingsDto | null
  printers: PrinterDto[]
  floorPlans: FloorPlanDto[]
  menu: MenuCategoryDto[]
  /** True when `menu` is a full replacement, including an empty catalog. */
  menuUpdated: boolean
  orders: OrderDto[]
  reservations: ReservationDto[]
  deleted: Array<{ entity: string; entityId: string; deletedAt: string }>
}

export interface ArAccountDto {
  id: string
  branchId: string
  accountNumber: string
  customerName: string
  companyName: string
  contactPerson: string
  phone: string
  email: string
  address: string
  creditLimitCents: number | null
  enforceCreditLimit: boolean
  availableCents: number | null
  paymentTerms: ArTerms
  termDays: number
  termsLabel: string
  dueOnPreview: string
  status: ArAccountStatus
  notes: string
  balanceCents: number
  createdAt: string
  updatedAt: string
}

export interface ArAccountListDto {
  accounts: ArAccountDto[]
  page: number
  pageSize: number
  total: number
}

export interface ArInvoiceDto {
  id: string
  branchId: string
  accountId: string
  accountNumber: string
  companyName: string
  customerName: string
  orderId: string
  invoiceNumber: string
  cashierName: string | null
  originalCents: number
  paidCents: number
  refundedCents: number
  writtenOffCents: number
  remainingCents: number
  invoiceOn: string
  dueOn: string
  paymentTerms: ArTerms
  termDays: number
  termsLabel: string
  status: ArInvoiceStatus
  notes: string
  voidReason: string
  voidedAt: string | null
  createdAt: string
}

export interface ArInvoiceListDto {
  invoices: ArInvoiceDto[]
  page: number
  pageSize: number
  total: number
  today: string
  currency: string
}

export interface ArLedgerEntryDto {
  id: string
  kind: ArLedgerKind
  debitCents: number
  creditCents: number
  balanceCents: number
  reference: string
  description: string
  createdAt: string
}

export interface ArLedgerPageDto {
  entries: ArLedgerEntryDto[]
  page: number
  pageSize: number
  total: number
}

export interface ArAllocationDto {
  invoiceId: string
  invoiceNumber: string
  amountCents: number
}

export interface ArPaymentDto {
  id: string
  accountId: string
  companyName: string
  accountNumber: string
  method: PaymentMethod
  amountCents: number
  appliedCents: number
  unappliedCents: number
  refundedCents: number
  reference: string
  notes: string
  cashierName: string | null
  createdAt: string
  allocations: ArAllocationDto[]
}

export interface ArPaymentListDto {
  payments: ArPaymentDto[]
  page: number
  pageSize: number
  total: number
  currency: string
}

export interface ArAuditDto {
  id: string
  action: string
  message: string
  amountCents: number | null
  reason: string
  userName: string | null
  approverName: string | null
  createdAt: string
}

export interface ArSummaryDto {
  currency: string
  timezone: string
  today: string
  totalCents: number
  currentCents: number
  overdueCents: number
  overdueCount: number
  dueTodayCents: number
  dueTodayCount: number
  partiallyPaidCents: number
  partiallyPaidCount: number
  collectionTodayCents: number
  collectionMonthCents: number
  unappliedCents: number
}

export interface ArAccountDetailDto {
  account: ArAccountDto
  currency: string
  stats: {
    purchasesCents: number
    paymentsCents: number
    outstandingCents: number
    overdueCents: number
  }
  audits: ArAuditDto[]
}

export interface ArStatementDto {
  currency: string
  restaurantName: string
  branchName: string
  branchAddress: string
  account: ArAccountDto
  from: string
  to: string
  openingCents: number
  closingCents: number
  salesCents: number
  paymentsCents: number
  refundsCents: number
  writeOffCents: number
  entries: ArLedgerEntryDto[]
}
