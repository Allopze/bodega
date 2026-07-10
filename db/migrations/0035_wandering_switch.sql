CREATE TABLE "fuel_operation_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"archivo_nombre" text NOT NULL,
	"archivo_path" text,
	"hash_archivo" text NOT NULL,
	"estado" text DEFAULT 'importado' NOT NULL,
	"periodo_desde" text NOT NULL,
	"periodo_hasta" text NOT NULL,
	"total_filas" integer DEFAULT 0 NOT NULL,
	"filas_validas" integer DEFAULT 0 NOT NULL,
	"filas_invalidas" integer DEFAULT 0 NOT NULL,
	"total_equipos" integer DEFAULT 0 NOT NULL,
	"total_litros" numeric(14, 4) DEFAULT 0 NOT NULL,
	"total_monto" numeric(14, 2) DEFAULT 0 NOT NULL,
	"importado_por" text NOT NULL,
	"notas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_operation_batches_estado_valid" CHECK ("fuel_operation_batches"."estado" IN ('importado', 'revertido')),
	CONSTRAINT "fuel_operation_batches_periodo_valid" CHECK ("fuel_operation_batches"."periodo_desde" <= "fuel_operation_batches"."periodo_hasta")
);
--> statement-breakpoint
CREATE TABLE "fuel_operation_records" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"worksite_id" text,
	"vehicle_id" text,
	"plate" text NOT NULL,
	"code" text,
	"faena_nombre" text,
	"tipo" text,
	"marca" text,
	"modelo" text,
	"anio" integer,
	"fecha" text NOT NULL,
	"hora_carga" text,
	"horometro" numeric(14, 2),
	"medido_por" text,
	"liters" numeric(12, 4) NOT NULL,
	"operador" text,
	"supervisor" text,
	"proveedor_nombre" text,
	"fuel_supplier_id" text,
	"precio_litro" numeric(14, 2),
	"monto" numeric(14, 2),
	"rendimiento" numeric(10, 4),
	"tipo_rendimiento" text,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_operation_records_liters_positive" CHECK ("fuel_operation_records"."liters" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "fuel_operation_batches" ADD CONSTRAINT "fuel_operation_batches_importado_por_users_id_fk" FOREIGN KEY ("importado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_operation_records" ADD CONSTRAINT "fuel_operation_records_batch_id_fuel_operation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fuel_operation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_operation_records" ADD CONSTRAINT "fuel_operation_records_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_operation_records" ADD CONSTRAINT "fuel_operation_records_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_operation_records" ADD CONSTRAINT "fuel_operation_records_fuel_supplier_id_fuel_suppliers_id_fk" FOREIGN KEY ("fuel_supplier_id") REFERENCES "public"."fuel_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_operation_batches_hash_idx" ON "fuel_operation_batches" USING btree ("hash_archivo");--> statement-breakpoint
CREATE INDEX "fuel_operation_batches_estado_idx" ON "fuel_operation_batches" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "fuel_operation_batches_periodo_idx" ON "fuel_operation_batches" USING btree ("periodo_desde","periodo_hasta");--> statement-breakpoint
CREATE INDEX "fuel_operation_records_batch_idx" ON "fuel_operation_records" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "fuel_operation_records_worksite_idx" ON "fuel_operation_records" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fuel_operation_records_vehicle_idx" ON "fuel_operation_records" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "fuel_operation_records_plate_idx" ON "fuel_operation_records" USING btree ("plate");--> statement-breakpoint
CREATE INDEX "fuel_operation_records_fecha_idx" ON "fuel_operation_records" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "fuel_vehicles_code_idx" ON "fuel_vehicles" USING btree ("code");