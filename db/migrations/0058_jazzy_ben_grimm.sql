CREATE TABLE "sst_evaluation_visits" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"fecha_visita" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sst_evaluations" ADD COLUMN "visit_id" text;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD CONSTRAINT "sst_evaluation_visits_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD CONSTRAINT "sst_evaluation_visits_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD CONSTRAINT "sst_evaluation_visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sst_visit_worker_date" ON "sst_evaluation_visits" USING btree ("worker_id","fecha_visita","created_at");--> statement-breakpoint
CREATE INDEX "idx_sst_visit_worksite_date" ON "sst_evaluation_visits" USING btree ("worksite_id","fecha_visita");--> statement-breakpoint
ALTER TABLE "sst_evaluations" ADD CONSTRAINT "sst_evaluations_visit_id_sst_evaluation_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."sst_evaluation_visits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sst_visit" ON "sst_evaluations" USING btree ("visit_id");