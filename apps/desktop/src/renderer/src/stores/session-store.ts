import type { AuthSessionDto, UserDto } from '@towns/shared'
import { create } from 'zustand'
import { localDb } from '@/lib/local-db'

interface SessionState {
  hydrated: boolean
  accessToken: string | null
  refreshToken: string | null
  user: UserDto | null
  activeBranchId: string | null
  offline: boolean
  setSession: (session: AuthSessionDto) => void
  setBranch: (branchId: string) => void
  setOfflineUser: (user: UserDto) => void
  markHydrated: () => void
  signOut: () => void
}

export const useSession = create<SessionState>((set, get) => ({
  hydrated: false,
  accessToken: null,
  refreshToken: null,
  user: null,
  activeBranchId: null,
  offline: false,
  setSession: (session) => {
    const branchId = session.user.branchId ?? get().activeBranchId
    set({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: session.user,
      activeBranchId: branchId,
      offline: false
    })
    void localDb.kvSet('refreshToken', session.refreshToken)
    if (branchId) void localDb.kvSet('activeBranchId', branchId)
  },
  setBranch: (branchId) => {
    set({ activeBranchId: branchId })
    void localDb.kvSet('activeBranchId', branchId)
  },
  setOfflineUser: (user) => {
    set({
      user,
      offline: true,
      accessToken: null,
      activeBranchId: user.branchId ?? get().activeBranchId
    })
  },
  markHydrated: () => set({ hydrated: true }),
  signOut: () => {
    set({ accessToken: null, refreshToken: null, user: null, offline: false })
    void localDb.kvSet('refreshToken', '')
  }
}))

export async function loadStoredSession(): Promise<{ refreshToken: string | null; activeBranchId: string | null }> {
  const [refreshToken, activeBranchId] = await Promise.all([
    localDb.kvGet('refreshToken'),
    localDb.kvGet('activeBranchId')
  ])
  return {
    refreshToken: refreshToken || null,
    activeBranchId: activeBranchId || null
  }
}
