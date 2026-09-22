import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  theme: 'light' | 'dark'
  zen: boolean
  connection: 'online' | 'offline' | 'syncing'
  outbox: number
  toggleTheme: () => void
  toggleZen: () => void
  setConnection: (connection: UiState['connection'], outbox?: number) => void
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      zen: false,
      connection: 'online',
      outbox: 0,
      toggleTheme: () => {
        const theme = get().theme === 'light' ? 'dark' : 'light'
        document.documentElement.classList.toggle('dark', theme === 'dark')
        set({ theme })
      },
      toggleZen: () => set({ zen: !get().zen }),
      setConnection: (connection, outbox = get().outbox) => set({ connection, outbox })
    }),
    { name: 'towns-ui', partialize: (state) => ({ theme: state.theme, zen: state.zen }) }
  )
)

export function applyStoredTheme(): void {
  const theme = useUi.getState().theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
}
