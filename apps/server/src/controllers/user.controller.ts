import { userCreateSchema, userUpdateSchema } from '@towns/shared'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as users from '../services/user.service.js'

export const list = asyncHandler(async (req, res) => {
  ok(res, await users.listUsers(req.user!))
})

export const create = asyncHandler(async (req, res) => {
  ok(res, await users.createUser(req.user!, userCreateSchema.parse(req.body)), 201)
})

export const update = asyncHandler(async (req, res) => {
  ok(res, await users.updateUser(req.user!, req.params.id, userUpdateSchema.parse(req.body)))
})

export const remove = asyncHandler(async (req, res) => {
  ok(res, await users.deactivateUser(req.user!, req.params.id))
})
