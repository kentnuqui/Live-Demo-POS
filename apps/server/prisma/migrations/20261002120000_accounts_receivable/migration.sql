-- Accounts receivable. Existing orders, payments, and customers are left in place.
-- Account is a new tender. It records a sale without putting money in the drawer.

ALTER TYPE "payment_method" ADD VALUE IF NOT EXISTS 'ACCOUNT';

DO $$ BEGIN
  CREATE TYPE "ar_account_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ar_terms" AS ENUM ('DUE_IMMEDIATELY', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ar_invoice_status" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOIDED', 'WRITTEN_OFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ar_ledger_kind" AS ENUM ('INVOICE', 'PAYMENT', 'REFUND', 'VOID', 'WRITE_OFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ar_accounts" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "account_number" TEXT NOT NULL,
  "customer_name" TEXT NOT NULL,
  "company_name" TEXT NOT NULL,
  "contact_person" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "credit_limit_cents" INTEGER,
  "enforce_credit_limit" BOOLEAN NOT NULL DEFAULT true,
  "payment_terms" "ar_terms" NOT NULL DEFAULT 'NET_30',
  "custom_term_days" INTEGER NOT NULL DEFAULT 0,
  "status" "ar_account_status" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT NOT NULL DEFAULT '',
  "balance_cents" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ar_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ar_invoices" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "invoice_number" TEXT NOT NULL,
  "cashier_id" TEXT,
  "original_cents" INTEGER NOT NULL,
  "paid_cents" INTEGER NOT NULL DEFAULT 0,
  "refunded_cents" INTEGER NOT NULL DEFAULT 0,
  "written_off_cents" INTEGER NOT NULL DEFAULT 0,
  "remaining_cents" INTEGER NOT NULL,
  "invoice_on" VARCHAR(10) NOT NULL,
  "due_on" VARCHAR(10) NOT NULL,
  "terms" "ar_terms" NOT NULL,
  "term_days" INTEGER NOT NULL,
  "status" "ar_invoice_status" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT NOT NULL DEFAULT '',
  "voided_at" TIMESTAMP(3),
  "voided_by_id" TEXT,
  "void_reason" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ar_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ar_payments" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "method" "payment_method" NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "applied_cents" INTEGER NOT NULL DEFAULT 0,
  "unapplied_cents" INTEGER NOT NULL DEFAULT 0,
  "refunded_cents" INTEGER NOT NULL DEFAULT 0,
  "reference" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "cashier_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ar_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ar_allocations" (
  "id" TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ar_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ar_ledger_entries" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "invoice_id" TEXT,
  "payment_id" TEXT,
  "kind" "ar_ledger_kind" NOT NULL,
  "debit_cents" INTEGER NOT NULL DEFAULT 0,
  "credit_cents" INTEGER NOT NULL DEFAULT 0,
  "balance_cents" INTEGER NOT NULL,
  "reference" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ar_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ar_write_offs" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ar_write_offs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ar_audit_logs" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "account_id" TEXT,
  "invoice_id" TEXT,
  "payment_id" TEXT,
  "action" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "user_id" TEXT,
  "approver_id" TEXT,
  "amount_cents" INTEGER,
  "previous_value" TEXT NOT NULL DEFAULT '',
  "new_value" TEXT NOT NULL DEFAULT '',
  "reason" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ar_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ar_sequences" (
  "branch_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  CONSTRAINT "ar_sequences_pkey" PRIMARY KEY ("branch_id", "kind")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ar_accounts_branch_id_account_number_key" ON "ar_accounts"("branch_id", "account_number");
CREATE INDEX IF NOT EXISTS "ar_accounts_branch_id_status_idx" ON "ar_accounts"("branch_id", "status");
CREATE INDEX IF NOT EXISTS "ar_accounts_branch_id_company_name_idx" ON "ar_accounts"("branch_id", "company_name");
CREATE UNIQUE INDEX IF NOT EXISTS "ar_invoices_order_id_key" ON "ar_invoices"("order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ar_invoices_payment_id_key" ON "ar_invoices"("payment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ar_invoices_branch_id_invoice_number_key" ON "ar_invoices"("branch_id", "invoice_number");
CREATE INDEX IF NOT EXISTS "ar_invoices_account_id_status_idx" ON "ar_invoices"("account_id", "status");
CREATE INDEX IF NOT EXISTS "ar_invoices_branch_id_due_on_idx" ON "ar_invoices"("branch_id", "due_on");
CREATE INDEX IF NOT EXISTS "ar_invoices_branch_id_invoice_on_idx" ON "ar_invoices"("branch_id", "invoice_on");
CREATE INDEX IF NOT EXISTS "ar_invoices_cashier_id_idx" ON "ar_invoices"("cashier_id");
CREATE INDEX IF NOT EXISTS "ar_payments_branch_id_created_at_idx" ON "ar_payments"("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "ar_payments_account_id_created_at_idx" ON "ar_payments"("account_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ar_allocations_payment_id_invoice_id_key" ON "ar_allocations"("payment_id", "invoice_id");
CREATE INDEX IF NOT EXISTS "ar_allocations_invoice_id_idx" ON "ar_allocations"("invoice_id");
CREATE INDEX IF NOT EXISTS "ar_ledger_entries_account_id_created_at_idx" ON "ar_ledger_entries"("account_id", "created_at");
CREATE INDEX IF NOT EXISTS "ar_ledger_entries_branch_id_created_at_idx" ON "ar_ledger_entries"("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "ar_ledger_entries_invoice_id_idx" ON "ar_ledger_entries"("invoice_id");
CREATE INDEX IF NOT EXISTS "ar_write_offs_invoice_id_idx" ON "ar_write_offs"("invoice_id");
CREATE INDEX IF NOT EXISTS "ar_write_offs_account_id_idx" ON "ar_write_offs"("account_id");
CREATE INDEX IF NOT EXISTS "ar_audit_logs_branch_id_created_at_idx" ON "ar_audit_logs"("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "ar_audit_logs_account_id_created_at_idx" ON "ar_audit_logs"("account_id", "created_at");
CREATE INDEX IF NOT EXISTS "ar_audit_logs_invoice_id_idx" ON "ar_audit_logs"("invoice_id");

DO $$ BEGIN
  ALTER TABLE "ar_accounts" ADD CONSTRAINT "ar_accounts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_accounts" ADD CONSTRAINT "ar_accounts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_accounts" ADD CONSTRAINT "ar_accounts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ar_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ar_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_allocations" ADD CONSTRAINT "ar_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "ar_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_allocations" ADD CONSTRAINT "ar_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ar_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_ledger_entries" ADD CONSTRAINT "ar_ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ar_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_ledger_entries" ADD CONSTRAINT "ar_ledger_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ar_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_ledger_entries" ADD CONSTRAINT "ar_ledger_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_write_offs" ADD CONSTRAINT "ar_write_offs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ar_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_write_offs" ADD CONSTRAINT "ar_write_offs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ar_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_write_offs" ADD CONSTRAINT "ar_write_offs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_audit_logs" ADD CONSTRAINT "ar_audit_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_audit_logs" ADD CONSTRAINT "ar_audit_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ar_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_audit_logs" ADD CONSTRAINT "ar_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_audit_logs" ADD CONSTRAINT "ar_audit_logs_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_sequences" ADD CONSTRAINT "ar_sequences_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_amounts_nonneg" CHECK (
    "original_cents" > 0 AND "paid_cents" >= 0 AND "refunded_cents" >= 0 AND "written_off_cents" >= 0 AND "remaining_cents" >= 0
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_method_collected" CHECK ("method" <> 'ACCOUNT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_amounts_hold" CHECK (
    "amount_cents" > 0 AND "applied_cents" >= 0 AND "unapplied_cents" >= 0 AND "refunded_cents" >= 0
    AND "applied_cents" + "unapplied_cents" + "refunded_cents" = "amount_cents"
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ar_ledger_entries" ADD CONSTRAINT "ar_ledger_one_side" CHECK (
    ("debit_cents" > 0 AND "credit_cents" = 0) OR ("credit_cents" > 0 AND "debit_cents" = 0)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
