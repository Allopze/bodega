ALTER TABLE "mant_equipment_profiles" ADD COLUMN "prior_preventive_date" text;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD COLUMN "prior_preventive_reading" numeric(14, 1);--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD COLUMN "prior_preventive_interval" integer;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD COLUMN "prior_preventive_evidence" text;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD COLUMN "prior_preventive_declared_by" text;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD COLUMN "prior_preventive_source" text;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD CONSTRAINT "mant_equipment_profiles_prior_declared_by_fk" FOREIGN KEY ("prior_preventive_declared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD CONSTRAINT "mant_equipment_profiles_prior_preventive_all" CHECK (("mant_equipment_profiles"."prior_preventive_date" IS NULL) = ("mant_equipment_profiles"."prior_preventive_reading" IS NULL)
    AND ("mant_equipment_profiles"."prior_preventive_date" IS NULL) = ("mant_equipment_profiles"."prior_preventive_interval" IS NULL)
    AND ("mant_equipment_profiles"."prior_preventive_date" IS NULL) = ("mant_equipment_profiles"."prior_preventive_evidence" IS NULL));--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" ADD CONSTRAINT "mant_equipment_profiles_prior_preventive_valid" CHECK (("mant_equipment_profiles"."prior_preventive_reading" IS NULL OR "mant_equipment_profiles"."prior_preventive_reading" >= 0)
    AND ("mant_equipment_profiles"."prior_preventive_interval" IS NULL OR "mant_equipment_profiles"."prior_preventive_interval" > 0)
    AND ("mant_equipment_profiles"."prior_preventive_evidence" IS NULL OR btrim("mant_equipment_profiles"."prior_preventive_evidence") <> ''));