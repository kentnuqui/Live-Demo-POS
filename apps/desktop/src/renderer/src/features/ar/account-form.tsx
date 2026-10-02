import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AR_ACCOUNT_STATUSES,
  AR_ACCOUNT_STATUS_LABEL,
  minorExponent,
  parseMajorToMinor,
  type ArAccountCreateInput,
  type ArAccountDto,
  type ArTerms
} from '@towns/shared'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useToasts } from '@/stores/toast-store'
import { problem } from './ar-ui'

export function AccountForm({
  open,
  account,
  currency,
  branchId,
  onClose
}: {
  open: boolean
  account: ArAccountDto | null
  currency: string
  branchId: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const [companyName, setCompany] = useState(account?.companyName ?? '')
  const [customerName, setCustomer] = useState(account?.customerName ?? '')
  const [contactPerson, setContact] = useState(account?.contactPerson ?? '')
  const [phone, setPhone] = useState(account?.phone ?? '')
  const [email, setEmail] = useState(account?.email ?? '')
  const [address, setAddress] = useState(account?.address ?? '')
  const [limit, setLimit] = useState(account?.creditLimitCents == null ? '' : majorUnits(account.creditLimitCents, currency))
  const terms: ArTerms = account?.paymentTerms ?? 'NET_30'
  const customDays = String(account?.termDays ?? 30)
  const [status, setStatus] = useState(account?.status ?? 'ACTIVE')
  const [notes, setNotes] = useState(account?.notes ?? '')
  const save = useMutation({
    mutationFn: () => {
      const credit = limit.trim() ? parseMajorToMinor(limit, currency) : null
      if (limit.trim() && credit == null) throw new Error('Enter the credit limit as a number.')
      if (terms === 'CUSTOM' && !/^\d+$/.test(customDays)) throw new Error('Enter the number of days.')
      const body: ArAccountCreateInput = {
        companyName: companyName.trim(),
        customerName: customerName.trim(),
        contactPerson,
        phone,
        email,
        address,
        creditLimitCents: credit,
        enforceCreditLimit: credit != null,
        paymentTerms: terms,
        customTermDays: terms === 'CUSTOM' ? Number(customDays) : undefined,
        notes
      }
      if (account) return api.updateArAccount(branchId, account.id, { ...body, status })
      return api.createArAccount(branchId, body)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ar-accounts', branchId] })
      void client.invalidateQueries({ queryKey: ['ar-account', branchId] })
      onClose()
      useToasts.getState().push('Account saved')
    },
    onError: (error) => useToasts.getState().push(problem(error, 'Unable to save this account. No changes were made.'))
  })
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100%-2rem)] w-[min(640px,calc(100%-1.5rem))] overflow-y-auto">
        <DialogTitle>{account ? 'Edit account' : 'New account'}</DialogTitle>
        <DialogDescription>Only an active account can be used for a new credit sale.</DialogDescription>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input value={companyName} onChange={(event) => setCompany(event.target.value)} placeholder="Company" />
          <Input value={customerName} onChange={(event) => setCustomer(event.target.value)} placeholder="Customer name" />
          <Input value={contactPerson} onChange={(event) => setContact(event.target.value)} placeholder="Contact person" />
          <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" />
          <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
          <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Address" />
          <Input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="Credit limit, blank for none" inputMode="decimal" />
          {account ? (
            <select className="h-12 rounded-xl border bg-card px-3" value={status} onChange={(event) => setStatus(event.target.value as ArAccountDto['status'])}>
              {AR_ACCOUNT_STATUSES.map((item) => (
                <option key={item} value={item}>{AR_ACCOUNT_STATUS_LABEL[item]}</option>
              ))}
            </select>
          ) : null}
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" />
        </div>
        <Button className="mt-4 w-full" size="lg" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving account...' : 'Save account'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function majorUnits(cents: number, currency: string): string {
  const exponent = minorExponent(currency)
  return (cents / 10 ** exponent).toFixed(exponent)
}
