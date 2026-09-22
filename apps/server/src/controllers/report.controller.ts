import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as reports from '../services/report.service.js'

export const daily = asyncHandler(async (req, res) => {
  const day = typeof req.query.day === 'string' ? req.query.day : undefined
  ok(res, await reports.dailyReport(req.params.branchId, day))
})
