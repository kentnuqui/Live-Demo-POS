import { loginSchema, pinSchema, refreshSchema } from '@towns/shared'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as auth from '../services/auth.service.js'

export const login = asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body)
  ok(res, await auth.login(body.email, body.password))
})

export const pin = asyncHandler(async (req, res) => {
  const body = pinSchema.parse(req.body)
  ok(res, await auth.loginWithPin(body.pin))
})

export const refresh = asyncHandler(async (req, res) => {
  const body = refreshSchema.parse(req.body)
  ok(res, await auth.refresh(body.refreshToken))
})

export const logout = asyncHandler(async (req, res) => {
  const body = refreshSchema.parse(req.body)
  await auth.logout(body.refreshToken)
  ok(res, { signedOut: true })
})

export const me = asyncHandler(async (req, res) => {
  ok(res, await auth.me(req.user!.id))
})
