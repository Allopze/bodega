ALTER TABLE "purchase_order_items" DROP CONSTRAINT "purchase_order_items_numeric_integrity";--> statement-breakpoint
ALTER TABLE "purchase_order_items" ALTER COLUMN "unit_price" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ALTER COLUMN "unit_price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ALTER COLUMN "subtotal" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ALTER COLUMN "subtotal" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "requires_worker" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "cost_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "cost_recorded_by" text;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_cost_recorded_by_users_id_fk" FOREIGN KEY ("cost_recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_cost_pending_pair" CHECK (
    ("purchase_order_items"."unit_price" IS NULL) = ("purchase_order_items"."subtotal" IS NULL)
  );--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_cost_trace_requires_cost" CHECK (
    "purchase_order_items"."cost_recorded_at" IS NULL OR "purchase_order_items"."unit_price" IS NOT NULL
  );--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_numeric_integrity" CHECK (
    "purchase_order_items"."quantity" > 0
    AND ("purchase_order_items"."unit_price" IS NULL OR "purchase_order_items"."unit_price" >= 0)
    AND "purchase_order_items"."discount" >= 0
    AND "purchase_order_items"."discount" <= 100
    AND ("purchase_order_items"."subtotal" IS NULL OR "purchase_order_items"."subtotal" >= 0)
    AND "purchase_order_items"."quantity_office_received" >= 0
    AND "purchase_order_items"."quantity_received" >= 0
    AND "purchase_order_items"."quantity_office_received" <= "purchase_order_items"."quantity"
    AND "purchase_order_items"."quantity_received" <= "purchase_order_items"."quantity"
  );--> statement-breakpoint
-- Catálogo de servicios operacionales (regla 5 del README: datos semilla que el
-- esquema TS no captura, idempotentes). Son productos de catálogo normales con
-- `is_service`, así que conviven con EPP en una misma solicitud y recorren el
-- mismo flujo Solicitud → Aprobación → OC → Recepción.
INSERT INTO "product_categories" ("id", "name", "slug", "is_epp", "requires_prevencion", "sort_order")
VALUES ('cat-servicios-operacionales', 'Servicios operacionales', 'servicios-operacionales', false, false, 90)
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "products" (
  "id", "sku", "name", "description", "category_id", "unit_of_measure",
  "is_epp", "requires_prevencion", "is_service", "requires_worker",
  "reference_price", "is_active", "notes"
)
VALUES
  ('prod-srv-monogas',  'SRV-MONOGAS',  'Mantención de monogás',      'Mantención preventiva/correctiva de detector monogás.', 'cat-servicios-operacionales', 'servicio', false, false, true, false, NULL, true, 'Servicio: el costo se registra sobre la OC cuando el proveedor lo informa.'),
  ('prod-srv-alcotest', 'SRV-ALCOTEST', 'Calibración de alcotest',    'Calibración y certificación de equipo alcotest.',       'cat-servicios-operacionales', 'servicio', false, false, true, false, NULL, true, 'Servicio: el costo se registra sobre la OC cuando el proveedor lo informa.'),
  ('prod-srv-vacuna',   'SRV-VACUNA',   'Vacuna',                     'Vacunación de un colaborador.',                          'cat-servicios-operacionales', 'servicio', false, false, true, true,  NULL, true, 'Servicio nominado: exige colaborador y número de dosis.')
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "product_attributes" ("id", "product_id", "category_id", "name", "type", "is_required", "options", "size_family", "sort_order")
VALUES
  -- Monogás y alcotest: no existe un registro de activos para instrumentos de
  -- mano (fuel_vehicles exige patente y es del módulo de combustibles), así que
  -- el equipo se identifica con los mismos atributos de ítem que ya usan
  -- repuestos/servicios por cotización.
  ('pa-srv-monogas-serie',  'prod-srv-monogas',  NULL, 'Código interno / N° de serie', 'text',    true,  NULL, NULL, 0),
  ('pa-srv-monogas-brand',  'prod-srv-monogas',  NULL, 'Marca',                        'text',    false, NULL, NULL, 1),
  ('pa-srv-monogas-model',  'prod-srv-monogas',  NULL, 'Modelo',                       'text',    false, NULL, NULL, 2),
  ('pa-srv-alcotest-serie', 'prod-srv-alcotest', NULL, 'Código interno / N° de serie', 'text',    true,  NULL, NULL, 0),
  ('pa-srv-alcotest-brand', 'prod-srv-alcotest', NULL, 'Marca',                        'text',    false, NULL, NULL, 1),
  ('pa-srv-alcotest-model', 'prod-srv-alcotest', NULL, 'Modelo',                       'text',    false, NULL, NULL, 2),
  ('pa-srv-vacuna-dosis',   'prod-srv-vacuna',   NULL, 'Número de dosis',              'integer', true,  NULL, NULL, 0)
ON CONFLICT DO NOTHING;
