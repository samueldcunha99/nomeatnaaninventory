DROP INDEX "stock_movements_ledger_idx";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "stock_movements_ledger_idx" ON "stock_movements" USING btree ("tenant_id","ingredient_id","seq");