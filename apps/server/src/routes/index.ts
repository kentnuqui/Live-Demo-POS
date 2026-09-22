import { Router } from 'express'
import { requireAnyPermission, requireAuth, requireBranch, requirePermission } from '../middleware/auth.js'
import * as auth from '../controllers/auth.controller.js'
import * as users from '../controllers/user.controller.js'
import * as branches from '../controllers/branch.controller.js'
import * as floor from '../controllers/floor.controller.js'
import * as menu from '../controllers/menu.controller.js'
import * as service from '../controllers/service.controller.js'
import * as orders from '../controllers/order.controller.js'
import * as sync from '../controllers/sync.controller.js'
import * as qr from '../controllers/qr.controller.js'
import * as reports from '../controllers/report.controller.js'

export const api = Router()

api.post('/auth/login', auth.login)
api.post('/auth/pin', auth.pin)
api.post('/auth/refresh', auth.refresh)
api.post('/auth/logout', auth.logout)

api.get('/qr/:token', qr.show)
api.post('/qr/:token/orders', qr.order)

api.use(requireAuth)
api.get('/auth/me', auth.me)

api.get('/users', requirePermission('users.manage'), users.list)
api.post('/users', requirePermission('users.manage'), users.create)
api.patch('/users/:id', requirePermission('users.manage'), users.update)
api.delete('/users/:id', requirePermission('users.manage'), users.remove)

api.get('/branches', branches.list)
api.post('/branches', requirePermission('branches.manage'), branches.create)
api.patch('/branches/:branchId', requirePermission('branches.manage'), requireBranch(), branches.update)

api.get('/profile', branches.profile)
api.put('/profile', requirePermission('settings.manage'), branches.saveProfile)

const branch = Router({ mergeParams: true })
branch.use(requireBranch())
branch.get('/settings', branches.branchSettings)
branch.put('/settings', requirePermission('settings.manage'), branches.saveBranchSettings)
branch.put('/receipt', requirePermission('settings.manage'), branches.saveReceipt)
branch.get('/printers', branches.printers)
branch.post('/printers', requirePermission('settings.manage'), branches.createPrinter)
branch.put('/printers/:printerId', requirePermission('settings.manage'), branches.updatePrinter)
branch.delete('/printers/:printerId', requirePermission('settings.manage'), branches.deletePrinter)
branch.get('/floor', requirePermission('orders.read'), floor.show)
branch.post('/tables', requirePermission('floor.edit'), floor.createTable)
branch.put('/layout', requirePermission('floor.edit'), floor.layout)
branch.patch('/tables/:tableId/status', requirePermission('floor.edit'), floor.status)
branch.delete('/tables/:tableId', requirePermission('floor.edit'), floor.removeTable)
branch.get('/menu', requirePermission('orders.read'), menu.catalog)
branch.get('/menu/manage', requirePermission('settings.manage'), menu.manage)
branch.post('/menu/categories', requirePermission('settings.manage'), menu.createCategory)
branch.put('/menu/categories/reorder', requirePermission('settings.manage'), menu.reorderCategories)
branch.patch('/menu/categories/:categoryId', requirePermission('settings.manage'), menu.updateCategory)
branch.delete('/menu/categories/:categoryId', requirePermission('settings.manage'), menu.removeCategory)
branch.post('/menu/items', requirePermission('settings.manage'), menu.createItem)
branch.put('/menu/items/reorder', requirePermission('settings.manage'), menu.reorderItems)
branch.patch('/menu/items/:itemId', requirePermission('settings.manage'), menu.updateItem)
branch.delete('/menu/items/:itemId', requirePermission('settings.manage'), menu.removeItem)
branch.put('/menu/items/:itemId/modifiers', requirePermission('settings.manage'), menu.assignModifiers)
branch.get('/modifiers', requirePermission('settings.manage'), menu.listModifierGroups)
branch.post('/modifiers', requirePermission('settings.manage'), menu.createModifierGroup)
branch.patch('/modifiers/:groupId', requirePermission('settings.manage'), menu.updateModifierGroup)
branch.delete('/modifiers/:groupId', requirePermission('settings.manage'), menu.removeModifierGroup)
branch.post('/modifier-options', requirePermission('settings.manage'), menu.createModifierOption)
branch.patch('/modifier-options/:optionId', requirePermission('settings.manage'), menu.updateModifierOption)
branch.delete('/modifier-options/:optionId', requirePermission('settings.manage'), menu.removeModifierOption)
branch.get('/reservations', requirePermission('orders.read'), service.listReservations)
branch.post('/reservations', requirePermission('reservations.write'), service.createReservation)
branch.post('/reservations/:reservationId/seat', requirePermission('reservations.write'), service.seatReservation)
branch.post('/reservations/:reservationId/cancel', requirePermission('reservations.write'), service.cancelReservation)
branch.get('/orders', requirePermission('orders.read'), orders.list)
branch.post('/orders', requirePermission('orders.write'), orders.create)
branch.get('/reports/daily', requirePermission('orders.bill'), reports.daily)

api.use('/branches/:branchId', branch)

api.get('/orders/:orderId', requirePermission('orders.read'), orders.show)
api.patch('/orders/:orderId', requirePermission('orders.write'), orders.patch)
api.post('/orders/:orderId/items', requirePermission('orders.write'), orders.addItems)
api.post('/orders/:orderId/items/:itemId/void', requirePermission('orders.write'), orders.voidItem)
api.post('/orders/:orderId/items/:itemId/quantity', requirePermission('orders.write'), orders.adjustItem)
api.post('/orders/:orderId/send', requirePermission('orders.write'), orders.send)
api.post('/orders/:orderId/progress', requireAnyPermission('orders.kitchen', 'orders.write'), orders.progress)
api.post('/orders/:orderId/transfer', requirePermission('orders.write'), orders.transfer)
api.post('/orders/:orderId/merge', requirePermission('orders.write'), orders.merge)
api.post('/orders/:orderId/split', requirePermission('orders.write'), orders.split)
api.post('/orders/:orderId/bill', requirePermission('orders.bill'), orders.bill)
api.post('/orders/:orderId/discount', requirePermission('orders.bill'), orders.discount)
api.post('/orders/:orderId/pay', requirePermission('orders.bill'), orders.pay)
api.post('/orders/:orderId/refund', requirePermission('orders.bill'), orders.refund)
api.post('/orders/:orderId/finish', requirePermission('orders.bill'), orders.finish)

api.post('/sync/push', requirePermission('orders.read'), sync.push)
api.get('/sync/pull', requirePermission('orders.read'), sync.pull)
