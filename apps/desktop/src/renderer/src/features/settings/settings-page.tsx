import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ROLE_LABEL, USER_ROLES, hasPermission, type PrinterKind, type ProfileInput, type UserRole } from '@towns/shared'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { canOpenPage, homePath } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { cached } from '@/features/sync/cache'
import { useSession } from '@/stores/session-store'
import { useToasts } from '@/stores/toast-store'

const SECTIONS = ['Profile', 'Tax', 'Receipt', 'Printers', 'Team', 'Branches'] as const
type Section = (typeof SECTIONS)[number]

export function SettingsPage() {
  const user = useSession((state) => state.user)
  const [section, setSection] = useState<Section>('Profile')
  if (!user || !hasPermission(user.role, 'settings.manage') || !canOpenPage(user.role, '/settings')) {
    return <Navigate to={homePath(user?.role)} replace />
  }

  return (
    <div className="grid h-full grid-cols-[200px_minmax(0,1fr)]">
      <aside className="border-r p-4">
        <h1 className="px-2 font-serif text-3xl">House</h1>
        <div className="mt-4 flex flex-col gap-1">
          {SECTIONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSection(item)}
              className={cn('rounded-xl px-3 py-3 text-left text-sm', section === item ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              {item}
            </button>
          ))}
        </div>
      </aside>
      <div className="overflow-auto p-8">
        {section === 'Profile' ? <ProfileSection /> : null}
        {section === 'Tax' ? <TaxSection /> : null}
        {section === 'Receipt' ? <ReceiptSection /> : null}
        {section === 'Printers' ? <PrinterSection /> : null}
        {section === 'Team' ? <TeamSection /> : null}
        {section === 'Branches' ? <BranchSection /> : null}
      </div>
    </div>
  )
}

function ProfileSection() {
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => cached('profile', api.profile) })
  const [form, setForm] = useState<ProfileInput | null>(null)
  const values: ProfileInput = form ?? {
    name: profile.data?.name ?? '',
    legalName: profile.data?.legalName ?? '',
    tagline: profile.data?.tagline ?? '',
    phone: profile.data?.phone ?? '',
    email: profile.data?.email ?? '',
    address: profile.data?.address ?? ''
  }
  const save = useMutation({
    mutationFn: () => api.saveProfile(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
      useToasts.getState().push('Profile saved')
    }
  })
  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <h2 className="font-serif text-4xl">Profile</h2>
      {(['name', 'legalName', 'tagline', 'phone', 'email', 'address'] as const).map((field) => (
        <div key={field} className="space-y-2">
          <Label>{field}</Label>
          <Input value={values[field] ?? ''} onChange={(event) => setForm({ ...values, [field]: event.target.value })} />
        </div>
      ))}
      <Button type="submit">Save</Button>
    </form>
  )
}

function TaxSection() {
  const branchId = useSession((state) => state.activeBranchId)!
  const settings = useQuery({ queryKey: ['settings', branchId], queryFn: () => cached(`settings:${branchId}`, () => api.settings(branchId)) })
  const data = settings.data
  if (!data) return <p className="text-sm text-muted-foreground">Loading charges</p>
  return <TaxForm key={data.currency + data.serviceChargeBps} data={data} branchId={branchId} />
}

