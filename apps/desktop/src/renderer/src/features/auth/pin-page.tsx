import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Delete } from 'lucide-react'
import { Mark } from '@/components/mark'
import { ApiError, api, isNetworkError } from '@/lib/api'
import { rememberPin, unlockOffline } from '@/lib/offline-auth'
import { cn } from '@/lib/utils'
import { homePath } from '@/lib/nav'
import { useSession } from '@/stores/session-store'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

export function PinPage() {
  const navigate = useNavigate()
  const setSession = useSession((state) => state.setSession)
  const setOfflineUser = useSession((state) => state.setOfflineUser)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  async function submit(next: string) {
    setError('')
    try {
      const session = await api.pin(next)
      await rememberPin(next, session.user)
      setSession(session)
      navigate(homePath(session.user.role))
    } catch (caught) {
      if (isNetworkError(caught)) {
        const user = await unlockOffline(next)
        if (user) {
          setOfflineUser(user)
          navigate(homePath(user.role))
          return
        }
        setError('No saved PIN on this terminal')
      } else {
        setError(caught instanceof ApiError ? caught.message : 'PIN is incorrect')
      }
      setShake(true)
      setPin('')
      window.setTimeout(() => setShake(false), 400)
    }
  }

  function press(key: string) {
    if (key === 'del') {
      setPin((current) => current.slice(0, -1))
      return
    }
    if (!key) return
    const next = `${pin}${key}`.slice(0, 6)
    setPin(next)
    if (next.length >= 4) {
      window.setTimeout(() => {
        if (next.length === 4 || next.length === 6) void submit(next)
      }, 80)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
      <Mark />
      <div className={cn('flex gap-3', shake && 'animate-pulse')}>
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className={cn('h-3 w-3 rounded-full border', index < pin.length ? 'bg-primary' : 'bg-transparent')} />
        ))}
      </div>
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {KEYS.map((key) =>
          key === '' ? (
            <span key="spacer" />
          ) : (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              className="flex h-16 items-center justify-center rounded-2xl border bg-card text-2xl active:scale-[0.98]"
            >
              {key === 'del' ? <Delete className="h-5 w-5" /> : key}
            </button>
          )
        )}
      </div>
      {error ? <p className="text-sm text-accent">{error}</p> : <p className="text-sm text-muted-foreground">Four digits</p>}
      <Link to="/login" className="text-sm text-muted-foreground">
        Email sign in
      </Link>
    </div>
  )
}
