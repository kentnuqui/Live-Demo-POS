import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  AR_INVOICE_STATUSES,
  AR_INVOICE_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  type ArAccountDto,
  type ArInvoiceStatus,
  type ArLedgerEntryDto,
  type ArLedgerKind
} from '@towns/shared'
import { ChevronLeft } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Pager, dayLabel, invoiceStatusClass, money, stampLabel, useDebounced } from './ar-ui'
import { downloadStatement, printStatement } from './print-statement'

export type AccountRecordKind = 'invoices' | 'payments' | 'ledger' | 'statements' | 'audit'

export const ACCOUNT_RECORDS: ReadonlyArray<{ id: AccountRecordKind; label: string; hint: string }> = [
  { id: 'invoices', label: 'Invoices', hint: 'Credit sales and what is still owed' },
  { id: 'payments', label: 'Payments', hint: 'Money received on this account' },
  { id: 'ledger', label: 'Ledger', hint: 'Every charge and credit, with the running balance' },
  { id: 'statements', label: 'Statements', hint: 'Monthly or custom period statements' },
  { id: 'audit', label: 'Audit', hint: 'Who changed what, and when' }
]

const LEDGER_KIND_LABEL: Record<ArLedgerKind, string> = {
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  VOID: 'Void',
  WRITE_OFF: 'Write-off'
}

const PAGE_SIZE = 25
const FIELD = 'h-10 rounded-xl border bg-card px-3 text-sm'

interface RecordsProps {
  branchId: string
  account: ArAccountDto
  currency: string
  timeZone?: string
  today?: string
}

interface AccountRecordsDialogProps extends RecordsProps {
  kind: AccountRecordKind | null
  onClose: () => void
}

