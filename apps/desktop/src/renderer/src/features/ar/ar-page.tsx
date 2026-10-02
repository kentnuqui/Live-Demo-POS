import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AR_ACCOUNT_STATUSES,
  AR_ACCOUNT_STATUS_LABEL,
  AR_INVOICE_STATUSES,
  AR_INVOICE_STATUS_LABEL,
  COLLECTION_METHODS,
  PAYMENT_METHOD_LABEL,
  hasPermission,
  parseMajorToMinor,
  type ArAccountDto,
  type ArInvoiceDto
} from '@towns/shared'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { canOpenPage, homePath } from '@/lib/nav'
import { useWide } from '@/lib/use-wide'
import { cn } from '@/lib/utils'
import { useSession } from '@/stores/session-store'
import { useToasts } from '@/stores/toast-store'
import { AccountDetailPanel } from './account-detail-panel'
import { AccountForm } from './account-form'
import { Empty, Pager, Stat, accountStatusClass, money, problem, useDebounced } from './ar-ui'

type Tab = 'overview' | 'accounts' | 'invoices' | 'collect' | 'reports'

/** Accounts receivable for the signed-in branch. */
export function ArPage() {
  const user = useSession((state) => state.user)
  const branchId = useSession((state) => state.activeBranchId)
  const wide = useWide()
  const [tab, setTab] = useState<Tab>('overview')
  const [selected, setSelected] = useState<ArAccountDto | null>(null)

  useEffect(() => {
    setSelected(null)
  }, [branchId])

  if (!user || !hasPermission(user.role, 'ar.view') || !canOpenPage(user.role, '/ar') || !branchId) {
    return <Navigate to={homePath(user?.role)} replace />
  }
  const chooseTab = (next: Tab) => {
    setTab(next)
    setSelected(null)
  }
  const showDetail = tab === 'accounts' && selected !== null
  const detailPanel = selected ? (
    <AccountDetailPanel
      key={selected.id}
      branchId={branchId}
      account={selected}
      canManage={hasPermission(user.role, 'ar.manage')}
      asDialog={!wide}
      onClose={wide ? () => setSelected(null) : undefined}
      className="h-full min-h-0"
    />
  ) : null
  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'accounts', label: 'Accounts', show: true },
    { id: 'invoices', label: 'Invoices', show: true },
    { id: 'collect', label: 'Collect', show: hasPermission(user.role, 'ar.collect') },
    { id: 'reports', label: 'Reports', show: hasPermission(user.role, 'ar.reports') }
  ]
  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto px-4 py-5 sm:px-6">
        <h1 className="font-serif text-4xl">Accounts</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.filter((item) => item.show).map((item) => (
            <Button key={item.id} variant={tab === item.id ? 'default' : 'outline'} onClick={() => chooseTab(item.id)}>
              {item.label}
            </Button>
          ))}
        </div>
        <div className="mt-6">
          {tab === 'overview' ? <Overview branchId={branchId} /> : null}
          {tab === 'accounts' ? (
            <Accounts
              branchId={branchId}
              canManage={hasPermission(user.role, 'ar.manage')}
              selectedId={selected?.id ?? null}
              onSelect={(account) => setSelected((current) => (current?.id === account.id ? null : account))}
            />
          ) : null}
          {tab === 'invoices' ? (
            <Invoices
              branchId={branchId}
              canVoid={hasPermission(user.role, 'ar.void')}
              canWriteOff={hasPermission(user.role, 'ar.writeoff')}
            />
          ) : null}
          {tab === 'collect' ? <Collect branchId={branchId} /> : null}
          {tab === 'reports' ? <Reports branchId={branchId} canExport={hasPermission(user.role, 'ar.export')} /> : null}
        </div>
      </div>

      {wide && showDetail ? (
        <aside className="flex w-[400px] shrink-0 flex-col border-l">{detailPanel}</aside>
      ) : wide ? null : (
        <Dialog open={showDetail} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="flex h-[min(720px,calc(100dvh-2rem))] w-[min(480px,calc(100%-1.5rem))] flex-col overflow-hidden p-0">
            {detailPanel}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function Overview({ branchId }: { branchId: string }) {
  const summary = useQuery({ queryKey: ['ar-summary', branchId], queryFn: () => api.arSummary(branchId) })
  if (summary.isLoading) return <p className="text-sm text-muted-foreground">Loading accounts...</p>
  if (summary.isError || !summary.data) return <p className="text-sm">{problem(summary.error, 'The accounts could not be loaded.')}</p>
  const data = summary.data
  const currency = data.currency
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Total AR" value={money(data.totalCents, currency)} detail="Outstanding invoices" />
      <Stat label="Current" value={money(data.currentCents, currency)} detail="Not yet overdue" />
      <Stat label="Partially paid" value={money(data.partiallyPaidCents, currency)} detail={`${data.partiallyPaidCount} invoices`} />
      <Stat label="Collected today" value={money(data.collectionTodayCents, currency)} />
      <Stat label="Collected this month" value={money(data.collectionMonthCents, currency)} />
      <Stat label="Unapplied credit" value={money(data.unappliedCents, currency)} detail="Received, not yet on an invoice" />
    </div>
  )
}

interface AccountsProps {
  branchId: string
  canManage: boolean
  selectedId: string | null
  onSelect: (account: ArAccountDto) => void
}

function Accounts({ branchId, canManage, selectedId, onSelect }: AccountsProps) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<ArAccountDto | 'new' | null>(null)
  const search = useDebounced(q)
  const summary = useQuery({ queryKey: ['ar-summary', branchId], queryFn: () => api.arSummary(branchId) })
  const currency = summary.data?.currency ?? 'USD'
  const list = useQuery({
    queryKey: ['ar-accounts', branchId, search, status, page],
    queryFn: () =>
      api.arAccounts(branchId, {
        q: search || undefined,
        status: status ? (status as ArAccountDto['status']) : undefined,
        page,
        pageSize: 25
      })
  })
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" value={q} onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="Search accounts" />
        <select className="h-12 rounded-xl border bg-card px-3" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          {AR_ACCOUNT_STATUSES.map((item) => (
            <option key={item} value={item}>{AR_ACCOUNT_STATUS_LABEL[item]}</option>
          ))}
        </select>
        {canManage ? (
          <Button className="ml-auto" onClick={() => setEditing('new')}>New account</Button>
        ) : null}
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
        {list.isLoading ? <p className="px-4 py-8 text-sm text-muted-foreground">Loading accounts...</p> : null}
        {list.isError ? <p className="px-4 py-8 text-sm">{problem(list.error, 'The accounts could not be loaded.')}</p> : null}
        {list.data && list.data.accounts.length === 0 ? <Empty>No AR accounts found.</Empty> : null}
        {list.data?.accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            aria-pressed={account.id === selectedId}
            onClick={() => onSelect(account)}
            className={cn(
              'flex w-full items-start gap-4 border-b px-4 py-4 text-left last:border-b-0 hover:bg-muted/60',
              account.id === selectedId && 'bg-muted/70'
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate">{account.companyName}</span>
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs', accountStatusClass(account.status))}>
                  {AR_ACCOUNT_STATUS_LABEL[account.status]}
                </span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{account.accountNumber} · {account.customerName}</div>
            </div>
            <div className="num shrink-0 text-right">{money(account.balanceCents, currency)}</div>
          </button>
        ))}
        {list.data ? <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /> : null}
      </div>
      <AccountForm
        key={editing === 'new' ? 'new' : editing?.id ?? 'closed'}
        open={editing !== null}
        account={editing === 'new' ? null : editing}
        currency={currency}
        branchId={branchId}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

function Invoices({ branchId, canVoid, canWriteOff }: { branchId: string; canVoid: boolean; canWriteOff: boolean }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<ArInvoiceDto | null>(null)
  const search = useDebounced(q)
  const list = useQuery({
    queryKey: ['ar-invoices', branchId, search, status, page],
    queryFn: () =>
      api.arInvoices(branchId, {
        q: search || undefined,
        invoiceStatus: status ? (status as ArInvoiceDto['status']) : undefined,
        page,
        pageSize: 25
      })
  })
  const currency = list.data?.currency ?? 'USD'
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" value={q} onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="Search invoices" />
        <select className="h-12 rounded-xl border bg-card px-3" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          {AR_INVOICE_STATUSES.map((item) => (
            <option key={item} value={item}>{AR_INVOICE_STATUS_LABEL[item]}</option>
          ))}
        </select>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border">
        {list.isLoading ? <p className="px-4 py-8 text-sm text-muted-foreground">Loading invoices...</p> : null}
        {list.isError ? <p className="px-4 py-8 text-sm">{problem(list.error, 'The invoices could not be loaded.')}</p> : null}
        {list.data && list.data.invoices.length === 0 ? <Empty>No invoices found.</Empty> : null}
        {list.data?.invoices.map((invoice) => (
          <div key={invoice.id} className="grid gap-2 border-b px-4 py-4 last:border-b-0 md:grid-cols-[1.2fr_0.8fr_0.8fr_auto] md:items-center">
            <div>
              <div>{invoice.invoiceNumber}</div>
              <div className="text-sm text-muted-foreground">{invoice.companyName}</div>
            </div>
            <div className="text-sm">
              <div>{AR_INVOICE_STATUS_LABEL[invoice.status]}</div>
              <div className="text-muted-foreground">Due {invoice.dueOn}</div>
            </div>
            <div className="num">{money(invoice.remainingCents, currency)}</div>
            {canVoid || canWriteOff ? (
              <Button variant="outline" onClick={() => setTarget(invoice)}>Adjust</Button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {list.data ? <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /> : null}
      </div>
      {target ? (
        <AdjustInvoice
          invoice={target}
          currency={currency}
          branchId={branchId}
          canVoid={canVoid}
          canWriteOff={canWriteOff}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </div>
  )
}

function Collect({ branchId }: { branchId: string }) {
  const client = useQueryClient()
  const [q, setQ] = useState('')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<(typeof COLLECTION_METHODS)[number]>('CASH')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [picked, setPicked] = useState<Record<string, string>>({})
  const search = useDebounced(q)
  const summary = useQuery({ queryKey: ['ar-summary', branchId], queryFn: () => api.arSummary(branchId) })
  const currency = summary.data?.currency ?? 'USD'
  const accounts = useQuery({
    queryKey: ['ar-pick', branchId, search],
    queryFn: () => api.arAccounts(branchId, { q: search || undefined, page: 1, pageSize: 8 })
  })
  const invoices = useQuery({
    queryKey: ['ar-open', branchId, accountId],
    enabled: !!accountId,
    queryFn: () => api.arInvoices(branchId, { accountId: accountId!, open: '1', page: 1, pageSize: 50 })
  })
  const pay = useMutation({
    mutationFn: () => {
      const amountCents = parseMajorToMinor(amount, currency)
      if (!accountId || amountCents == null || amountCents <= 0) throw new Error('Enter a payment amount.')
      const allocations = Object.entries(picked)
        .map(([invoiceId, text]) => ({ invoiceId, amountCents: parseMajorToMinor(text, currency) ?? 0 }))
        .filter((line) => line.amountCents > 0)
      return api.createArPayment(branchId, {
        id: crypto.randomUUID(),
        accountId,
        amountCents,
        method,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        allocations
      })
    },
    onSuccess: () => {
      setAmount('')
      setPicked({})
      setReference('')
      setNotes('')
      void client.invalidateQueries({ queryKey: ['ar-summary', branchId] })
      void client.invalidateQueries({ queryKey: ['ar-open', branchId] })
      void client.invalidateQueries({ queryKey: ['ar-invoices', branchId] })
      useToasts.getState().push('Payment recorded')
    },
    onError: (error) => useToasts.getState().push(problem(error, 'Unable to record this payment. No changes were made. Please try again.'))
  })
  const selected = accounts.data?.accounts.find((account) => account.id === accountId)
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div>
        <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search customer" />
        <div className="mt-3 space-y-2">
          {accounts.isLoading ? <p className="text-sm text-muted-foreground">Loading accounts...</p> : null}
          {accounts.data && accounts.data.accounts.length === 0 ? <Empty>No AR accounts found.</Empty> : null}
          {accounts.data?.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className={`w-full rounded-xl border px-3 py-3 text-left ${account.id === accountId ? 'border-foreground' : ''}`}
              onClick={() => { setAccountId(account.id); setPicked({}) }}
            >
              <div>{account.companyName}</div>
              <div className="text-sm text-muted-foreground">{money(account.balanceCents, currency)} owed</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {!selected ? <p className="text-sm text-muted-foreground">Choose an account to see what they owe.</p> : null}
        {selected ? (
          <>
            <h2 className="font-serif text-3xl">{selected.companyName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Outstanding {money(selected.balanceCents, currency)}</p>
            <div className="mt-4 overflow-hidden rounded-2xl border">
              {invoices.isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading invoices...</p> : null}
              {invoices.data && invoices.data.invoices.length === 0 ? <Empty>No outstanding invoices.</Empty> : null}
              {invoices.data?.invoices.map((invoice) => (
                <label key={invoice.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b px-4 py-3 last:border-b-0">
                  <span>
                    <span className="block">{invoice.invoiceNumber}</span>
                    <span className="text-sm text-muted-foreground">{money(invoice.remainingCents, currency)} open</span>
                  </span>
                  <Input
                    className="w-28"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={picked[invoice.id] ?? ''}
                    onChange={(event) => setPicked((current) => ({ ...current, [invoice.id]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Payment amount" inputMode="decimal" />
              <select className="h-12 rounded-xl border bg-card px-3" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
                {COLLECTION_METHODS.map((item) => (
                  <option key={item} value={item}>{PAYMENT_METHOD_LABEL[item]}</option>
                ))}
              </select>
              <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Reference, optional" maxLength={40} />
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes, optional" maxLength={200} />
            </div>
            <Button className="mt-4" size="lg" disabled={pay.isPending} onClick={() => pay.mutate()}>
              {pay.isPending ? 'Recording payment...' : 'Record payment'}
            </Button>
            <p className="mt-2 text-sm text-muted-foreground">Leave invoice amounts blank to keep the payment as unapplied credit.</p>
          </>
        ) : null}
      </div>
    </div>
  )
}

function Reports({ branchId, canExport }: { branchId: string; canExport: boolean }) {
  const [report, setReport] = useState<'outstanding' | 'collections' | 'sales'>('outstanding')
  const outstanding = useQuery({
    queryKey: ['ar-outstanding', branchId],
    queryFn: () => api.arOutstanding(branchId, { page: 1, pageSize: 100 }),
    enabled: report === 'outstanding'
  })
  const collections = useQuery({
    queryKey: ['ar-collections', branchId],
    queryFn: () => api.arCollections(branchId, { page: 1, pageSize: 100 }),
    enabled: report === 'collections'
  })
  const sales = useQuery({
    queryKey: ['ar-sales', branchId],
    queryFn: () => api.arSales(branchId, { page: 1, pageSize: 100 }),
    enabled: report === 'sales'
  })
  const currency = outstanding.data?.currency ?? collections.data?.currency ?? sales.data?.currency ?? 'USD'
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {(['outstanding', 'collections', 'sales'] as const).map((item) => (
          <Button key={item} variant={report === item ? 'default' : 'outline'} onClick={() => setReport(item)}>
            {item === 'outstanding' ? 'Outstanding' : item === 'collections' ? 'Collections' : 'Credit sales'}
          </Button>
        ))}
        {canExport ? (
          <Button
            className="ml-auto"
            variant="outline"
            onClick={() => downloadReport(report, currency, outstanding.data, collections.data, sales.data)}
          >
            Export
          </Button>
        ) : null}
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border">
        {report === 'outstanding' && outstanding.isLoading ? <p className="px-4 py-8 text-sm text-muted-foreground">Loading invoices...</p> : null}
        {report === 'outstanding' && outstanding.data?.invoices.length === 0 ? <Empty>No outstanding invoices.</Empty> : null}
        {report === 'outstanding' && outstanding.data?.invoices.map((invoice) => (
          <div key={invoice.id} className="grid gap-2 border-b px-4 py-3 text-sm last:border-b-0 md:grid-cols-4">
            <div>{invoice.companyName}</div>
            <div>{invoice.invoiceNumber}</div>
            <div>Due {invoice.dueOn}</div>
            <div className="num">{money(invoice.remainingCents, currency)}</div>
          </div>
        ))}
        {report === 'collections' && collections.data?.payments.length === 0 ? <Empty>No payments recorded.</Empty> : null}
        {report === 'collections' && collections.data?.payments.map((payment) => (
          <div key={payment.id} className="grid gap-2 border-b px-4 py-3 text-sm last:border-b-0 md:grid-cols-4">
            <div>{payment.companyName}</div>
            <div>{payment.reference}</div>
            <div>{PAYMENT_METHOD_LABEL[payment.method]}</div>
            <div className="num">{money(payment.amountCents, currency)}</div>
          </div>
        ))}
        {report === 'sales' && sales.data?.invoices.length === 0 ? <Empty>No credit sales in this list.</Empty> : null}
        {report === 'sales' && sales.data?.invoices.map((invoice) => (
          <div key={invoice.id} className="grid gap-2 border-b px-4 py-3 text-sm last:border-b-0 md:grid-cols-4">
            <div>{invoice.companyName}</div>
            <div>{invoice.invoiceNumber}</div>
            <div>{invoice.invoiceOn}</div>
            <div className="num">{money(invoice.originalCents, currency)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function downloadReport(
  report: string,
  currency: string,
  outstanding: Awaited<ReturnType<typeof api.arOutstanding>> | undefined,
  collections: Awaited<ReturnType<typeof api.arCollections>> | undefined,
  sales: Awaited<ReturnType<typeof api.arSales>> | undefined
) {
  const lines: string[] = []
  if (report === 'outstanding' && outstanding) {
    lines.push('Customer,Invoice,Due,Remaining')
    for (const row of outstanding.invoices) lines.push([row.companyName, row.invoiceNumber, row.dueOn, row.remainingCents].join(','))
  }
  if (report === 'collections' && collections) {
    lines.push('Customer,Reference,Method,Amount')
    for (const row of collections.payments) lines.push([row.companyName, row.reference, row.method, row.amountCents].join(','))
  }
  if (report === 'sales' && sales) {
    lines.push('Customer,Invoice,Date,Amount')
    for (const row of sales.invoices) lines.push([row.companyName, row.invoiceNumber, row.invoiceOn, row.originalCents].join(','))
  }
  if (!lines.length) return
  const blob = new Blob([[`Currency ${currency}`, ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ar-${report}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function AdjustInvoice({
  invoice,
  currency,
  branchId,
  canVoid,
  canWriteOff,
  onClose
}: {
  invoice: ArInvoiceDto
  currency: string
  branchId: string
  canVoid: boolean
  canWriteOff: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const run = useMutation({
    mutationFn: (kind: 'void' | 'writeoff') => {
      if (!reason.trim()) throw new Error('A reason is required.')
      if (kind === 'void') return api.voidArInvoice(branchId, invoice.id, { reason: reason.trim() })
      const amountCents = parseMajorToMinor(amount, currency)
      if (amountCents == null || amountCents <= 0) throw new Error('Enter the amount to write off.')
      return api.writeOffArInvoice(branchId, invoice.id, { id: crypto.randomUUID(), amountCents, reason: reason.trim() })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ar-invoices', branchId] })
      void client.invalidateQueries({ queryKey: ['ar-summary', branchId] })
      onClose()
      useToasts.getState().push('Invoice updated')
    },
    onError: (error) => useToasts.getState().push(problem(error, 'Unable to update this invoice. No changes were made.'))
  })
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>{invoice.invoiceNumber}</DialogTitle>
        <DialogDescription>{money(invoice.remainingCents, currency)} still open.</DialogDescription>
        <Input className="mt-4" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" />
        {canWriteOff ? (
          <Input className="mt-3" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Write-off amount" inputMode="decimal" />
        ) : null}
        <div className="mt-4 grid gap-2">
          {canVoid ? (
            <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate('void')}>
              {run.isPending ? 'Working...' : 'Void open balance'}
            </Button>
          ) : null}
          {canWriteOff ? (
            <Button disabled={run.isPending} onClick={() => run.mutate('writeoff')}>
              Write off
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
