CREATE TABLE "safety_indicator_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"closed_by_user_id" text NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "safety_indicator_periods_month_check" CHECK ("safety_indicator_periods"."month" BETWEEN 1 AND 12),
	CONSTRAINT "safety_indicator_periods_year_check" CHECK ("safety_indicator_periods"."year" BETWEEN 2024 AND 2100)
);
--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD CONSTRAINT "safety_indicator_periods_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD CONSTRAINT "safety_indicator_periods_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_indicator_periods_worksite_period_unique" ON "safety_indicator_periods" USING btree ("worksite_id","year","month");