function TaxForm({ data, branchId }: { data: { currency: string; serviceChargeBps: number; serviceChargeLabel: string }; branchId: string }) {
  const queryClient = useQueryClient()
  const [currency, setCurrency] = useState(data.currency)
  const [service, setService] = useState(String(data.serviceChargeBps / 100))
  const [label, setLabel] = useState(data.serviceChargeLabel)
  const save = useMutation({
    mutationFn: () =>
      api.saveSettings(branchId, {
        currency,
        serviceChargeBps: Math.round(Number(service) * 100),
        serviceChargeLabel: label
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', branchId] })
      useToasts.getState().push('Charges saved')
    }
  })
  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <h2 className="font-serif text-4xl">Charges</h2>
      <div className="space-y-2">
        <Label>Currency</Label>
        <Input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
      </div>
      <div className="space-y-2">
        <Label>Service charge percent</Label>
        <Input value={service} onChange={(event) => setService(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Service label</Label>
        <Input value={label} onChange={(event) => setLabel(event.target.value)} />
      </div>
      <Button type="submit">Save</Button>
    </form>
  )
}

function ReceiptSection() {
  const branchId = useSession((state) => state.activeBranchId)!
  const settings = useQuery({ queryKey: ['settings', branchId], queryFn: () => api.settings(branchId) })
  const [header, setHeader] = useState(settings.data?.receiptHeader ?? '')
  const [footer, setFooter] = useState(settings.data?.receiptFooter ?? '')
  const [showServer, setShowServer] = useState(settings.data?.showServerOnReceipt ?? true)
  const [showTable, setShowTable] = useState(settings.data?.showTableOnReceipt ?? true)
  const save = useMutation({
    mutationFn: () => api.saveReceipt(branchId, { receiptHeader: header, receiptFooter: footer, showServerOnReceipt: showServer, showTableOnReceipt: showTable }),
    onSuccess: () => useToasts.getState().push('Receipt saved')
  })
  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <h2 className="font-serif text-4xl">Receipt</h2>
      <div className="space-y-2">
        <Label>Header</Label>
        <Input value={header} onChange={(event) => setHeader(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Footer</Label>
        <Input value={footer} onChange={(event) => setFooter(event.target.value)} />
      </div>
      <div className="flex items-center justify-between">
        <Label>Show server</Label>
        <Switch checked={showServer} onCheckedChange={setShowServer} />
      </div>
      <div className="flex items-center justify-between">
        <Label>Show table</Label>
        <Switch checked={showTable} onCheckedChange={setShowTable} />
      </div>
      <Button type="submit">Save</Button>
    </form>
  )
}

function PrinterSection() {
  const branchId = useSession((state) => state.activeBranchId)!
  const queryClient = useQueryClient()
  const printers = useQuery({ queryKey: ['printers', branchId], queryFn: () => api.printers(branchId) })
  const [name, setName] = useState('Kitchen')
  const [kind, setKind] = useState<PrinterKind>('KITCHEN')
  const [address, setAddress] = useState('')
  const save = useMutation({
    mutationFn: () => api.createPrinter(branchId, { name, kind, connection: 'NETWORK', address, paperWidth: 80, isDefault: true, isActive: true }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['printers', branchId] })
  })
  return (
    <div className="max-w-xl space-y-4">
      <h2 className="font-serif text-4xl">Printers</h2>
      <p className="text-sm text-muted-foreground">Network printers use host:9100. A test sends a short ESC/POS ticket and can kick the drawer.</p>
      {(printers.data ?? []).map((printer) => (
        <div key={printer.id} className="flex items-center justify-between rounded-2xl border px-4 py-3">
          <div>
            <div>{printer.name}</div>
            <div className="text-sm text-muted-foreground">
              {printer.kind} · {printer.address || 'No address'}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!window.towns || !printer.address) {
                  useToasts.getState().push(printer.address ? 'Printing runs in the desktop app' : 'Add an address')
                  return
                }
                void window.towns.hardware.print(printer.address, ['Towns', printer.name, 'Test']).then((result) => {
                  useToasts.getState().push(result.ok ? 'Test sent' : result.message)
                })
              }}
            >
              Test
            </Button>
            {printer.kind === 'RECEIPT' ? (
              <Button
                variant="ghost"
                onClick={() => {
                  if (!window.towns || !printer.address) return
                  void window.towns.hardware.drawer(printer.address)
                }}
              >
                Drawer
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        <select className="h-12 rounded-xl border bg-card px-3" value={kind} onChange={(event) => setKind(event.target.value as PrinterKind)}>
          {(['RECEIPT', 'KITCHEN', 'SUSHI', 'BAR', 'DESSERT'] as const).map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <Input className="col-span-2" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="192.168.1.40:9100" />
        <Button type="submit">Add printer</Button>
      </form>
    </div>
  )
}

function TeamSection() {
  const actor = useSession((state) => state.user)
  const branchId = useSession((state) => state.activeBranchId)
  const queryClient = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: api.users })
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState<UserRole>('WAITER')
  const [pin, setPin] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const create = useMutation({
    mutationFn: () => api.createUser({ firstName, lastName, role, pin, email, password, branchId: role === 'ADMIN' || role === 'SUPER_ADMIN' ? null : branchId }),
    onSuccess: () => {
      setFirstName('')
      setLastName('')
      setPin('')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    }
  })
  const roles = USER_ROLES.filter((item) => actor && (actor.role === 'SUPER_ADMIN' || (actor.role === 'ADMIN' && item !== 'SUPER_ADMIN') || (actor.role === 'RESTAURANT_MANAGER' && !['SUPER_ADMIN', 'ADMIN', 'RESTAURANT_MANAGER'].includes(item))))
  return (
    <div className="max-w-3xl space-y-4">
      <h2 className="font-serif text-4xl">Team</h2>
      <div className="overflow-hidden rounded-2xl border">
        {(users.data ?? []).map((member) => (
          <div key={member.id} className="flex items-center justify-between border-b px-4 py-3 last:border-b-0">
            <div>
              <div>
                {member.firstName} {member.lastName}
              </div>
              <div className="text-sm text-muted-foreground">
                {ROLE_LABEL[member.role]} {member.email ? `· ${member.email}` : ''} {!member.isActive ? '· inactive' : ''}
              </div>
            </div>
            {member.isActive && member.id !== actor?.id ? (
              <Button variant="ghost" onClick={() => void api.deactivateUser(member.id).then(() => queryClient.invalidateQueries({ queryKey: ['users'] }))}>
                Deactivate
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <Input placeholder="First name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
        <Input placeholder="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} required />
        <select className="h-12 rounded-xl border bg-card px-3" value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
          {roles.map((item) => (
            <option key={item} value={item}>
              {ROLE_LABEL[item]}
            </option>
          ))}
        </select>
        <Input placeholder="PIN" value={pin} onChange={(event) => setPin(event.target.value)} />
        <Input placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <Input placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <Button type="submit" className="col-span-2">
          Add staff
        </Button>
      </form>
    </div>
  )
}

function BranchSection() {
  const user = useSession((state) => state.user)
  const queryClient = useQueryClient()
  const branches = useQuery({ queryKey: ['branches'], queryFn: api.branches })
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [city, setCity] = useState('')
  const canManage = !!user && hasPermission(user.role, 'branches.manage')
  const create = useMutation({
    mutationFn: () => api.createBranch({ name, code, city }),
    onSuccess: () => {
      setName('')
      setCode('')
      void queryClient.invalidateQueries({ queryKey: ['branches'] })
    }
  })
  return (
    <div className="max-w-xl space-y-4">
      <h2 className="font-serif text-4xl">Branches</h2>
      {(branches.data ?? []).map((branch) => (
        <div key={branch.id} className="rounded-2xl border px-4 py-3">
          <div className="font-serif text-2xl">{branch.name}</div>
          <div className="text-sm text-muted-foreground">{branch.city || 'No city'}</div>
        </div>
      ))}
      {canManage ? (
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <Input placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} required />
          <Input placeholder="Code" value={code} onChange={(event) => setCode(event.target.value)} required />
          <Input className="col-span-2" placeholder="City" value={city} onChange={(event) => setCity(event.target.value)} />
          <Button type="submit">Open branch</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Only an admin can open another branch.</p>
      )}
    </div>
  )
}
