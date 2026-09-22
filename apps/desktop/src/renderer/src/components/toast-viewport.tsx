import { useToasts } from '@/stores/toast-store'

export function ToastViewport() {
  const toasts = useToasts((state) => state.toasts)
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="rounded-full border bg-card px-4 py-2 text-sm shadow-lg rise">
          {toast.message}
        </div>
      ))}
    </div>
  )
}
