import {
  arAccountCreateSchema,
  arAccountUpdateSchema,
  arApplySchema,
  arListQuerySchema,
  arPaymentSchema,
  arStatementQuerySchema,
  arVoidSchema,
  arWriteOffSchema,
  hasPermission
} from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as accounts from '../services/ar-account.service.js'
import * as payments from '../services/ar-payment.service.js'
import * as reports from '../services/ar-report.service.js'
import * as sales from '../services/ar-sale.service.js'

function queryOf(req: { query: unknown }) {
  return arListQuerySchema.parse(req.query)
}

export const listAccounts = asyncHandler(async (req, res) => {
  ok(res, await accounts.listAccounts(req.params.branchId, queryOf(req)))
})

export const createAccount = asyncHandler(async (req, res) => {
  ok(res, await accounts.createAccount(req.user!, req.params.branchId, arAccountCreateSchema.parse(req.body)), 201)
})

export const showAccount = asyncHandler(async (req, res) => {
  ok(res, await accounts.getAccount(req.params.branchId, req.params.accountId))
})

export const updateAccount = asyncHandler(async (req, res) => {
  ok(res, await accounts.updateAccount(req.user!, req.params.branchId, req.params.accountId, arAccountUpdateSchema.parse(req.body)))
})

export const ledger = asyncHandler(async (req, res) => {
  ok(res, await accounts.accountLedger(req.params.branchId, req.params.accountId, queryOf(req)))
})

export const statement = asyncHandler(async (req, res) => {
  const query = arStatementQuerySchema.parse(req.query)
  ok(res, await accounts.accountStatement(req.params.branchId, req.params.accountId, query.from, query.to))
})

export const summary = asyncHandler(async (req, res) => {
  ok(res, await reports.arSummary(req.params.branchId))
})

export const listInvoices = asyncHandler(async (req, res) => {
  ok(res, await reports.listInvoices(req.params.branchId, queryOf(req)))
})

export const showInvoice = asyncHandler(async (req, res) => {
  ok(res, await reports.getInvoice(req.params.branchId, req.params.invoiceId))
})

export const voidInvoice = asyncHandler(async (req, res) => {
  const body = arVoidSchema.parse(req.body)
  ok(res, await sales.voidInvoice(req.user!, req.params.branchId, req.params.invoiceId, body.reason))
})

export const writeOff = asyncHandler(async (req, res) => {
  ok(res, await sales.writeOffInvoice(req.user!, req.params.branchId, req.params.invoiceId, arWriteOffSchema.parse(req.body)))
})

export const listPayments = asyncHandler(async (req, res) => {
  ok(res, await payments.listPayments(req.params.branchId, queryOf(req)))
})

export const createPayment = asyncHandler(async (req, res) => {
  ok(res, await payments.receivePayment(req.user!, req.params.branchId, arPaymentSchema.parse(req.body)), 201)
})

export const applyPayment = asyncHandler(async (req, res) => {
  ok(res, await payments.applyPayment(req.user!, req.params.branchId, req.params.paymentId, arApplySchema.parse(req.body)))
})

export const outstanding = asyncHandler(async (req, res) => {
  ok(res, await reports.outstandingReport(req.user!, req.params.branchId, queryOf(req)))
})

export const collections = asyncHandler(async (req, res) => {
  if (!req.user || !hasPermission(req.user.role, 'ar.reports')) throw new AppError(403, 'You do not have access to this')
  ok(res, await payments.listPayments(req.params.branchId, queryOf(req)))
})

export const creditSales = asyncHandler(async (req, res) => {
  if (!req.user || !hasPermission(req.user.role, 'ar.reports')) throw new AppError(403, 'You do not have access to this')
  ok(res, await reports.listInvoices(req.params.branchId, queryOf(req)))
})
