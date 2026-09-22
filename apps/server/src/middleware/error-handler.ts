import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../lib/app-error.js'
import { env } from '../config/env.js'

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      status: 'error',
      message: 'Invalid request',
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    })
    return
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      status: 'error',
      message: error.message,
      details: error.details ?? []
    })
    return
  }

  if (env.NODE_ENV !== 'production') {
    console.error(error)
  } else {
    console.error(error instanceof Error ? error.message : 'Unknown error')
  }

  res.status(500).json({
    status: 'error',
    message: 'Something went wrong',
    details: []
  })
}
