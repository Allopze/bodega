CREATE TABLE "epp_types" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epp_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "epp_product_families" ADD COLUMN "epp_type_id" text;--> statement-breakpoint
ALTER TABLE "epp_product_families" ADD COLUMN "certification" text;--> statement-breakpoint
ALTER TABLE "epp_product_families" ADD COLUMN "lifespan_months" integer;--> statement-breakpoint
ALTER TABLE "epp_product_families" ADD COLUMN "pictogram_url" text;--> statement-breakpoint
ALTER TABLE "epp_product_families" ADD CONSTRAINT "epp_product_families_epp_type_id_epp_types_id_fk" FOREIGN KEY ("epp_type_id") REFERENCES "public"."epp_types"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "epp_types" ("id", "code", "label", "sort_order") VALUES
  ('eppt-cabeza',        'cabeza',        'Cabeza',         0),
  ('eppt-ojos-cara',     'ojos_cara',     'Ojos y cara',    1),
  ('eppt-auditiva',      'auditiva',      'Auditiva',       2),
  ('eppt-respiratoria',  'respiratoria',  'Respiratoria',   3),
  ('eppt-manos',         'manos',         'Manos',          4),
  ('eppt-pies',          'pies',          'Pies',           5),
  ('eppt-caidas',        'caidas',        'Caídas',         6),
  ('eppt-cuerpo',        'cuerpo',        'Cuerpo entero',  7),
  ('eppt-altura',        'altura',        'Trabajo en altura', 8)
ON CONFLICT ("code") DO NOTHING;