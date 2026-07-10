CREATE TABLE "fuel_consumption_records" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"vehicle_id" text,
	"patente" text NOT NULL,
	"numero_tarjetas" integer DEFAULT 0 NOT NULL,
	"numero_transacciones" integer DEFAULT 0 NOT NULL,
	"cantidad_unidad" numeric(14, 4) NOT NULL,
	"monto" numeric(14, 2) NOT NULL,
	"rendimiento_promedio" numeric(10, 4) DEFAULT 0 NOT NULL,
	"precio_promedio_unidad" numeric(14, 2),
	"periodo_desde" text NOT NULL,
	"periodo_hasta" text NOT NULL,
	"fuente" text,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_consumption_records_cantidad_positive" CHECK ("fuel_consumption_records"."cantidad_unidad" >= 0),
	CONSTRAINT "fuel_consumption_records_monto_positive" CHECK ("fuel_consumption_records"."monto" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fuel_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"fuente" text,
	"periodo_desde" text NOT NULL,
	"periodo_hasta" text NOT NULL,
	"archivo_nombre" text NOT NULL,
	"archivo_path" text,
	"hash_archivo" text NOT NULL,
	"estado" text DEFAULT 'importado' NOT NULL,
	"total_filas" integer DEFAULT 0 NOT NULL,
	"filas_validas" integer DEFAULT 0 NOT NULL,
	"filas_invalidas" integer DEFAULT 0 NOT NULL,
	"total_patentes" integer DEFAULT 0 NOT NULL,
	"total_tarjetas" integer DEFAULT 0 NOT NULL,
	"total_transacciones" integer DEFAULT 0 NOT NULL,
	"total_cantidad" numeric(14, 4) DEFAULT 0 NOT NULL,
	"total_monto" numeric(14, 2) DEFAULT 0 NOT NULL,
	"importado_por" text NOT NULL,
	"notas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_import_batches_estado_valid" CHECK ("fuel_import_batches"."estado" IN ('importado', 'revertido')),
	CONSTRAINT "fuel_import_batches_periodo_valid" CHECK ("fuel_import_batches"."periodo_desde" <= "fuel_import_batches"."periodo_hasta")
);
--> statement-breakpoint
ALTER TABLE "fuel_consumption_records" ADD CONSTRAINT "fuel_consumption_records_batch_id_fuel_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fuel_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_consumption_records" ADD CONSTRAINT "fuel_consumption_records_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_consumption_records" ADD CONSTRAINT "fuel_consumption_records_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_import_batches" ADD CONSTRAINT "fuel_import_batches_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_import_batches" ADD CONSTRAINT "fuel_import_batches_importado_por_users_id_fk" FOREIGN KEY ("importado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_consumption_records_batch_idx" ON "fuel_consumption_records" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "fuel_consumption_records_worksite_idx" ON "fuel_consumption_records" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_consumption_records_patente_idx" ON "fuel_consumption_records" USING btree ("patente");--> statement-breakpoint
CREATE INDEX "fuel_consumption_records_vehicle_idx" ON "fuel_consumption_records" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "fuel_consumption_records_periodo_idx" ON "fuel_consumption_records" USING btree ("periodo_desde");--> statement-breakpoint
CREATE INDEX "fuel_import_batches_worksite_idx" ON "fuel_import_batches" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_import_batches_hash_idx" ON "fuel_import_batches" USING btree ("hash_archivo");--> statement-breakpoint
CREATE INDEX "fuel_import_batches_estado_idx" ON "fuel_import_batches" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "fuel_import_batches_periodo_idx" ON "fuel_import_batches" USING btree ("periodo_desde","periodo_hasta");