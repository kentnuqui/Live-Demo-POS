/** Expected failure that maps to an HTTP status and the shared error envelope. */
export class AppError extends Error {
  readonly statusCode: number
  readonly details?: unknown

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.details = details
  }
}

/** One operation inside a sync batch failed. The whole transaction rolls back. */
export class SyncOpError extends AppError {
  readonly operationId: string
  readonly server?: unknown

  constructor(operationId: string, message: string, server?: unknown) {
    super(409, message, { operationId, server })
    this.name = 'SyncOpError'
    this.operationId = operationId
  }
}
