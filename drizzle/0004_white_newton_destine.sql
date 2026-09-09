ALTER TABLE "ingredient_stock" ADD COLUMN "snapshot_seq" bigint DEFAULT 0 NOT NULL;

-- Backfill the watermark to where each cached row ACTUALLY stands.
--
-- Every existing ingredient_stock row was folded from the whole ledger, so a watermark
-- of 0 would tell the next incremental recalculation that none of those movements had
-- been counted yet - and it would fold all of them in a second time, on top of a state
-- that already contained them. Stock and cost would both silently double.
--
-- This is the one statement that makes adding the column safe on a live database.
UPDATE "ingredient_stock" s
SET "snapshot_seq" = COALESCE(
  (SELECT MAX(m."seq") FROM "stock_movements" m
    WHERE m."tenant_id" = s."tenant_id" AND m."ingredient_id" = s."ingredient_id"),
  0
);
