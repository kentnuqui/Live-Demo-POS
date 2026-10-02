import type { ArStatementDto } from '@towns/shared'
import { dayLabel, money } from './ar-ui'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function statementHtml(statement: ArStatementDto): string {
  const { account, currency } = statement
  const cell = (cents: number) => (cents ? money(cents, currency) : '')
  const totals: Array<[string, number]> = [
    ['Opening balance', statement.openingCents],
    ['New sales', statement.salesCents],
    ['Payments', statement.paymentsCents],
    ['Credits', statement.refundsCents],
    ['Write-offs', statement.writeOffCents],
    ['Closing balance', statement.closingCents]
  ]
  const rows = statement.entries
    .map(
      (entry) =>
        `<tr><td>${dayLabel(entry.createdAt)}</td><td>${escapeHtml(entry.reference)}</td><td class="r">${cell(entry.debitCents)}</td><td class="r">${cell(entry.creditCents)}</td><td class="r">${money(entry.balanceCents, currency)}</td></tr>`
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Statement ${escapeHtml(account.accountNumber)}</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;color:#1d1b19;margin:32px;font-size:12px}
h1{font-family:Georgia,serif;font-size:24px;margin:0}
p{margin:2px 0}.muted{color:#6b665f}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{padding:6px 4px;border-bottom:1px solid #ddd;text-align:left}
th{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#6b665f}
.r{text-align:right;font-variant-numeric:tabular-nums}
.totals{max-width:320px;margin-top:20px}.totals td:last-child{text-align:right}
.totals tr:last-child td{font-weight:600;border-bottom:0}
</style></head><body>
<h1>${escapeHtml(statement.restaurantName)}</h1>
<p class="muted">${escapeHtml(statement.branchName)}${statement.branchAddress ? ` · ${escapeHtml(statement.branchAddress)}` : ''}</p>
<p style="margin-top:16px"><strong>${escapeHtml(account.companyName)}</strong> · ${escapeHtml(account.accountNumber)}</p>
<p class="muted">Statement ${dayLabel(statement.from)} to ${dayLabel(statement.to)}</p>
<table class="totals">${totals.map(([label, cents]) => `<tr><td>${label}</td><td class="r">${money(cents, currency)}</td></tr>`).join('')}</table>
<table><thead><tr><th>Date</th><th>Reference</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="muted">No activity in this period.</td></tr>'}</tbody></table>
</body></html>`
}

/** Prints only the statement, not the app window behind it. */
export function printStatement(statement: ArStatementDto): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    window.setTimeout(() => frame.remove(), 1000)
  }
  frame.srcdoc = statementHtml(statement)
  document.body.appendChild(frame)
}

/** CSV in minor units, matching the AR report export. */
export function downloadStatement(statement: ArStatementDto): void {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  const lines = [
    `Currency ${statement.currency}`,
    `Account,${quote(statement.account.companyName)},${statement.account.accountNumber}`,
    `Period,${statement.from},${statement.to}`,
    `Opening,${statement.openingCents}`,
    `Closing,${statement.closingCents}`,
    'Date,Reference,Description,Debit,Credit,Balance',
    ...statement.entries.map((entry) =>
      [entry.createdAt.slice(0, 10), quote(entry.reference), quote(entry.description), entry.debitCents, entry.creditCents, entry.balanceCents].join(',')
    )
  ]
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `statement-${statement.account.accountNumber}-${statement.from}-${statement.to}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
