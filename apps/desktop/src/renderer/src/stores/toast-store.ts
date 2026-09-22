import { create } from 'zustand'

interface Toast {
  id: string
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (message: string) => void
  dismiss: (id: string) => void
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (message) => {
    const id = crypto.randomUUID()
    set((state) => ({ toasts: [...state.toasts, { id, message }] }))
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
    }, 3200)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}))
