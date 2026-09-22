import { z } from 'zod'
import {
  DISCOUNT_KINDS,
  ORDER_STATUSES,
  ORDER_TYPES,
  PAYMENT_METHODS,
  MENU_STATIONS,
  PRINTER_CONNECTIONS,
  PRINTER_KINDS,
  RESERVATION_TYPES,
  TABLE_SHAPES,
  TABLE_ZONES,
  USER_ROLES
} from './enums.js'

const uuid = z.string().uuid()

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
})

export const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits')
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(20)
})

export const userCreateSchema = z.object({
  email: z.string().email().optional().or(z.literal('')),
  password: z.string().min(8).max(128).optional().or(z.literal('')),
  pin: z.string().regex(/^\d{4,6}$/).optional().or(z.literal('')),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  role: z.enum(USER_ROLES),
  branchId: uuid.nullable().optional()
})

export const userUpdateSchema = userCreateSchema.partial().extend({
  isActive: z.boolean().optional()
})

export const branchSchema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().min(2).max(12).regex(/^[A-Za-z0-9-]+$/),
  address: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  timezone: z.string().min(1).max(64).optional(),
  isActive: z.boolean().optional()
})

export const profileSchema = z.object({
  name: z.string().min(1).max(80),
  legalName: z.string().max(120).optional(),
  tagline: z.string().max(160).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(200).optional()
})

export const branchSettingsSchema = z.object({
  currency: z.string().length(3),
  serviceChargeBps: z.number().int().min(0).max(3000),
  serviceChargeLabel: z.string().min(1).max(40)
})

export const receiptSchema = z.object({
  receiptHeader: z.string().max(240),
  receiptFooter: z.string().max(240),
  showServerOnReceipt: z.boolean(),
  showTableOnReceipt: z.boolean()
})

export const printerSchema = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(PRINTER_KINDS),
  connection: z.enum(PRINTER_CONNECTIONS),
  address: z.string().max(120).optional(),
  paperWidth: z.number().int().refine((value) => value === 58 || value === 80),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional()
})

export const tableSchema = z.object({
  id: uuid.optional(),
  label: z.string().min(1).max(24),
  zone: z.enum(TABLE_ZONES),
  shape: z.enum(TABLE_SHAPES),
  seats: z.number().int().min(1).max(30),
  posX: z.number().min(0).max(100).optional(),
  posY: z.number().min(0).max(100).optional(),
  width: z.number().min(6).max(60).optional(),
  height: z.number().min(6).max(60).optional()
})

export const layoutSchema = z.object({
  tables: z.array(
    z.object({
      id: uuid,
      posX: z.number().min(0).max(100),
      posY: z.number().min(0).max(100),
      width: z.number().min(6).max(60),
      height: z.number().min(6).max(60)
    })
  )
})

export const tableStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'CLEANING'])
})

export const reservationSchema = z.object({
  id: uuid.optional(),
  tableId: uuid.nullable().optional(),
  type: z.enum(RESERVATION_TYPES),
  guestName: z.string().min(1).max(80),
  guestPhone: z.string().max(40).optional(),
  guestCount: z.number().int().min(1).max(30),
  reservedAt: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(360).optional(),
  depositAmountCents: z.number().int().min(0).optional(),
  depositPaid: z.boolean().optional(),
  notes: z.string().max(400).optional()
})

export const orderCreateSchema = z.object({
  id: uuid.optional(),
  type: z.enum(ORDER_TYPES),
  tableId: uuid.optional(),
  guestCount: z.number().int().min(1).max(30).optional(),
  guestName: z.string().max(80).optional(),
  guestPhone: z.string().max(40).optional(),
  deliveryAddress: z.string().max(200).optional(),
  notes: z.string().max(400).optional(),
  source: z.enum(['POS', 'QR', 'ONLINE']).optional()
})

export const orderPatchSchema = z.object({
  guestCount: z.number().int().min(1).max(30).optional(),
  guestName: z.string().max(80).optional(),
  guestPhone: z.string().max(40).optional(),
  deliveryAddress: z.string().max(200).optional(),
  notes: z.string().max(400).optional(),
  type: z.enum(['DINE_IN', 'TAKEOUT']).optional(),
  tableId: uuid.nullable().optional()
})

export const addItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: uuid.optional(),
        menuItemId: uuid,
        quantity: z.number().int().min(1).max(99),
        notes: z.string().max(160).optional(),
        modifiers: z
          .array(
            z.object({
              modifierGroupId: uuid,
              modifierOptionId: uuid
            })
          )
          .optional()
      })
    )
    .min(1)
})

export const transferSchema = z.object({
  tableId: uuid
})

export const mergeSchema = z.object({
  sourceOrderId: uuid
})

export const splitSchema = z.object({
  itemIds: z.array(uuid).min(1),
  tableId: uuid.optional(),
  newOrderId: uuid.optional()
})

export const progressSchema = z.object({
  status: z.enum(ORDER_STATUSES).refine((status) => ['PREPARING', 'READY', 'SERVED'].includes(status))
})

export const discountSchema = z
  .object({
    kind: z.enum(DISCOUNT_KINDS),
    value: z.number().int().min(0).max(100_000_000).default(0),
    label: z.string().max(40).optional()
  })
  .superRefine((input, ctx) => {
    if (input.kind === 'PERCENT' && input.value > 10_000) {
      ctx.addIssue({ code: 'custom', message: 'Discount cannot exceed 100%', path: ['value'] })
    }
    if (input.kind !== 'NONE' && input.value <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Enter a discount', path: ['value'] })
    }
  })

