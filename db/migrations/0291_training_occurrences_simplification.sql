CREATE TABLE "prevention_training_catalog_items" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"item_type" text NOT NULL,
	"audience" text NOT NULL,
	"catalog_version" text NOT NULL,
	"source_row" integer NOT NULL,
	"schedule_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pdtp_activity_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_training_catalog_item_type_check" CHECK ("prevention_training_catalog_items"."item_type" IN ('course', 'campaign')),
	CONSTRAINT "prevention_training_catalog_code_check" CHECK (length("prevention_training_catalog_items"."code") BETWEEN 5 AND 20),
	CONSTRAINT "prevention_training_catalog_title_check" CHECK (length("prevention_training_catalog_items"."title") BETWEEN 3 AND 500),
	CONSTRAINT "prevention_training_catalog_source_row_check" CHECK ("prevention_training_catalog_items"."source_row" > 0),
	CONSTRAINT "prevention_training_catalog_sort_order_check" CHECK ("prevention_training_catalog_items"."sort_order" > 0)
);
--> statement-breakpoint
CREATE TABLE "prevention_training_occurrence_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"occurrence_id" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"uploaded_by_user_id" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"annulled_by_user_id" text,
	"annulled_at" timestamp with time zone,
	"annulled_reason" text,
	CONSTRAINT "prevention_training_occurrence_evidence_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "prevention_training_occurrence_evidence_file_name_check" CHECK (length("prevention_training_occurrence_evidence"."file_name") BETWEEN 1 AND 255),
	CONSTRAINT "prevention_training_occurrence_evidence_size_check" CHECK ("prevention_training_occurrence_evidence"."file_size_bytes" > 0),
	CONSTRAINT "prevention_training_occurrence_evidence_sha256_check" CHECK ("prevention_training_occurrence_evidence"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "prevention_training_occurrence_evidence_state_check" CHECK ("prevention_training_occurrence_evidence"."state" IN ('active', 'replaced', 'annulled')),
	CONSTRAINT "prevention_training_occurrence_evidence_annulled_consistency_check" CHECK (("prevention_training_occurrence_evidence"."state" IN ('active', 'replaced') AND "prevention_training_occurrence_evidence"."annulled_at" IS NULL AND "prevention_training_occurrence_evidence"."annulled_by_user_id" IS NULL AND "prevention_training_occurrence_evidence"."annulled_reason" IS NULL) OR ("prevention_training_occurrence_evidence"."state" = 'annulled' AND "prevention_training_occurrence_evidence"."annulled_at" IS NOT NULL AND "prevention_training_occurrence_evidence"."annulled_by_user_id" IS NOT NULL AND length("prevention_training_occurrence_evidence"."annulled_reason") >= 5))
);
--> statement-breakpoint
CREATE TABLE "prevention_training_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_item_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"slot_key" text NOT NULL,
	"scheduled_month" integer,
	"scheduled_week" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" text,
	"observation" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prevention_training_occurrence_year_check" CHECK ("prevention_training_occurrences"."year" BETWEEN 2020 AND 2100),
	CONSTRAINT "prevention_training_occurrence_status_check" CHECK ("prevention_training_occurrences"."status" IN ('pending', 'completed', 'not_completed')),
	CONSTRAINT "prevention_training_occurrence_slot_check" CHECK (("prevention_training_occurrences"."scheduled_month" IS NULL AND "prevention_training_occurrences"."scheduled_week" IS NULL) OR ("prevention_training_occurrences"."scheduled_month" BETWEEN 1 AND 12 AND "prevention_training_occurrences"."scheduled_week" BETWEEN 1 AND 4)),
	CONSTRAINT "prevention_training_occurrence_completed_consistency_check" CHECK (("prevention_training_occurrences"."status" = 'completed' AND "prevention_training_occurrences"."completed_at" IS NOT NULL AND "prevention_training_occurrences"."completed_by_user_id" IS NOT NULL) OR ("prevention_training_occurrences"."status" <> 'completed' AND "prevention_training_occurrences"."completed_at" IS NULL AND "prevention_training_occurrences"."completed_by_user_id" IS NULL)),
	CONSTRAINT "prevention_training_occurrence_observation_length_check" CHECK ("prevention_training_occurrences"."observation" IS NULL OR length("prevention_training_occurrences"."observation") <= 3000),
	CONSTRAINT "prevention_training_occurrence_version_check" CHECK ("prevention_training_occurrences"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_events" ADD COLUMN "auto_approve_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_events" ADD COLUMN "planned_year" integer;--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_events" ADD COLUMN "period_override_json" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "prevention_training_occurrence_evidence" ADD CONSTRAINT "training_evidence_occurrence_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."prevention_training_occurrences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_occurrence_evidence" ADD CONSTRAINT "training_evidence_uploader_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_occurrence_evidence" ADD CONSTRAINT "training_evidence_annuller_fk" FOREIGN KEY ("annulled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" ADD CONSTRAINT "training_occurrence_catalog_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."prevention_training_catalog_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" ADD CONSTRAINT "training_occurrence_worksite_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" ADD CONSTRAINT "training_occurrence_completer_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_training_catalog_version_code_unique" ON "prevention_training_catalog_items" USING btree ("catalog_version","code");--> statement-breakpoint
CREATE INDEX "prevention_training_catalog_active_order_idx" ON "prevention_training_catalog_items" USING btree ("catalog_version","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "prevention_training_occurrence_evidence_occurrence_idx" ON "prevention_training_occurrence_evidence" USING btree ("occurrence_id","state","uploaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_training_occurrence_slot_unique" ON "prevention_training_occurrences" USING btree ("catalog_item_id","worksite_id","year","slot_key");--> statement-breakpoint
CREATE INDEX "prevention_training_occurrence_worksite_period_idx" ON "prevention_training_occurrences" USING btree ("worksite_id","year","status");--> statement-breakpoint
CREATE INDEX "prevention_training_occurrence_catalog_idx" ON "prevention_training_occurrences" USING btree ("catalog_item_id","year");--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_events" ADD CONSTRAINT "pdtp_fulfillment_events_auto_approve_by_user_id_users_id_fk" FOREIGN KEY ("auto_approve_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_fulfillment_events" ADD CONSTRAINT "pdtp_fulfillment_events_planned_year_check" CHECK ("pdtp_fulfillment_events"."planned_year" IS NULL OR "pdtp_fulfillment_events"."planned_year" BETWEEN 2024 AND 2100);
--> statement-breakpoint
INSERT INTO "prevention_training_catalog_items" (
  "id", "code", "title", "item_type", "audience", "catalog_version",
  "source_row", "schedule_json", "pdtp_activity_numbers", "is_active", "sort_order"
)
VALUES
  ('training-catalog-2026-cap-01', 'CAP-01', 'Inducción DS 44, art. 15 y procedimiento de trabajo seguro', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 9, '[{"slotKey":"annual","month":null,"week":null}]'::jsonb, '[]'::jsonb, true, 1),
  ('training-catalog-2026-cap-02', 'CAP-02', 'Uso y manejo de extintor portátil', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 10, '[{"slotKey":"m03-w2","month":3,"week":2},{"slotKey":"m04-w3","month":4,"week":3}]'::jsonb, '[54]'::jsonb, true, 2),
  ('training-catalog-2026-cap-03', 'CAP-03', 'Uso, mantención y sustitución de EPP', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 11, '[{"slotKey":"m02-w1","month":2,"week":1},{"slotKey":"m03-w3","month":3,"week":3}]'::jsonb, '[63]'::jsonb, true, 3),
  ('training-catalog-2026-cap-04', 'CAP-04', 'Conducción defensiva', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 12, '[{"slotKey":"m01-w4","month":1,"week":4}]'::jsonb, '[56]'::jsonb, true, 4),
  ('training-catalog-2026-cap-05', 'CAP-05', 'Capacitación de límites de velocidad', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 13, '[{"slotKey":"m03-w3","month":3,"week":3}]'::jsonb, '[]'::jsonb, true, 5),
  ('training-catalog-2026-cap-06', 'CAP-06', 'Capacitación y difusión de política integrada', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 14, '[{"slotKey":"m04-w2","month":4,"week":2}]'::jsonb, '[]'::jsonb, true, 6),
  ('training-catalog-2026-cap-07', 'CAP-07', 'Primeros auxilios', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 15, '[{"slotKey":"m05-w2","month":5,"week":2}]'::jsonb, '[55]'::jsonb, true, 7),
  ('training-catalog-2026-cap-08', 'CAP-08', 'Control de riesgos para personas trabajadoras', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 16, '[{"slotKey":"m04-w1","month":4,"week":1}]'::jsonb, '[]'::jsonb, true, 8),
  ('training-catalog-2026-cap-09', 'CAP-09', 'Prevención de riesgos en caídas en altura', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 17, '[{"slotKey":"m06-w2","month":6,"week":2}]'::jsonb, '[]'::jsonb, true, 9),
  ('training-catalog-2026-cap-10', 'CAP-10', 'Riesgos de altas temperaturas y radiación solar', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 18, '[{"slotKey":"m09-w2","month":9,"week":2}]'::jsonb, '[]'::jsonb, true, 10),
  ('training-catalog-2026-cap-11', 'CAP-11', 'Gestión del riesgo de desastres', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 19, '[{"slotKey":"m03-w4","month":3,"week":4}]'::jsonb, '[58]'::jsonb, true, 11),
  ('training-catalog-2026-cap-12', 'CAP-12', 'Matriz de identificación de peligros y evaluación de riesgos (MIPER)', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 20, '[{"slotKey":"m05-w2","month":5,"week":2},{"slotKey":"m07-w2","month":7,"week":2}]'::jsonb, '[]'::jsonb, true, 12),
  ('training-catalog-2026-cap-13', 'CAP-13', 'Capacitación de violencia y acoso 21.643', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 21, '[{"slotKey":"m08-w2","month":8,"week":2}]'::jsonb, '[]'::jsonb, true, 13),
  ('training-catalog-2026-cap-14', 'CAP-14', 'Sistema de gestión de seguridad y salud en el trabajo (SG-SST) y programa de gestión', 'course', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 22, '[{"slotKey":"m10-w2","month":10,"week":2}]'::jsonb, '[]'::jsonb, true, 14),
  ('training-catalog-2026-cam-01', 'CAM-01', 'Programa de módulos saludables', 'campaign', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 24, '[{"slotKey":"m03-w2","month":3,"week":2}]'::jsonb, '[85]'::jsonb, true, 15),
  ('training-catalog-2026-cam-02', 'CAM-02', 'Promoción de la salud', 'campaign', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 25, '[{"slotKey":"m01-w1","month":1,"week":1},{"slotKey":"m04-w2","month":4,"week":2}]'::jsonb, '[85]'::jsonb, true, 16),
  ('training-catalog-2026-cam-03', 'CAM-03', 'Manejo del estrés', 'campaign', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 26, '[{"slotKey":"m05-w1","month":5,"week":1}]'::jsonb, '[86]'::jsonb, true, 17),
  ('training-catalog-2026-cam-04', 'CAM-04', 'Ojo con los puntos ciegos de los camiones y equipos', 'campaign', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 27, '[{"slotKey":"m11-w2","month":11,"week":2}]'::jsonb, '[89]'::jsonb, true, 18),
  ('training-catalog-2026-cam-05', 'CAM-05', 'Prevención de factores de riesgos asociados al consumo de alcohol y drogas en el lugar de trabajo', 'campaign', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 28, '[{"slotKey":"annual","month":null,"week":null}]'::jsonb, '[87]'::jsonb, true, 19),
  ('training-catalog-2026-cam-06', 'CAM-06', 'Promoción de vida sana y prevención de enfermedades crónicas', 'campaign', 'Dirigido a todo el personal.', 'programa-capacitacion-2026-v1', 29, '[{"slotKey":"m10-w2","month":10,"week":2}]'::jsonb, '[85]'::jsonb, true, 20)
ON CONFLICT ("catalog_version", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "prevention_training_occurrences" (
  "id", "catalog_item_id", "worksite_id", "year", "slot_key",
  "scheduled_month", "scheduled_week", "status", "version"
)
SELECT
  format('training-occurrence-%s-%s-%s-%s', 2026, w."id", lower(c."code"), slot."slot_key"),
  c."id", w."id", 2026, slot."slot_key", slot."month", slot."week", 'pending', 1
FROM "prevention_training_catalog_items" c
JOIN "worksites" w ON w."is_active" = true
CROSS JOIN LATERAL jsonb_to_recordset(c."schedule_json") AS slot("slot_key" text, "month" integer, "week" integer)
WHERE c."catalog_version" = 'programa-capacitacion-2026-v1'
  AND c."is_active" = true
ON CONFLICT ("catalog_item_id", "worksite_id", "year", "slot_key") DO NOTHING;
