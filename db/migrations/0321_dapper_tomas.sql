CREATE TABLE "prevention_emergency_scenario_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"obligation" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 1000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_emergency_scenario_type_obligation_valid" CHECK ("prevention_emergency_scenario_types"."obligation" IN ('mandatory', 'senapred_detected', 'operational', 'optional', 'custom')),
	CONSTRAINT "prevention_emergency_scenario_type_sort_order_nonnegative" CHECK ("prevention_emergency_scenario_types"."sort_order" >= 0)
);
--> statement-breakpoint
INSERT INTO "prevention_emergency_scenario_types" ("code", "label", "obligation", "is_system", "is_active", "sort_order") VALUES
	('sismo', 'Sismo', 'mandatory', true, true, 10),
	('tsunami', 'Tsunami o maremoto', 'senapred_detected', true, true, 20),
	('aluvion', 'Aluvión', 'optional', true, true, 30),
	('incendio_estructural', 'Incendio estructural', 'mandatory', true, true, 40),
	('incendio_forestal', 'Incendio forestal', 'senapred_detected', true, true, 50),
	('asalto_robo', 'Asalto o robo', 'mandatory', true, true, 60),
	('erupcion_volcanica', 'Erupción volcánica', 'senapred_detected', true, true, 70),
	('inundacion_lluvia', 'Inundación por lluvia', 'optional', true, true, 80),
	('inundacion_cauce', 'Inundación por crecida de cauce', 'optional', true, true, 90),
	('nevada', 'Nevada', 'optional', true, true, 100),
	('marejada', 'Marejada', 'optional', true, true, 110),
	('corte_energia', 'Corte de energía eléctrica', 'mandatory', true, true, 120),
	('corte_agua', 'Corte de agua potable', 'mandatory', true, true, 130),
	('desorden_publico', 'Desorden público', 'optional', true, true, 140),
	('otra_amenaza', 'Otra amenaza', 'optional', true, true, 150),
	('derrame', 'Derrame', 'operational', true, true, 160),
	('fuga', 'Fuga', 'operational', true, true, 170),
	('volcamiento', 'Volcamiento', 'operational', true, true, 180),
	('exposicion', 'Exposición', 'operational', true, true, 190),
	('rescate', 'Rescate', 'operational', true, true, 200)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "prevention_emergency_drills" DROP CONSTRAINT IF EXISTS "prevention_emergency_drill_scenario_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_emergency_scenarios" DROP CONSTRAINT IF EXISTS "prevention_emergency_scenario_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_emergency_drills" ADD COLUMN "scenario_type_label_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_emergency_scenarios" ADD COLUMN "type_label_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "prevention_emergency_scenarios" AS scenario
SET "type_label_snapshot" = scenario_type."label"
FROM "prevention_emergency_scenario_types" AS scenario_type
WHERE scenario."type" = scenario_type."code" AND scenario."type_label_snapshot" = '';
--> statement-breakpoint
UPDATE "prevention_emergency_drills" AS drill
SET "scenario_type_label_snapshot" = scenario_type."label"
FROM "prevention_emergency_scenario_types" AS scenario_type
WHERE drill."scenario_type" = scenario_type."code" AND drill."scenario_type_label_snapshot" = '';
--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_emergency_scenario_type_label_unique" ON "prevention_emergency_scenario_types" USING btree (lower("label"));--> statement-breakpoint
ALTER TABLE "prevention_emergency_drills" ADD CONSTRAINT "prevention_emergency_drills_scenario_type_prevention_emergency_scenario_types_code_fk" FOREIGN KEY ("scenario_type") REFERENCES "public"."prevention_emergency_scenario_types"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_emergency_scenarios" ADD CONSTRAINT "prevention_emergency_scenarios_type_prevention_emergency_scenario_types_code_fk" FOREIGN KEY ("type") REFERENCES "public"."prevention_emergency_scenario_types"("code") ON DELETE restrict ON UPDATE no action;
