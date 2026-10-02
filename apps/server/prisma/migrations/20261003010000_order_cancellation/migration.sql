-- Who cancelled a check, who approved it, and why. Existing rows keep empty values.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_by_id" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_approved_by_id" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_id_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_cancel_approved_by_id_fkey"
    FOREIGN KEY ("cancel_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
