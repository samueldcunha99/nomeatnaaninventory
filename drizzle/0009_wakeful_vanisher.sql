CREATE TABLE "production_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"production_run_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_reversals_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "production_reversals_tenant_run_uq" UNIQUE("tenant_id","production_run_id"),
	CONSTRAINT "production_reversals_reason_required" CHECK (length(btrim("production_reversals"."reason")) between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "stock_output_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "reverses_movement_id" uuid;--> statement-breakpoint
-- FK targets must exist before adding the foreign keys (drizzle-kit emits them later).
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "production_reversals" ADD CONSTRAINT "production_reversals_tenant_run_fk" FOREIGN KEY ("tenant_id","production_run_id") REFERENCES "public"."production_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_reversals" ADD CONSTRAINT "production_reversals_tenant_user_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_reverses_fk" FOREIGN KEY ("tenant_id","reverses_movement_id") REFERENCES "public"."stock_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_tenant_reverses_uq" ON "stock_movements" USING btree ("tenant_id","reverses_movement_id") WHERE "stock_movements"."reverses_movement_id" is not null;--> statement-breakpoint
-- Existing shelf associations remain enabled; the default applies only to new recipes.
UPDATE "recipes" SET "stock_output_enabled" = true WHERE "stock_ingredient_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_enabled_has_shelf" CHECK (not "recipes"."stock_output_enabled" or "recipes"."stock_ingredient_id" is not null);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reverses_only_reversal" CHECK ("stock_movements"."reverses_movement_id" is null or "stock_movements"."movement_type"::text = 'reversal');--> statement-breakpoint

CREATE FUNCTION validate_stock_movement_reversal() RETURNS trigger AS $$
DECLARE original stock_movements%ROWTYPE;
BEGIN
  IF NEW.reverses_movement_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO original FROM stock_movements
    WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_movement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The original stock movement does not exist in this tenant'
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'stock_movements_tenant_reverses_fk';
  END IF;
  IF NEW.movement_type::text <> 'reversal' OR original.movement_type::text = 'reversal'
     OR original.ingredient_id <> NEW.ingredient_id
     OR original.quantity_milli_base <> -NEW.quantity_milli_base THEN
    RAISE EXCEPTION 'A reversal must exactly compensate the same ingredient movement'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stock_movements_reversal_matches_original';
  END IF;
  IF original.reference_type = 'production' AND (
    NEW.reference_type IS DISTINCT FROM 'production_reversal' OR NOT EXISTS (
      SELECT 1 FROM production_reversals r WHERE r.tenant_id = NEW.tenant_id
        AND r.id = NEW.reference_id AND r.production_run_id = original.reference_id
    )) THEN
    RAISE EXCEPTION 'Production reversals require a matching correction event'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stock_movements_production_reversal_event';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER stock_movements_validate_reversal BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION validate_stock_movement_reversal();--> statement-breakpoint

-- Deferred until commit: a correction event and every inverse movement are one operation.
CREATE FUNCTION validate_production_reversal_complete() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.tenant_id = NEW.tenant_id
      AND m.reference_type = 'production' AND m.reference_id = NEW.production_run_id)
    OR EXISTS (SELECT 1 FROM stock_movements m WHERE m.tenant_id = NEW.tenant_id
      AND m.reference_type = 'production' AND m.reference_id = NEW.production_run_id
      AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.tenant_id = NEW.tenant_id
        AND r.reverses_movement_id = m.id AND r.reference_type = 'production_reversal'
        AND r.reference_id = NEW.id)) THEN
    RAISE EXCEPTION 'A production correction must reverse every movement in its run'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'production_reversals_all_movements';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER production_reversals_complete AFTER INSERT ON production_reversals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_production_reversal_complete();--> statement-breakpoint

CREATE FUNCTION production_reversals_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_maintenance', true) = 'on' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'production_reversals is append-only: % attempted on correction %.', TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER production_reversals_no_update BEFORE UPDATE ON production_reversals
  FOR EACH ROW EXECUTE FUNCTION production_reversals_append_only();--> statement-breakpoint
CREATE TRIGGER production_reversals_no_delete BEFORE DELETE ON production_reversals
  FOR EACH ROW EXECUTE FUNCTION production_reversals_append_only();
