ALTER TABLE "recipes" ADD COLUMN "batch_minutes" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "labour_rate_paise_per_hour" bigint;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "kitchen_rate_paise_per_hour" bigint;