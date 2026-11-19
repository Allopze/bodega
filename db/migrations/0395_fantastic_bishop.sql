CREATE TABLE "app_visits" (
	"user_id" text NOT NULL,
	"module_id" text NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	"last_visit_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_visits_user_id_module_id_day_pk" PRIMARY KEY("user_id","module_id","day")
);
--> statement-breakpoint
ALTER TABLE "app_visits" ADD CONSTRAINT "app_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_visits_module_day_idx" ON "app_visits" USING btree ("module_id","day");--> statement-breakpoint
CREATE INDEX "app_visits_day_idx" ON "app_visits" USING btree ("day");