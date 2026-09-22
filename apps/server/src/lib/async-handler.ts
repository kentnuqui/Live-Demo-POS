import type { NextFunction, Request, Response } from 'express'

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<void>

/** Sends rejections to the central error middleware instead of repeating try/catch. */
export function asyncHandler(fn: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}
