import type { NextFunction, Request, Response } from 'express'
import { canAccessBranch, hasPermission, type Permission, type UserRole } from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { verifyAccessToken } from '../lib/tokens.js'

export interface AuthUser {
  id: string
  role: UserRole
  branchId: string | null
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    next(new AppError(401, 'Sign in required'))
    return
  }
  try {
    const claims = verifyAccessToken(header.slice(7))
    req.user = { id: claims.sub, role: claims.role, branchId: claims.branchId }
    next()
  } catch {
    next(new AppError(401, 'Sign in required'))
  }
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'Sign in required'))
      return
    }
    if (!hasPermission(req.user.role, permission)) {
      next(new AppError(403, 'You do not have access to this'))
      return
    }
    next()
  }
}

export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'Sign in required'))
      return
    }
    if (!permissions.some((permission) => hasPermission(req.user!.role, permission))) {
      next(new AppError(403, 'You do not have access to this'))
      return
    }
    next()
  }
}

export function requireBranch(param = 'branchId') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'Sign in required'))
      return
    }
    const branchId = req.params[param]
    if (!branchId || !canAccessBranch(req.user.role, req.user.branchId, branchId)) {
      next(new AppError(403, 'Outside your branch'))
      return
    }
    next()
  }
}
