-- Prisma refuses to add orders(branch_id, ticket_number) until this warning is accepted.
-- Multiple empty ticket numbers are allowed. Only a repeated number on the same branch blocks the index.
-- Keep the oldest order's number and clear the later copies. The orders themselves stay.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'ticket_number'
  ) THEN
    UPDATE orders AS o
    SET ticket_number = NULL
    FROM (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY branch_id, ticket_number
            ORDER BY created_at ASC, id ASC
          ) AS rn
        FROM orders
        WHERE ticket_number IS NOT NULL
      ) ranked
      WHERE rn > 1
    ) dupes
    WHERE o.id = dupes.id;
  END IF;
END $$;
