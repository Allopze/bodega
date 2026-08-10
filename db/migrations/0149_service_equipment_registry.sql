CREATE TABLE "service_equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"brand" text,
	"model" text,
	"serial_number" text,
	"worksite_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_equipment_kind_normalized" CHECK (
    "service_equipment"."kind" = lower("service_equipment"."kind")
    AND char_length("service_equipment"."kind") BETWEEN 2 AND 40
    AND "service_equipment"."kind" !~ '\s'
  )
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "equipment_kind" text;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD COLUMN "equipment_id" text;--> statement-breakpoint
ALTER TABLE "service_equipment" ADD CONSTRAINT "service_equipment_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_equipment_code_unique" ON "service_equipment" USING btree ("code");--> statement-breakpoint
CREATE INDEX "service_equipment_worksite_kind_idx" ON "service_equipment" USING btree ("worksite_id","kind","is_active");--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_equipment_id_service_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."service_equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_request_items_equipment_idx" ON "purchase_request_items" USING btree ("equipment_id");--> statement-breakpoint
-- Los dos servicios sobre instrumentos pasan a apuntar al registro de equipos.
UPDATE "products" SET "equipment_kind" = 'monogas'  WHERE "id" = 'prod-srv-monogas';--> statement-breakpoint
UPDATE "products" SET "equipment_kind" = 'alcotest' WHERE "id" = 'prod-srv-alcotest';--> statement-breakpoint

-- El atributo de texto libre "Código interno / N° de serie" queda obsoleto: lo
-- reemplaza la FK al equipo. Se suelta la referencia de las solicitudes que ya
-- lo usaron —conservando nombre y valor, que es el historial— antes de borrarlo.
UPDATE "request_item_attributes" SET "attribute_id" = NULL
WHERE "attribute_id" IN ('pa-srv-monogas-serie', 'pa-srv-alcotest-serie');--> statement-breakpoint

DELETE FROM "product_attributes"
WHERE "id" IN ('pa-srv-monogas-serie', 'pa-srv-alcotest-serie');
