ALTER TABLE "ingredient_stock" ALTER COLUMN "weighted_avg_cost_millipaise_per_base" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "ingredient_stock" ALTER COLUMN "weighted_avg_cost_millipaise_per_base" DROP NOT NULL;
--> statement-breakpoint
-- Sum quantities only; weighted-average arithmetic stays in the shared TS fold.
-- Preserve cache quantities and the actual snapshot watermark.
WITH positions AS (
  SELECT tenant_id, ingredient_id, movement_type,
    sum(quantity_milli_base) OVER (
      PARTITION BY tenant_id, ingredient_id ORDER BY seq ROWS UNBOUNDED PRECEDING
    ) - quantity_milli_base AS quantity_before
  FROM stock_movements
), known_basis AS (
  SELECT tenant_id, ingredient_id
  FROM positions
  -- 0007 adds production in this same migrator transaction on a fresh install.
  -- Compare as text so PostgreSQL 16 never resolves an uncommitted enum label.
  WHERE movement_type::text IN ('purchase', 'production') AND quantity_before <= 0
  GROUP BY tenant_id, ingredient_id
)
UPDATE ingredient_stock AS stock
SET weighted_avg_cost_millipaise_per_base = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM known_basis AS basis
  WHERE basis.tenant_id = stock.tenant_id AND basis.ingredient_id = stock.ingredient_id
);
