ALTER TABLE "fleet_vehicle_documents" ADD COLUMN "status" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_vehicle_documents" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fleet_vehicle_documents" ADD COLUMN "superseded_by" text;--> statement-breakpoint
-- Conciliación ANTES del índice único: hoy conviven varias versiones del mismo
-- tipo por equipo —ésa es la causa de que el "próximo vencimiento" saliera de
-- un MIN sobre pólizas ya reemplazadas—, así que crear la unicidad sin resolver
-- la pila haría fallar la migración. Se conserva la más reciente como vigente y
-- se encadena cada versión anterior con la que la reemplazó.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "vehicle_id", "document_type"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS version_rank,
    LAG("id") OVER (
      PARTITION BY "vehicle_id", "document_type"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS newer_id,
    LAG("created_at") OVER (
      PARTITION BY "vehicle_id", "document_type"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS newer_created_at
  FROM "fleet_vehicle_documents"
)
UPDATE "fleet_vehicle_documents" AS doc
SET
  "status" = 'replaced',
  "superseded_at" = COALESCE(ranked.newer_created_at, doc."created_at"),
  "superseded_by" = ranked.newer_id
FROM ranked
WHERE ranked."id" = doc."id"
  AND ranked.version_rank > 1;--> statement-breakpoint
ALTER TABLE "fleet_vehicle_documents" ADD CONSTRAINT "fleet_vehicle_documents_superseded_by_fleet_vehicle_documents_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."fleet_vehicle_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_vehicle_documents_current_unique" ON "fleet_vehicle_documents" USING btree ("vehicle_id","document_type") WHERE "fleet_vehicle_documents"."status" = 'current';--> statement-breakpoint
ALTER TABLE "fleet_vehicle_documents" ADD CONSTRAINT "fleet_vehicle_documents_status_valid" CHECK ("fleet_vehicle_documents"."status" IN ('current', 'replaced'));
