CREATE TYPE "public"."movement_reason" AS ENUM('count_correction', 'theft', 'spoilage', 'expiry', 'burnt', 'dropped', 'trim', 'other');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('purchase', 'adjustment', 'wastage', 'consumption', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."unit_type" AS ENUM('weight', 'volume', 'count');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'manager', 'counter', 'kitchen');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_stock" (
	"tenant_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty_milli_base" bigint DEFAULT 0 NOT NULL,
	"weighted_avg_cost_millipaise_per_base" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_stock_tenant_id_ingredient_id_pk" PRIMARY KEY("tenant_id","ingredient_id"),
	CONSTRAINT "ingredient_stock_avg_cost_nonneg" CHECK ("ingredient_stock"."weighted_avg_cost_millipaise_per_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_type" "unit_type" NOT NULL,
	"purchase_unit" text NOT NULL,
	"purchase_unit_in_base" bigint NOT NULL,
	"low_stock_threshold_milli_base" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ingredients_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "ingredients_purchase_unit_positive" CHECK ("ingredients"."purchase_unit_in_base" > 0),
	CONSTRAINT "ingredients_threshold_nonneg" CHECK ("ingredients"."low_stock_threshold_milli_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"movement_type" "movement_type" NOT NULL,
	"quantity_milli_base" bigint NOT NULL,
	"unit_cost_millipaise_per_base" bigint,
	"total_cost_paise" bigint,
	"supplier_id" uuid,
	"reference_type" text,
	"reference_id" uuid,
	"reason" "movement_reason",
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_qty_nonzero" CHECK ("stock_movements"."quantity_milli_base" <> 0),
	CONSTRAINT "stock_movements_cost_on_purchase_only" CHECK (("stock_movements"."movement_type" = 'purchase') = ("stock_movements"."unit_cost_millipaise_per_base" is not null and "stock_movements"."total_cost_paise" is not null)),
	CONSTRAINT "stock_movements_cost_nonneg" CHECK ("stock_movements"."unit_cost_millipaise_per_base" is null or ("stock_movements"."unit_cost_millipaise_per_base" >= 0 and "stock_movements"."total_cost_paise" >= 0)),
	CONSTRAINT "stock_movements_purchase_qty_positive" CHECK ("stock_movements"."movement_type" <> 'purchase' or "stock_movements"."quantity_milli_base" > 0),
	CONSTRAINT "stock_movements_manual_has_reason" CHECK (case when "stock_movements"."movement_type" in ('adjustment', 'wastage') then "stock_movements"."reason" is not null else "stock_movements"."reason" is null end),
	CONSTRAINT "stock_movements_reason_matches_type" CHECK ("stock_movements"."reason" is null
          or ("stock_movements"."movement_type" = 'adjustment' and "stock_movements"."reason" in ('count_correction', 'theft', 'other'))
          or ("stock_movements"."movement_type" = 'wastage' and "stock_movements"."reason" in ('spoilage', 'expiry', 'burnt', 'dropped', 'trim', 'other'))),
	CONSTRAINT "stock_movements_other_reason_has_note" CHECK ("stock_movements"."reason" <> 'other' or "stock_movements"."note" is not null)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "suppliers_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_stock" ADD CONSTRAINT "ingredient_stock_tenant_ingredient_fk" FOREIGN KEY ("tenant_id","ingredient_id") REFERENCES "public"."ingredients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_ingredient_fk" FOREIGN KEY ("tenant_id","ingredient_id") REFERENCES "public"."ingredients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_user_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ingredient_stock_low_idx" ON "ingredient_stock" USING btree ("tenant_id","qty_milli_base");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredients_tenant_name_uq" ON "ingredients" USING btree ("tenant_id",lower("name")) WHERE "ingredients"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ingredients_tenant_active_idx" ON "ingredients" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "sessions_tenant_user_idx" ON "sessions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "stock_movements_ledger_idx" ON "stock_movements" USING btree ("tenant_id","ingredient_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_reference_idx" ON "stock_movements" USING btree ("tenant_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_idx" ON "suppliers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_uq" ON "users" USING btree ("tenant_id",lower("email"));