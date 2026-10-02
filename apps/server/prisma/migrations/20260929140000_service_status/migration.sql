-- Floor service state, written by the kitchen pass.
-- Check status and payments are not changed. Existing rows stay null.

DO $$ BEGIN
  CREATE TYPE "service_status" AS ENUM ('PREPARING', 'READY_TO_SERVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "service_status" "service_status";
