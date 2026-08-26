CREATE TABLE "prevention_capa_risk_links" (
	"id" text PRIMARY KEY NOT NULL,
	"capa_action_id" text NOT NULL,
	"risk_entry_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prevention_capa_risk_links" ADD CONSTRAINT "prevention_capa_risk_links_capa_action_id_prevention_capa_actions_id_fk" FOREIGN KEY ("capa_action_id") REFERENCES "public"."prevention_capa_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_risk_links" ADD CONSTRAINT "prevention_capa_risk_links_risk_entry_id_prevention_risk_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."prevention_risk_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_capa_risk_links" ADD CONSTRAINT "prevention_capa_risk_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prevention_capa_risk_links_unique" ON "prevention_capa_risk_links" USING btree ("capa_action_id","risk_entry_id");--> statement-breakpoint
CREATE INDEX "prevention_capa_risk_links_capa_idx" ON "prevention_capa_risk_links" USING btree ("capa_action_id");--> statement-breakpoint
CREATE INDEX "prevention_capa_risk_links_risk_entry_idx" ON "prevention_capa_risk_links" USING btree ("risk_entry_id");