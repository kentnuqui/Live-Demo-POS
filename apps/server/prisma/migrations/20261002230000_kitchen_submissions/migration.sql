-- Incremental kitchen firings. Existing orders and ticket numbers are kept.
-- One initial submission is created for checks already on the pass.

DO $$ BEGIN
  CREATE TYPE "kitchen_submission_kind" AS ENUM ('INITIAL', 'ADDITION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "kitchen_submissions" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" "kitchen_submission_kind" NOT NULL,
  "kitchen_status" "kitchen_order_status" NOT NULL DEFAULT 'NEW',
  "started_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "sent_by_id" TEXT,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kitchen_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "kitchen_submission_items" (
  "id" TEXT NOT NULL,
  "submission_id" TEXT NOT NULL,
  "order_item_id" TEXT,
  "name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "station" "menu_station" NOT NULL DEFAULT 'KITCHEN',
  "cancelled_quantity" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kitchen_submission_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "kitchen_submission_modifiers" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "price_cents" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kitchen_submission_modifiers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_events" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "actor_id" TEXT,
  "summary" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "kitchen_submissions_idempotency_key_key" ON "kitchen_submissions"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "kitchen_submissions_order_id_sequence_key" ON "kitchen_submissions"("order_id", "sequence");
CREATE INDEX IF NOT EXISTS "kitchen_submissions_branch_id_kitchen_status_idx" ON "kitchen_submissions"("branch_id", "kitchen_status");
CREATE INDEX IF NOT EXISTS "kitchen_submissions_order_id_idx" ON "kitchen_submissions"("order_id");
CREATE INDEX IF NOT EXISTS "kitchen_submission_items_submission_id_idx" ON "kitchen_submission_items"("submission_id");
CREATE INDEX IF NOT EXISTS "kitchen_submission_items_order_item_id_idx" ON "kitchen_submission_items"("order_item_id");
CREATE INDEX IF NOT EXISTS "kitchen_submission_modifiers_item_id_idx" ON "kitchen_submission_modifiers"("item_id");
CREATE INDEX IF NOT EXISTS "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "kitchen_submissions" ADD CONSTRAINT "kitchen_submissions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "kitchen_submissions" ADD CONSTRAINT "kitchen_submissions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "kitchen_submissions" ADD CONSTRAINT "kitchen_submissions_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "kitchen_submission_items" ADD CONSTRAINT "kitchen_submission_items_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "kitchen_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "kitchen_submission_items" ADD CONSTRAINT "kitchen_submission_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "kitchen_submission_modifiers" ADD CONSTRAINT "kitchen_submission_modifiers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "kitchen_submission_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "order_events" ADD CONSTRAINT "order_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "kitchen_submissions" (
  "id", "order_id", "branch_id", "sequence", "kind", "kitchen_status", "started_at", "completed_at", "sent_by_id", "created_at"
)
SELECT
  gen_random_uuid()::text,
  o."id",
  o."branch_id",
  1,
  'INITIAL'::"kitchen_submission_kind",
  o."kitchen_status",
  COALESCE(o."kitchen_started_at", o."created_at"),
  o."kitchen_completed_at",
  o."server_id",
  COALESCE(o."kitchen_started_at", o."created_at")
FROM "orders" o
WHERE o."kitchen_status" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "kitchen_submissions" s WHERE s."order_id" = o."id");

INSERT INTO "kitchen_submission_items" (
  "id", "submission_id", "order_item_id", "name", "quantity", "notes", "station", "cancelled_quantity", "created_at"
)
SELECT
  gen_random_uuid()::text,
  s."id",
  i."id",
  i."name",
  CASE WHEN i."fired_quantity" > 0 THEN i."fired_quantity" WHEN i."sent_at" IS NOT NULL THEN i."quantity" ELSE 0 END,
  i."notes",
  i."station",
  0,
  s."started_at"
FROM "order_items" i
JOIN "kitchen_submissions" s ON s."order_id" = i."order_id" AND s."sequence" = 1 AND s."kind" = 'INITIAL'
WHERE i."voided" = false
  AND (i."fired_quantity" > 0 OR i."sent_at" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "kitchen_submission_items" existing WHERE existing."order_item_id" = i."id"
  );

INSERT INTO "kitchen_submission_modifiers" ("id", "item_id", "name", "price_cents", "created_at")
SELECT
  gen_random_uuid()::text,
  ksi."id",
  m."modifier_name",
  m."price_cents",
  ksi."created_at"
FROM "order_item_modifiers" m
JOIN "kitchen_submission_items" ksi ON ksi."order_item_id" = m."order_item_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "kitchen_submission_modifiers" existing
  WHERE existing."item_id" = ksi."id" AND existing."name" = m."modifier_name"
);
