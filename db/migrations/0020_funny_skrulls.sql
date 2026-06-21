CREATE TABLE "ppa_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"worker_id" text,
	"worker_name" text NOT NULL,
	"worker_rut" text,
	"worker_company" text,
	"manual_identificacion" boolean DEFAULT false NOT NULL,
	"tipo_trabajo" text NOT NULL,
	"es_critica" boolean DEFAULT false NOT NULL,
	"answers_json" jsonb NOT NULL,
	"resultado" text NOT NULL,
	"triggered_reasons" jsonb NOT NULL,
	"estado" text NOT NULL,
	"public_token" text NOT NULL,
	"reviewed_by" text,
	"fui_al_lugar" boolean,
	"accion_correctiva" text,
	"decision" text,
	"review_nota" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ppa_submissions_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
ALTER TABLE "repuesto_quotations" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "service_quotations" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_submissions" ADD CONSTRAINT "ppa_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repuesto_quotations" ADD CONSTRAINT "repuesto_quotations_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_quotations" ADD CONSTRAINT "service_quotations_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;