import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { ApiError, api, isNetworkError } from '@/lib/api'
import { localDb } from '@/lib/local-db'
import { useSession } from '@/stores/session-store'
import { useToasts } from '@/stores/toast-store'
import { useUi } from '@/stores/ui-store'

/** Keeps the terminal cache warm and drains the offline outbox when the API answers. */
export function useSync(branchId: string | null): void {
  const queryClient = useQueryClient()
  const token = useSession((state) => state.accessToken)
  const offline = useSession((state) => state.offline)

  useEffect(() => {
    if (!branchId || !token || offline) return
    let stopped = false

    async function tick() {
      const entries = await localDb.outboxList()
      useUi.getState().setConnection(entries.length ? 'syncing' : 'online', entries.length)
      if (entries.length) {
        try {
          await api.push(
            entries.map((entry) => ({
              operationId: entry.id,
              kind: entry.kind,
              branchId: entry.branchId,
              payload: entry.payload
            }))
          )
          for (const entry of entries) await localDb.outboxRemove(entry.id)
        } catch (error) {
          if (isNetworkError(error)) {
            useUi.getState().setConnection('offline', entries.length)
            return
          }
          if (error instanceof ApiError && error.status === 409) {
            const details = error.details as { operationId?: string }
            if (details.operationId) {
              await localDb.outboxRemove(details.operationId)
              useToasts.getState().push(error.message)
            }
          }
        }
      }

      try {
        const since = (await localDb.kvGet(`lastSync:${branchId}`)) ?? undefined
        const data = await api.pull(branchId!, since ?? undefined)
        if (stopped) return
        if (data.floorPlans.length) {
          queryClient.setQueryData(['floor', branchId], data.floorPlans)
          await localDb.kvSet(`floor:${branchId}`, JSON.stringify(data.floorPlans))
        }
        if (data.menuUpdated || data.menu.length) {
          queryClient.setQueryData(['menu', branchId], data.menu)
          await localDb.kvSet(`menu:${branchId}`, JSON.stringify(data.menu))
          void queryClient.invalidateQueries({ queryKey: ['menu-manage', branchId] })
        }
        if (data.orders.length) {
          for (const order of data.orders) {
            queryClient.setQueryData(['order', order.id], order)
            await localDb.kvSet(`order:${order.id}`, JSON.stringify(order))
          }
          void queryClient.invalidateQueries({ queryKey: ['orders', branchId] })
        }
        if (data.reservations.length) void queryClient.invalidateQueries({ queryKey: ['reservations', branchId] })
        if (data.settings) {
          queryClient.setQueryData(['settings', branchId], data.settings)
          await localDb.kvSet(`settings:${branchId}`, JSON.stringify(data.settings))
        }
        await localDb.kvSet(`lastSync:${branchId}`, data.serverTime)
        const left = await localDb.outboxList()
        useUi.getState().setConnection('online', left.length)
      } catch (error) {
        if (isNetworkError(error)) useUi.getState().setConnection('offline', entries.length)
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), 12_000)
    const onOnline = () => void tick()
    window.addEventListener('online', onOnline)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [branchId, offline, queryClient, token])
}
