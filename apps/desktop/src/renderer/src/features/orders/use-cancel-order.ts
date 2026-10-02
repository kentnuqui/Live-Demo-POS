import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CancelOrderInput, CancelOrderResultDto, OrderListDto, OrderListQuery } from '@towns/shared'
import { ApiError, api, isNetworkError } from '@/lib/api'
import { localDb } from '@/lib/local-db'

export const CANCEL_FAILED = 'Unable to cancel this order. No changes were made. Please try again.'
export const ALREADY_CANCELLED = 'This order has already been cancelled.'

/**
 * Cancels a check on the server, then updates this terminal from the confirmed result.
 * Nothing on screen changes before the server answers, so a failure never shows a false cancel.
 * Other terminals follow through the branch socket.
 */
export function useCancelOrder(branchId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: CancelOrderInput }) => api.cancelOrder(orderId, body),
    onSuccess: (result: CancelOrderResultDto) => {
      const { order } = result
      queryClient.setQueryData(['order', order.id], order)
      void localDb.kvSet(`order:${order.id}`, JSON.stringify(order)).catch(() => undefined)
      queryClient.setQueriesData<OrderListDto>(
        { queryKey: ['orders', branchId, 'board'], predicate: (query) => boardScope(query.queryKey) === 'active' },
        (data) => withoutOrder(data, order.id)
      )
      void queryClient.invalidateQueries({ queryKey: ['orders', branchId] })
      void queryClient.invalidateQueries({ queryKey: ['floor', branchId] })
    },
    onError: (_error, { orderId }) => {
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] })
    }
  })
}

/** What the cashier should read when a cancel is refused or lost. */
export function cancelFailure(error: unknown): { message: string; alreadyCancelled: boolean } {
  if (error instanceof ApiError && error.status === 409 && error.message === ALREADY_CANCELLED) {
    return { message: ALREADY_CANCELLED, alreadyCancelled: true }
  }
  if (isNetworkError(error) || !(error instanceof ApiError) || error.status >= 500 || error.message === 'Invalid request') {
    return { message: CANCEL_FAILED, alreadyCancelled: false }
  }
  return { message: error.message, alreadyCancelled: false }
}

function boardScope(key: readonly unknown[]): OrderListQuery['scope'] | null {
  const query = key[3]
  if (!query || typeof query !== 'object' || !('scope' in query)) return null
  return (query as Pick<OrderListQuery, 'scope'>).scope
}

function withoutOrder(data: OrderListDto | undefined, orderId: string): OrderListDto | undefined {
  if (!data || !data.orders.some((order) => order.id === orderId)) return data
  return {
    ...data,
    orders: data.orders.filter((order) => order.id !== orderId),
    total: Math.max(0, data.total - 1),
    summary: { ...data.summary, active: Math.max(0, data.summary.active - 1) }
  }
}