/** Detailed account records. Each view fetches only when it is opened. */
export function AccountRecordsDialog({ kind, onClose, ...props }: AccountRecordsDialogProps) {
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(720px,calc(100dvh-2rem))] w-[min(760px,calc(100%-1.5rem))] flex-col overflow-hidden p-0">
        {kind === 'invoices' ? <InvoiceRecords {...props} /> : null}
        {kind === 'payments' ? <PaymentRecords {...props} /> : null}
        {kind === 'ledger' ? <LedgerRecords {...props} /> : null}
        {kind === 'statements' ? <StatementRecords {...props} /> : null}
        {kind === 'audit' ? <AuditRecords {...props} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function Frame({
  title,
  account,
  toolbar,
  footer,
  children
}: {
  title: string
  account: ArAccountDto
  toolbar?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <div className="shrink-0 border-b px-5 pb-4 pt-5">
        <DialogTitle className="pr-8 leading-none">{title}</DialogTitle>
        <DialogDescription className="mt-2">
          {account.companyName} · {account.accountNumber}
        </DialogDescription>
        {toolbar ? <div className="mt-4 flex flex-wrap items-center gap-2">{toolbar}</div> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer ? <div className="shrink-0 border-t px-5">{footer}</div> : null}
    </>
  )
}

function Status({
  loading,
  failed,
  empty,
  loadingText,
  errorText,
  emptyText,
  onRetry,
  children
}: {
  loading: boolean
  failed: boolean
  empty: boolean
  loadingText: string
  errorText: string
  emptyText: string
  onRetry: () => void
  children: ReactNode
}) {
  if (loading) {
    return (
      <div aria-busy="true">
        <p className="text-sm text-muted-foreground">{loadingText}</p>
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-14 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }
  if (failed) {
    return (
      <div className="rounded-2xl border bg-card px-6 py-10 text-center">
        <p className="text-sm">{errorText}</p>
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  if (empty) {
    return (
      <div className="rounded-2xl border bg-card px-6 py-12 text-center">
        <p className="font-serif text-xl">{emptyText}</p>
      </div>
    )
  }
  return <>{children}</>
}

function Rows({ dim, children }: { dim?: boolean; children: ReactNode }) {
  return <div className={cn('overflow-hidden rounded-2xl border bg-card', dim && 'opacity-60')}>{children}</div>
}

function Pill({ className, children }: { className: string; children: string }) {
  return <span className={cn('rounded-full px-2.5 py-0.5 text-xs', className)}>{children}</span>
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      {label}
      <Input type="date" className="h-10 w-[10.5rem]" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function InvoiceRecords({ branchId, account, currency }: RecordsProps) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | ArInvoiceStatus>('')
  const [page, setPage] = useState(1)
  const search = useDebounced(q)
  const list = useQuery({
    queryKey: ['ar-account-invoices', branchId, account.id, search, status, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.arInvoices(branchId, {
        accountId: account.id,
        q: search || undefined,
        invoiceStatus: status || undefined,
        page,
        pageSize: PAGE_SIZE
      })
  })
  const invoices = list.data?.invoices ?? []
  const shownCurrency = list.data?.currency ?? currency
  return (
    <Frame
      title="Invoices"
      account={account}
      toolbar={
        <>
          <Input
            className="h-10 w-full sm:w-56"
            value={q}
            onChange={(event) => {
              setQ(event.target.value)
              setPage(1)
            }}
            placeholder="Search invoice #"
            aria-label="Search invoices"
          />
          <select
            className={FIELD}
            value={status}
            aria-label="Invoice status"
            onChange={(event) => {
              setStatus(event.target.value as '' | ArInvoiceStatus)
              setPage(1)
            }}
          >
            <option value="">All statuses</option>
            {AR_INVOICE_STATUSES.map((item) => (
              <option key={item} value={item}>
                {AR_INVOICE_STATUS_LABEL[item]}
              </option>
            ))}
          </select>
        </>
      }
      footer={list.data && list.data.total > 0 ? <Pager className="px-0" page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /> : null}
    >
      <Status
        loading={list.isLoading}
        failed={list.isError}
        empty={invoices.length === 0}
        loadingText="Loading invoices..."
        errorText="Unable to load invoices. Please try again."
        emptyText={search || status ? 'No invoices match these filters.' : 'No invoices found for this account.'}
        onRetry={() => void list.refetch()}
      >
        <Rows dim={list.isPlaceholderData}>
          {invoices.map((invoice) => (
            <div key={invoice.id} className="flex items-start gap-4 border-b px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{invoice.invoiceNumber}</span>
                  <Pill className={invoiceStatusClass(invoice.status)}>{AR_INVOICE_STATUS_LABEL[invoice.status]}</Pill>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Invoiced {dayLabel(invoice.invoiceOn)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-sm">{money(invoice.originalCents, shownCurrency)}</div>
                {invoice.remainingCents > 0 && invoice.remainingCents !== invoice.originalCents ? (
                  <div className="num mt-1 text-xs text-muted-foreground">{money(invoice.remainingCents, shownCurrency)} open</div>
                ) : null}
              </div>
            </div>
          ))}
        </Rows>
      </Status>
    </Frame>
  )
}

function PaymentRecords({ branchId, account, currency, timeZone }: RecordsProps) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const list = useQuery({
    queryKey: ['ar-account-payments', branchId, account.id, from, to, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.arPayments(branchId, {
        accountId: account.id,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: PAGE_SIZE
      })
  })
  const payments = list.data?.payments ?? []
  const shownCurrency = list.data?.currency ?? currency
  const filtering = !!from || !!to
  return (
    <Frame
      title="Payments"
      account={account}
      toolbar={
        <>
          <DateField label="From" value={from} onChange={(value) => { setFrom(value); setPage(1) }} />
          <DateField label="To" value={to} onChange={(value) => { setTo(value); setPage(1) }} />
          {filtering ? (
            <Button variant="ghost" className="h-10 px-3 text-muted-foreground" onClick={() => { setFrom(''); setTo(''); setPage(1) }}>
              Clear
            </Button>
          ) : null}
        </>
      }
      footer={list.data && list.data.total > 0 ? <Pager className="px-0" page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /> : null}
    >
      <Status
        loading={list.isLoading}
        failed={list.isError}
        empty={payments.length === 0}
        loadingText="Loading payment history..."
        errorText="Unable to load payments. Please try again."
        emptyText={filtering ? 'No payments in these dates.' : 'No payments recorded for this account.'}
        onRetry={() => void list.refetch()}
      >
        <Rows dim={list.isPlaceholderData}>
          {payments.map((payment) => (
            <div key={payment.id} className="flex items-start gap-4 border-b px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{payment.reference || 'Payment'}</span>
                  <Pill className="bg-muted text-muted-foreground">{PAYMENT_METHOD_LABEL[payment.method]}</Pill>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {stampLabel(payment.createdAt, timeZone)}
                  {payment.cashierName ? ` · ${payment.cashierName}` : ''}
                </p>
                {payment.allocations.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Applied to {payment.allocations.map((line) => line.invoiceNumber).join(', ')}
                  </p>
                ) : null}
                {payment.notes ? <p className="mt-1 text-xs text-muted-foreground">{payment.notes}</p> : null}
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-sm">{money(payment.amountCents, shownCurrency)}</div>
                {payment.unappliedCents > 0 ? (
                  <div className="num mt-1 text-xs text-muted-foreground">{money(payment.unappliedCents, shownCurrency)} unapplied</div>
                ) : null}
                {payment.refundedCents > 0 ? (
                  <div className="num mt-1 text-xs text-muted-foreground">{money(payment.refundedCents, shownCurrency)} refunded</div>
                ) : null}
              </div>
            </div>
          ))}
        </Rows>
      </Status>
    </Frame>
  )
}

function LedgerTable({ entries, currency, timeZone, dim }: { entries: ArLedgerEntryDto[]; currency: string; timeZone?: string; dim?: boolean }) {
  return (
    <div className={cn('overflow-x-auto rounded-2xl border bg-card', dim && 'opacity-60')}>
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Reference</th>
            <th className="px-4 py-2.5 text-right font-medium">Debit</th>
            <th className="px-4 py-2.5 text-right font-medium">Credit</th>
            <th className="px-4 py-2.5 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b align-top last:border-b-0">
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{stampLabel(entry.createdAt, timeZone)}</td>
              <td className="px-4 py-3">
                <div>{entry.reference}</div>
                <div className="text-xs text-muted-foreground">{entry.description || LEDGER_KIND_LABEL[entry.kind]}</div>
              </td>
              <td className="num px-4 py-3 text-right">{entry.debitCents ? money(entry.debitCents, currency) : ''}</td>
              <td className="num px-4 py-3 text-right">{entry.creditCents ? money(entry.creditCents, currency) : ''}</td>
              <td className="num px-4 py-3 text-right">{money(entry.balanceCents, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LedgerRecords({ branchId, account, currency, timeZone }: RecordsProps) {
  const [page, setPage] = useState(1)
  const ledger = useQuery({
    queryKey: ['ar-ledger', branchId, account.id, page],
    placeholderData: keepPreviousData,
    queryFn: () => api.arLedger(branchId, account.id, { page, pageSize: PAGE_SIZE })
  })
  const entries = ledger.data?.entries ?? []
  return (
    <Frame
      title="Account ledger"
      account={account}
      footer={ledger.data && ledger.data.total > 0 ? <Pager className="px-0" page={ledger.data.page} pageSize={ledger.data.pageSize} total={ledger.data.total} onPage={setPage} /> : null}
    >
      <Status
        loading={ledger.isLoading}
        failed={ledger.isError}
        empty={entries.length === 0}
        loadingText="Loading ledger..."
        errorText="Unable to load the ledger. Please try again."
        emptyText="No ledger activity found."
        onRetry={() => void ledger.refetch()}
      >
        <LedgerTable entries={entries} currency={currency} timeZone={timeZone} dim={ledger.isPlaceholderData} />
      </Status>
    </Frame>
  )
}

interface Period {
  key: string
  label: string
  from: string
  to: string
}

/** Month-to-date plus the previous months the account was open, in the branch calendar. */
function statementPeriods(today: string | undefined, openedOn: string): Period[] {
  if (!today) return []
  const [year, month] = today.split('-').map(Number)
  if (!year || !month) return []
  const monthName = (y: number, m: number) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
  const pad = (value: number) => String(value).padStart(2, '0')
  const periods: Period[] = [{ key: 'current', label: 'Current statement', from: `${year}-${pad(month)}-01`, to: today }]
  for (let back = 1; back <= 6; back += 1) {
    const start = new Date(Date.UTC(year, month - 1 - back, 1))
    const y = start.getUTCFullYear()
    const m = start.getUTCMonth() + 1
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const to = `${y}-${pad(m)}-${pad(lastDay)}`
    if (to < openedOn) break
    periods.push({ key: `${y}-${m}`, label: monthName(y, m), from: `${y}-${pad(m)}-01`, to })
  }
  return periods
}

function StatementRecords({ branchId, account, currency, timeZone, today }: RecordsProps) {
  const [period, setPeriod] = useState<Period | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const statement = useQuery({
    queryKey: ['ar-statement', branchId, account.id, period?.from, period?.to],
    enabled: !!period,
    queryFn: () => api.arStatement(branchId, account.id, period!.from, period!.to)
  })
  const periods = statementPeriods(today, account.createdAt.slice(0, 10))
  const customReady = !!from && !!to && from <= to

  if (!period) {
    return (
      <Frame title="Account statements" account={account}>
        {periods.length === 0 ? (
          <div className="rounded-2xl border bg-card px-6 py-12 text-center">
            <p className="font-serif text-xl">No statements available.</p>
          </div>
        ) : (
          <Rows>
            {periods.map((item) => (
              <div key={item.key} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div>{item.label}</div>
                  <div className="text-sm text-muted-foreground">
                    {dayLabel(item.from)} – {dayLabel(item.to)}
                  </div>
                </div>
                <Button variant="outline" className="h-10" onClick={() => setPeriod(item)}>
                  View
                </Button>
              </div>
            ))}
          </Rows>
        )}
        <div className="mt-5">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Custom period</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
            <Button className="h-10" disabled={!customReady} onClick={() => setPeriod({ key: 'custom', label: 'Custom statement', from, to })}>
              Generate
            </Button>
          </div>
        </div>
      </Frame>
    )
  }

  const data = statement.data
  return (
    <Frame
      title={period.label}
      account={account}
      toolbar={
        <>
          <Button variant="ghost" className="h-10 px-3" onClick={() => setPeriod(null)}>
            <ChevronLeft className="h-4 w-4" />
            All statements
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" className="h-10" disabled={!data} onClick={() => data && printStatement(data)}>
              Print
            </Button>
            <Button variant="outline" className="h-10" disabled={!data} onClick={() => data && downloadStatement(data)}>
              Download
            </Button>
          </div>
        </>
      }
    >
      <Status
        loading={statement.isLoading}
        failed={statement.isError}
        empty={false}
        loadingText="Generating statement..."
        errorText="Unable to load this statement. Please try again."
        emptyText=""
        onRetry={() => void statement.refetch()}
      >
        {data ? (
          <>
            <p className="text-sm text-muted-foreground">
              {dayLabel(data.from)} to {dayLabel(data.to)}
            </p>
            <dl className="mt-3 max-w-md">
              <Amount label="Opening balance" value={money(data.openingCents, data.currency)} />
              <Amount label="New sales" value={money(data.salesCents, data.currency)} />
              <Amount label="Payments" value={money(data.paymentsCents, data.currency)} />
              <Amount label="Credits" value={money(data.refundsCents, data.currency)} />
              <Amount label="Write-offs" value={money(data.writeOffCents, data.currency)} />
              <Amount label="Closing balance" value={money(data.closingCents, data.currency)} emphasis />
            </dl>
            <div className="mt-5">
              {data.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity in this period.</p>
              ) : (
                <LedgerTable entries={data.entries} currency={data.currency || currency} timeZone={timeZone} />
              )}
            </div>
          </>
        ) : null}
      </Status>
    </Frame>
  )
}

function Amount({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2.5 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={emphasis ? 'num font-serif text-xl' : 'num'}>{value}</dd>
    </div>
  )
}

/** Audit entries arrive with the account detail, so this reuses the panel's cached request. */
function AuditRecords({ branchId, account, currency, timeZone }: RecordsProps) {
  const detail = useQuery({
    queryKey: ['ar-account', branchId, account.id],
    queryFn: () => api.arAccount(branchId, account.id)
  })
  const audits = detail.data?.audits ?? []
  return (
    <Frame title="Account audit" account={account}>
      <Status
        loading={detail.isLoading}
        failed={detail.isError}
        empty={audits.length === 0}
        loadingText="Loading audit history..."
        errorText="Unable to load audit records. Please try again."
        emptyText="No audit records found."
        onRetry={() => void detail.refetch()}
      >
        <Rows>
          {audits.map((entry) => (
            <div key={entry.id} className="flex items-start gap-4 border-b px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{entry.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stampLabel(entry.createdAt, timeZone)}
                  {entry.userName ? ` · By ${entry.userName}` : ''}
                  {entry.approverName ? ` · Approved by ${entry.approverName}` : ''}
                </p>
                {entry.reason ? <p className="mt-1 text-xs text-muted-foreground">Reason: {entry.reason}</p> : null}
              </div>
              {entry.amountCents != null ? (
                <div className="num shrink-0 text-sm">{money(entry.amountCents, detail.data?.currency ?? currency)}</div>
              ) : null}
            </div>
          ))}
        </Rows>
      </Status>
    </Frame>
  )
}