export const paymentSchema = z.object({
  id: uuid,
  method: z.enum(PAYMENT_METHODS),
  amountCents: z.number().int().min(0).max(100_000_000).optional(),
  tenderedCents: z.number().int().min(0).max(100_000_000).optional(),
  note: z.string().max(40).optional()
})

export const refundSchema = z.object({
  id: uuid,
  method: z.enum(PAYMENT_METHODS),
  amountCents: z.number().int().min(1).max(100_000_000),
  reason: z.string().min(1).max(80)
})

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(60, 'Category name must be 60 characters or fewer'),
  description: z.string().trim().max(240, 'Description must be 240 characters or fewer').optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional()
})

export const categoryUpdateSchema = categoryCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Nothing to change'
})

export const categoryReorderSchema = z.object({
  ids: z.array(uuid).min(1, 'Include every category in the new order')
})

export const menuItemCreateSchema = z.object({
  categoryId: uuid,
  name: z.string().trim().min(1, 'Item name is required').max(80, 'Item name must be 80 characters or fewer'),
  description: z.string().trim().max(240, 'Description must be 240 characters or fewer').optional(),
  priceCents: z.number().int().min(0, 'Price cannot be negative').max(10_000_000, 'Price is too large'),
  station: z.enum(MENU_STATIONS),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional()
})

export const menuItemUpdateSchema = menuItemCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to change' })

export const menuItemReorderSchema = z.object({
  categoryId: uuid,
  ids: z.array(uuid).min(1, 'Include every item in the new order')
})

export const modifierGroupCreateSchema = z.object({
  name: z.string().trim().min(1, 'Modifier group name is required').max(60, 'Modifier group name must be 60 characters or fewer'),
  description: z.string().trim().max(240, 'Description must be 240 characters or fewer').optional(),
  isRequired: z.boolean().optional(),
  minSelections: z.number().int().min(0).max(20).optional(),
  maxSelections: z.number().int().min(1).max(20).optional(),
  isMultipleSelect: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional()
})

export const modifierGroupUpdateSchema = modifierGroupCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Nothing to change'
})

export const modifierOptionCreateSchema = z.object({
  modifierGroupId: uuid,
  name: z.string().trim().min(1, 'Modifier option name is required').max(60, 'Modifier option name must be 60 characters or fewer'),
  description: z.string().trim().max(240, 'Description must be 240 characters or fewer').optional(),
  priceCents: z.number().int().min(-1_000_000, 'Price cannot be too negative').max(10_000_000, 'Price is too large').optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional()
})

export const modifierOptionUpdateSchema = modifierOptionCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Nothing to change'
})

export const menuItemModifierAssignSchema = z.object({
  modifierGroupIds: z.array(uuid)
})

export const dailyReportQuerySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

export const seatSchema = z.object({
  tableId: uuid.optional()
})

export const qrOrderSchema = z.object({
  guestName: z.string().max(80).optional(),
  items: z
    .array(
      z.object({
        menuItemId: uuid,
        quantity: z.number().int().min(1).max(20),
        notes: z.string().max(160).optional()
      })
    )
    .min(1)
})

export const syncOperationSchema = z.object({
  operationId: uuid,
  kind: z.enum([
    'order.create',
    'order.addItems',
    'order.send',
    'order.transfer',
    'order.merge',
    'order.split',
    'order.bill',
    'order.discount',
    'order.pay',
    'order.refund',
    'order.finish',
    'order.progress',
    'order.patch',
    'order.voidItem',
    'table.layout',
    'table.create',
    'table.status',
    'reservation.create'
  ]),
  branchId: uuid,
  payload: z.record(z.unknown())
})

export const syncPushSchema = z.object({
  operations: z.array(syncOperationSchema).min(1).max(100)
})

export type LoginInput = z.infer<typeof loginSchema>
export type PinInput = z.infer<typeof pinSchema>
export type UserCreateInput = z.infer<typeof userCreateSchema>
export type UserUpdateInput = z.infer<typeof userUpdateSchema>
export type BranchInput = z.infer<typeof branchSchema>
export type ProfileInput = z.infer<typeof profileSchema>
export type BranchSettingsInput = z.infer<typeof branchSettingsSchema>
export type ReceiptInput = z.infer<typeof receiptSchema>
export type PrinterInput = z.infer<typeof printerSchema>
export type TableInput = z.infer<typeof tableSchema>
export type LayoutInput = z.infer<typeof layoutSchema>
export type ReservationInput = z.infer<typeof reservationSchema>
export type OrderCreateInput = z.infer<typeof orderCreateSchema>
export type OrderPatchInput = z.infer<typeof orderPatchSchema>
export type AddItemsInput = z.infer<typeof addItemsSchema>
export type SplitInput = z.infer<typeof splitSchema>
export type DiscountInput = z.infer<typeof discountSchema>
export type PaymentInput = z.infer<typeof paymentSchema>
export type RefundInput = z.infer<typeof refundSchema>
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type MenuItemCreateInput = z.infer<typeof menuItemCreateSchema>
export type MenuItemUpdateInput = z.infer<typeof menuItemUpdateSchema>
export type ModifierGroupCreateInput = z.infer<typeof modifierGroupCreateSchema>
export type ModifierGroupUpdateInput = z.infer<typeof modifierGroupUpdateSchema>
export type ModifierOptionCreateInput = z.infer<typeof modifierOptionCreateSchema>
export type ModifierOptionUpdateInput = z.infer<typeof modifierOptionUpdateSchema>
export type MenuItemModifierAssignInput = z.infer<typeof menuItemModifierAssignSchema>
export type SeatInput = z.infer<typeof seatSchema>
export type QrOrderInput = z.infer<typeof qrOrderSchema>
export type SyncOperationInput = z.infer<typeof syncOperationSchema>
export type SyncPushInput = z.infer<typeof syncPushSchema>
