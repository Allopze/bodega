CREATE TABLE "ppa_corrective_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"ppa_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"description" text NOT NULL,
	"responsible_role" text NOT NULL,
	"responsible" text NOT NULL,
	"due_date" text NOT NULL,
	"priority" text DEFAULT 'alta' NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ppa_corrective_actions_priority_check" CHECK ("ppa_corrective_actions"."priority" IN ('alta', 'media', 'baja')),
	CONSTRAINT "ppa_corrective_actions_status_check" CHECK ("ppa_corrective_actions"."status" IN ('pendiente', 'en_proceso', 'completada', 'verificada', 'cerrada'))
);
--> statement-breakpoint
ALTER TABLE "ppa_corrective_actions" ADD CONSTRAINT "ppa_corrective_actions_ppa_id_ppa_submissions_id_fk" FOREIGN KEY ("ppa_id") REFERENCES "public"."ppa_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_corrective_actions" ADD CONSTRAINT "ppa_corrective_actions_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_corrective_actions" ADD CONSTRAINT "ppa_corrective_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ppa_corrective_actions_ppa_unique" ON "ppa_corrective_actions" USING btree ("ppa_id");--> statement-breakpoint
CREATE INDEX "ppa_corrective_actions_worksite_status_idx" ON "ppa_corrective_actions" USING btree ("worksite_id","status");--> statement-breakpoint
CREATE INDEX "ppa_corrective_actions_due_date_idx" ON "ppa_corrective_actions" USING btree ("due_date");