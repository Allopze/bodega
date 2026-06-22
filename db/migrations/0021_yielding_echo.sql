CREATE TABLE "feedback_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"titulo" text NOT NULL,
	"descripcion" text NOT NULL,
	"pagina" text,
	"estado" text DEFAULT 'abierto' NOT NULL,
	"nota_interna" text,
	"created_by" text NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_reports_tipo_valid" CHECK ("feedback_reports"."tipo" IN ('bug', 'consulta', 'sugerencia')),
	CONSTRAINT "feedback_reports_estado_valid" CHECK ("feedback_reports"."estado" IN ('abierto', 'en_progreso', 'resuelto', 'descartado'))
);
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_reports_created_by_idx" ON "feedback_reports" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "feedback_reports_estado_idx" ON "feedback_reports" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "feedback_reports_tipo_idx" ON "feedback_reports" USING btree ("tipo");