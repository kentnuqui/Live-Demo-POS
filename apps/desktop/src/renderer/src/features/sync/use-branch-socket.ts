import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { io } from 'socket.io-client'
import { apiBase } from '@/lib/api'
import { useSession } from '@/stores/session-store'

/** Other terminals announce floor and check changes. This refetches only what moved. */
export function useBranchSocket(branchId: string | null): void {
  const token = useSession((state) => state.accessToken)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!branchId || !token) return
    const socket = io(apiBase, { auth: { token } })
    socket.emit('branch:join', branchId)
    const refreshFloor = () => void queryClient.invalidateQueries({ queryKey: ['floor', branchId] })
    const refreshOrders = () => void queryClient.invalidateQueries({ queryKey: ['orders', branchId] })
    socket.on('floor.updated', refreshFloor)
    socket.on('order.updated', (payload: { orderId?: string }) => {
      refreshFloor()
      refreshOrders()
      if (payload?.orderId) void queryClient.invalidateQueries({ queryKey: ['order', payload.orderId] })
    })
    socket.on('reservation.updated', () => {
      refreshFloor()
      void queryClient.invalidateQueries({ queryKey: ['reservations', branchId] })
    })
    socket.on('menu.updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['menu', branchId] })
      void queryClient.invalidateQueries({ queryKey: ['menu-manage', branchId] })
    })
    socket.on('settings.updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', branchId] })
      void queryClient.invalidateQueries({ queryKey: ['printers', branchId] })
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    })
    socket.on('sync.applied', () => {
      refreshFloor()
      refreshOrders()
    })
    return () => {
      socket.disconnect()
    }
  }, [branchId, queryClient, token])
}
