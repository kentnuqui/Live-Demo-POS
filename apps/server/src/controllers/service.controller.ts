import { reservationSchema, seatSchema } from '@towns/shared'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as reservations from '../services/reservation.service.js'

export const listReservations = asyncHandler(async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined
  const to = typeof req.query.to === 'string' ? req.query.to : undefined
  ok(res, await reservations.listReservations(req.params.branchId, from, to))
})

export const createReservation = asyncHandler(async (req, res) => {
  ok(res, await reservations.createReservation(req.params.branchId, reservationSchema.parse(req.body)), 201)
})

export const seatReservation = asyncHandler(async (req, res) => {
  ok(res, await reservations.seatReservation(req.user!, req.params.branchId, req.params.reservationId, seatSchema.parse(req.body)))
})

export const cancelReservation = asyncHandler(async (req, res) => {
  ok(res, await reservations.cancelReservation(req.params.branchId, req.params.reservationId))
})
