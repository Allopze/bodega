CREATE TABLE "prevention_inspection_deviation_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"label" text NOT NULL,
	"dano_potencial" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_inspection_deviation_dano_valid" CHECK ("prevention_inspection_deviation_catalog"."dano_potencial" IN ('leve', 'moderado', 'grave', 'fatal')),
	CONSTRAINT "prevention_inspection_deviation_label_length" CHECK (length("prevention_inspection_deviation_catalog"."label") >= 3)
);
--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD COLUMN "catalog_entry_id" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_deviation_catalog" ADD CONSTRAINT "prevention_inspection_deviation_catalog_template_id_prevention_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prevention_inspection_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_inspection_deviation_catalog" ADD CONSTRAINT "prevention_inspection_deviation_catalog_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_inspection_deviation_label_unique" ON "prevention_inspection_deviation_catalog" USING btree ("template_id","label");--> statement-breakpoint
CREATE INDEX "prevention_inspection_deviation_template_idx" ON "prevention_inspection_deviation_catalog" USING btree ("template_id","is_active");--> statement-breakpoint
ALTER TABLE "prevention_inspection_findings" ADD CONSTRAINT "prevention_inspection_findings_catalog_entry_id_prevention_inspection_deviation_catalog_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."prevention_inspection_deviation_catalog"("id") ON DELETE set null ON UPDATE no action;