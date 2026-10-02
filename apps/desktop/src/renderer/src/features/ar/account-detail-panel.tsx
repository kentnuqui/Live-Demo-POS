import { useQuery } from '@tanstack/react-query'
import { AR_ACCOUNT_STATUS_LABEL, type ArAccountDto } from '@towns/shared'
import { ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AccountForm } from './account-form'
import { ACCOUNT_RECORDS, AccountRecordsDialog, type AccountRecordKind } from './account-records'
import { accountStatusClass, money } from './ar-ui'

interface AccountDetailPanelProps {
  branchId: string
  /** The list row, shown at once while the full detail loads. */
  account: ArAccountDto
  canManage: boolean
  asDialog?: boolean
  className?: string
  onClose?: () => void
}

/** Account summary and actions. Detailed records open in their own dialog. */
export function AccountDetailPanel({ branchId, account: listed, canManage, asDialog, className, onClose }: AccountDetailPanelProps) {
  const [records, setRecords] = useState<AccountRecordKind | null>(null)
  const [editing, setEditing] = useState(false)
  const summary = useQuery({ queryKey: ['ar-summary', branchId], queryFn: () => api.arSummary(branchId) })
  const detail = useQuery({
    queryKey: ['ar-account', branchId, listed.id],
    queryFn: () => api.arAccount(branchId, listed.id)
  })

  const account = detail.data?.account ?? listed
  const currency = detail.data?.currency ?? summary.data?.currency ?? 'USD'
  const Heading = asDialog ? DialogTitle : 'h2'
  const contact = [
    ['Contact', account.contactPerson],
    ['Phone', account.phone],
    ['Email', account.email],
    ['Address', account.address]
  ].filter((pair): pair is [string, string] => pair[1].trim().length > 0)

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className={cn('flex items-start justify-between gap-3', asDialog && 'pr-8')}>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Account details</p>
            <Heading className="mt-2 break-words font-serif text-3xl leading-none">{account.companyName}</Heading>
            <p className="mt-2 text-sm text-muted-foreground">
              {account.accountNumber}
              {account.customerName && account.customerName !== account.companyName ? ` · ${account.customerName}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-1 text-xs', accountStatusClass(account.status))}>
              {AR_ACCOUNT_STATUS_LABEL[account.status]}
            </span>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Hide account"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border bg-card px-4 py-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Outstanding balance</p>
          <p className="num mt-2 font-serif text-4xl leading-none">{money(account.balanceCents, currency)}</p>
        </div>

        <dl className="mt-5 space-y-3 text-sm">
          <Fact label="Credit limit" value={account.creditLimitCents == null ? 'Not set' : money(account.creditLimitCents, currency)} />
          <Fact label="Available credit" value={account.availableCents == null ? 'No limit' : money(account.availableCents, currency)} />
        </dl>

        {detail.isError ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 text-sm">
            <span className="text-muted-foreground">Some details could not be loaded.</span>
            <Button variant="ghost" className="h-9 px-3" onClick={() => void detail.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}

        <div className="mt-5 border-t pt-4">
          {contact.length === 0 ? <p className="text-sm text-muted-foreground">No contact details.</p> : null}
          <dl className="space-y-3 text-sm">
            {contact.map(([label, value]) => (
              <Fact key={label} label={label} value={value} />
            ))}
          </dl>
          {account.notes.trim() ? <p className="mt-4 text-sm text-muted-foreground">Note: {account.notes.trim()}</p> : null}
        </div>

        <div className="mt-5 border-t pt-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Account actions</p>
          <div className="mt-3 overflow-hidden rounded-2xl border bg-card">
            {ACCOUNT_RECORDS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setRecords(item.id)}
                className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.hint}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {canManage ? (
        <div className="shrink-0 border-t p-4">
          <Button className="w-full" onClick={() => setEditing(true)}>
            Edit account
          </Button>
        </div>
      ) : null}

      <AccountRecordsDialog
        kind={records}
        branchId={branchId}
        account={account}
        currency={currency}
        timeZone={summary.data?.timezone}
        today={summary.data?.today}
        onClose={() => setRecords(null)}
      />
      {editing ? (
        <AccountForm key={account.id} open account={account} currency={currency} branchId={branchId} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num min-w-0 break-words text-right">{value}</dd>
    </div>
  )
}
