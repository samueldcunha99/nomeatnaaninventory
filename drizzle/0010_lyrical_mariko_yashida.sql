CREATE TABLE "order_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "order_counters_positive" CHECK ("order_counters"."next_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_line_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"stock_movement_id" uuid NOT NULL,
	"quantity_milli_base" bigint NOT NULL,
	"unit_cost_millipaise_per_base" bigint,
	"cost_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_line_draws_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "order_line_draws_tenant_movement_uq" UNIQUE("tenant_id","stock_movement_id"),
	CONSTRAINT "order_line_draws_positive" CHECK ("order_line_draws"."quantity_milli_base" > 0),
	CONSTRAINT "order_line_draws_cost_bounds" CHECK (("order_line_draws"."unit_cost_millipaise_per_base" is null or "order_line_draws"."unit_cost_millipaise_per_base" >= 0) and ("order_line_draws"."cost_paise" is null or "order_line_draws"."cost_paise" >= 0))
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"name_snapshot" text NOT NULL,
	"quantity" integer NOT NULL,
	"portion_qty_milli_base" bigint NOT NULL,
	"yield_unit_type" "unit_type" NOT NULL,
	"fulfillment_mode" text NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"cost_snapshot_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lines_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "order_lines_tenant_line_uq" UNIQUE("tenant_id","order_id","line_number"),
	CONSTRAINT "order_lines_positive" CHECK ("order_lines"."line_number" > 0 and "order_lines"."quantity" > 0 and "order_lines"."portion_qty_milli_base" > 0),
	CONSTRAINT "order_lines_amount_bounds" CHECK ("order_lines"."unit_price_paise" between 0 and 9007199254740991 and "order_lines"."line_total_paise" between 0 and 9007199254740991 and ("order_lines"."cost_snapshot_paise" is null or "order_lines"."cost_snapshot_paise" between 0 and 9007199254740991)),
	CONSTRAINT "order_lines_fulfillment" CHECK ("order_lines"."fulfillment_mode" in ('stocked', 'made_to_order'))
);
--> statement-breakpoint
CREATE TABLE "order_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_events_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "order_status_events_status" CHECK ("order_status_events"."to_status" in ('ordered', 'in_kitchen', 'baking', 'out_of_oven', 'ready', 'out_for_delivery', 'completed', 'cancelled') and ("order_status_events"."from_status" is null or "order_status_events"."from_status" in ('ordered', 'in_kitchen', 'baking', 'out_of_oven', 'ready', 'out_for_delivery', 'completed', 'cancelled'))),
	CONSTRAINT "order_status_events_cancel_reason" CHECK ("order_status_events"."to_status" <> 'cancelled' or length(btrim("order_status_events"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"order_number" integer NOT NULL,
	"order_type" text NOT NULL,
	"status" text DEFAULT 'ordered' NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"delivery_address" text,
	"note" text,
	"tracking_token" text NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"tax_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"tax_mode" text NOT NULL,
	"tax_rate_millipercent" bigint NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"stock_reversed" boolean DEFAULT false NOT NULL,
	"cancelled_after_preparation" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "orders_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "orders_tenant_request_uq" UNIQUE("tenant_id","request_id"),
	CONSTRAINT "orders_tenant_number_uq" UNIQUE("tenant_id","order_number"),
	CONSTRAINT "orders_tracking_token_uq" UNIQUE("tracking_token"),
	CONSTRAINT "orders_number_positive" CHECK ("orders"."order_number" > 0),
	CONSTRAINT "orders_request_hash" CHECK ("orders"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "orders_tracking_token_length" CHECK (length("orders"."tracking_token") between 24 and 128),
	CONSTRAINT "orders_type" CHECK ("orders"."order_type" in ('dine_in', 'takeaway', 'delivery')),
	CONSTRAINT "orders_status" CHECK ("orders"."status" in ('ordered', 'in_kitchen', 'baking', 'out_of_oven', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
	CONSTRAINT "orders_payment_status" CHECK ("orders"."payment_status" in ('unpaid', 'part_paid', 'paid', 'part_refunded', 'refunded')),
	CONSTRAINT "orders_amount_bounds" CHECK ("orders"."subtotal_paise" between 0 and 9007199254740991 and "orders"."tax_paise" between 0 and 9007199254740991 and "orders"."total_paise" between 0 and 9007199254740991),
	CONSTRAINT "orders_tax_snapshot" CHECK ("orders"."tax_mode" in ('none', 'exclusive', 'inclusive') and "orders"."tax_rate_millipercent" between 0 and 100000 and ("orders"."tax_mode" <> 'none' or "orders"."tax_rate_millipercent" = 0)),
	CONSTRAINT "orders_cancel_flags" CHECK ((not "orders"."stock_reversed" and not "orders"."cancelled_after_preparation") or "orders"."status" = 'cancelled')
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"method" text NOT NULL,
	"event_type" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"reference" text,
	"provider" text,
	"provider_event_id" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_events_tenant_request_uq" UNIQUE("tenant_id","request_id"),
	CONSTRAINT "payment_events_type" CHECK ("payment_events"."event_type" in ('payment', 'refund') and "payment_events"."method" in ('cash', 'external')),
	CONSTRAINT "payment_events_amount" CHECK ("payment_events"."amount_paise" between 1 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "fulfillment_mode" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sales_tax_mode" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sales_tax_rate_millipercent" bigint;--> statement-breakpoint
-- This existing-table target must be unique before adding order_lines' composite FK.
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_draws" ADD CONSTRAINT "order_line_draws_tenant_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "public"."order_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_draws" ADD CONSTRAINT "order_line_draws_tenant_ingredient_fk" FOREIGN KEY ("tenant_id","ingredient_id") REFERENCES "public"."ingredients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_draws" ADD CONSTRAINT "order_line_draws_tenant_movement_fk" FOREIGN KEY ("tenant_id","stock_movement_id") REFERENCES "public"."stock_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_menu_fk" FOREIGN KEY ("tenant_id","menu_item_id") REFERENCES "public"."menu_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_recipe_fk" FOREIGN KEY ("tenant_id","recipe_id") REFERENCES "public"."recipes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_tenant_user_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_user_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_user_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_line_draws_tenant_line_idx" ON "order_line_draws" USING btree ("tenant_id","order_line_id");--> statement-breakpoint
CREATE INDEX "order_lines_tenant_menu_idx" ON "order_lines" USING btree ("tenant_id","menu_item_id");--> statement-breakpoint
CREATE INDEX "order_status_events_tenant_order_idx" ON "order_status_events" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_day_idx" ON "orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_status_idx" ON "orders" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_tenant_provider_uq" ON "payment_events" USING btree ("tenant_id","provider","provider_event_id") WHERE "payment_events"."provider_event_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_events_tenant_order_idx" ON "payment_events" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_fulfillment_mode" CHECK ("menu_items"."fulfillment_mode" is null or "menu_items"."fulfillment_mode" in ('stocked', 'made_to_order'));
--> statement-breakpoint
CREATE FUNCTION order_snapshot_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_maintenance', true) = 'on' AND current_user <> 'cafe_app' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER order_lines_append_only BEFORE UPDATE OR DELETE ON order_lines FOR EACH ROW EXECUTE FUNCTION order_snapshot_append_only();
--> statement-breakpoint
CREATE TRIGGER order_line_draws_append_only BEFORE UPDATE OR DELETE ON order_line_draws FOR EACH ROW EXECUTE FUNCTION order_snapshot_append_only();
--> statement-breakpoint
CREATE TRIGGER order_status_events_append_only BEFORE UPDATE OR DELETE ON order_status_events FOR EACH ROW EXECUTE FUNCTION order_snapshot_append_only();
--> statement-breakpoint
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION order_snapshot_append_only();
--> statement-breakpoint
CREATE FUNCTION orders_preserve_snapshot() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_maintenance', true) = 'on' AND current_user <> 'cafe_app' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Orders must retain their history' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','payment_status','stock_reversed','cancelled_after_preparation','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','payment_status','stock_reversed','cancelled_after_preparation','updated_at']) THEN
    RAISE EXCEPTION 'Confirmed order snapshots cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER orders_preserve_snapshot BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION orders_preserve_snapshot();
