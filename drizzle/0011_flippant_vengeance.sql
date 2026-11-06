-- Also tolerates the draft constraint used only in the isolated migration rehearsal.
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_sales_tax_config";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_tracking_token_uq";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_tracking_token_uq" UNIQUE("tenant_id","tracking_token");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_sales_tax_config" CHECK (("tenants"."sales_tax_mode" is null and "tenants"."sales_tax_rate_millipercent" is null) or
    ("tenants"."sales_tax_mode" is not null and "tenants"."sales_tax_rate_millipercent" is not null and
      "tenants"."sales_tax_mode" in ('none', 'exclusive', 'inclusive') and "tenants"."sales_tax_rate_millipercent" between 0 and 100000 and
      ("tenants"."sales_tax_mode" <> 'none' or "tenants"."sales_tax_rate_millipercent" = 0)));
--> statement-breakpoint
CREATE FUNCTION validate_order_line_draw() RETURNS trigger AS $$
DECLARE movement stock_movements%ROWTYPE;
DECLARE line_order uuid;
BEGIN
  SELECT order_id INTO line_order FROM order_lines WHERE tenant_id = NEW.tenant_id AND id = NEW.order_line_id;
  SELECT * INTO movement FROM stock_movements WHERE tenant_id = NEW.tenant_id AND id = NEW.stock_movement_id;
  IF NOT FOUND OR movement.movement_type::text <> 'consumption'
    OR movement.ingredient_id <> NEW.ingredient_id OR movement.quantity_milli_base <> -NEW.quantity_milli_base
    OR movement.reference_type IS DISTINCT FROM 'order' OR movement.reference_id IS DISTINCT FROM line_order THEN
    RAISE EXCEPTION 'Order usage must match its own ingredient consumption movement'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'order_line_draws_match_movement';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER order_line_draws_validate BEFORE INSERT ON order_line_draws FOR EACH ROW EXECUTE FUNCTION validate_order_line_draw();
