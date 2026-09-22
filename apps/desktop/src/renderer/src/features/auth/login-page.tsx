import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mark } from '@/components/mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, api } from '@/lib/api'
import { homePath } from '@/lib/nav'
import { useSession } from '@/stores/session-store'

export function LoginPage() {
  const navigate = useNavigate()
  const setSession = useSession((state) => state.setSession)
  const [email, setEmail] = useState('cashier@towns.test')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      const session = await api.login(email, password)
      setSession(session)
      navigate(homePath(session.user.role))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid h-full md:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground md:flex">
        <Mark />
        <p className="max-w-sm font-serif text-4xl leading-tight">A quiet floor. A check in a few taps.</p>
      </section>
      <section className="flex items-center justify-center p-8">
        <form onSubmit={(event) => void submit(event)} className="w-full max-w-sm space-y-5">
          <div className="md:hidden">
            <Mark />
          </div>
          <div>
            <h1 className="font-serif text-4xl">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">For the office. The floor uses a PIN.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            Continue
          </Button>
          <Link to="/pin" className="block text-center text-sm text-muted-foreground">
            Use a PIN instead
          </Link>
        </form>
      </section>
    </div>
  )
}
