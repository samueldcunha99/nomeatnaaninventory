CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"recipe_id" uuid NOT NULL,
	"portion_qty_milli_base" bigint NOT NULL,
	"selling_price_paise" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "menu_items_portion_positive" CHECK ("menu_items"."portion_qty_milli_base" > 0),
	CONSTRAINT "menu_items_price_nonneg" CHECK ("menu_items"."selling_price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"sub_recipe_id" uuid,
	"quantity_milli_base" bigint NOT NULL,
	"wastage_millipercent" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recipe_lines_exactly_one_source" CHECK (("recipe_lines"."ingredient_id" is null) <> ("recipe_lines"."sub_recipe_id" is null)),
	CONSTRAINT "recipe_lines_no_self_reference" CHECK ("recipe_lines"."sub_recipe_id" is distinct from "recipe_lines"."recipe_id"),
	CONSTRAINT "recipe_lines_qty_positive" CHECK ("recipe_lines"."quantity_milli_base" > 0),
	CONSTRAINT "recipe_lines_wastage_range" CHECK ("recipe_lines"."wastage_millipercent" >= 0 and "recipe_lines"."wastage_millipercent" <= 100000)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"yield_unit_type" "unit_type" NOT NULL,
	"yield_qty_milli_base" bigint NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recipes_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "recipes_yield_positive" CHECK ("recipes"."yield_qty_milli_base" > 0)
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_recipe_fk" FOREIGN KEY ("tenant_id","recipe_id") REFERENCES "public"."recipes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_tenant_recipe_fk" FOREIGN KEY ("tenant_id","recipe_id") REFERENCES "public"."recipes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_tenant_ingredient_fk" FOREIGN KEY ("tenant_id","ingredient_id") REFERENCES "public"."ingredients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_tenant_sub_recipe_fk" FOREIGN KEY ("tenant_id","sub_recipe_id") REFERENCES "public"."recipes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "menu_items_tenant_name_uq" ON "menu_items" USING btree ("tenant_id",lower("name")) WHERE "menu_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "menu_items_tenant_active_idx" ON "menu_items" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "menu_items_tenant_recipe_idx" ON "menu_items" USING btree ("tenant_id","recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_tenant_recipe_idx" ON "recipe_lines" USING btree ("tenant_id","recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_tenant_sub_recipe_idx" ON "recipe_lines" USING btree ("tenant_id","sub_recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_tenant_name_uq" ON "recipes" USING btree ("tenant_id",lower("name")) WHERE "recipes"."deleted_at" is null;