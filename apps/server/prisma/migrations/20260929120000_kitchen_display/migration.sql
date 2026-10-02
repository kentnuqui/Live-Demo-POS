-- Kitchen pass state, kept apart from check status so billing and payment do not pull a ticket off the line.
-- Existing fired checks (SENT / PREPARING / READY) are placed on the board. Closed checks are left alone.

DO $$ BEGIN
  CREATE TYPE "kitchen_order_status" AS ENUM ('NEW', 'PREPARING', 'READY', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "kitchen_status" "kitchen_order_status";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "kitchen_started_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "kitchen_completed_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ticket_number" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_branch_id_ticket_number_key" ON "orders"("branch_id", "ticket_number");
CREATE INDEX IF NOT EXISTS "orders_branch_id_kitchen_status_idx" ON "orders"("branch_id", "kitchen_status");

UPDATE "orders"
SET
  "kitchen_status" = CASE "status"
    WHEN 'SENT' THEN 'NEW'::"kitchen_order_status"
    WHEN 'PREPARING' THEN 'PREPARING'::"kitchen_order_status"
    WHEN 'READY' THEN 'READY'::"kitchen_order_status"
    ELSE "kitchen_status"
  END,
  "kitchen_started_at" = COALESCE("kitchen_started_at", "created_at")
WHERE "kitchen_status" IS NULL
  AND "status" IN ('SENT', 'PREPARING', 'READY');

WITH ranked AS (
  SELECT
    o.id,
    COALESCE(m.floor, 1000) + ROW_NUMBER() OVER (PARTITION BY o.branch_id ORDER BY o.created_at, o.id) AS n
  FROM "orders" o
  LEFT JOIN (
    SELECT branch_id, MAX(ticket_number) AS floor
    FROM "orders"
    WHERE ticket_number IS NOT NULL
    GROUP BY branch_id
  ) m ON m.branch_id = o.branch_id
  WHERE o.kitchen_status IS NOT NULL
    AND o.ticket_number IS NULL
)
UPDATE "orders" AS target
SET ticket_number = ranked.n
FROM ranked
WHERE target.id = ranked.id;
